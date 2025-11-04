import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { PLOINKY_DIR } from '../services/config.js';
import { debugLog, findAgent } from '../services/utils.js';
import { isKnownCommand } from '../services/commandRegistry.js';
import { loadValidLlmApiKeys, collectAvailableLlmKeys } from '../services/llmProviderUtils.js';
import { defaultLLMInvokerStrategy } from 'ploinkyAgentLib/utils/LLMClient.mjs';
import 'ploinkyAgentLib/LLMAgents';
import { showHelp } from '../services/help.js';
import * as reposSvc from '../services/repos.js';
import * as envSvc from '../services/secretVars.js';
import * as agentsSvc from '../services/agents.js';
import { listRepos, listAgents, listCurrentAgents, listRoutes, statusWorkspace, collectAgentsSummary } from '../services/status.js';
import { logsTail, showLast } from '../services/logUtils.js';
import { startWorkspace, runCli, runShell, refreshAgent } from '../services/workspaceUtil.js';
import { refreshComponentToken, ensureComponentToken, getComponentToken } from '../server/utils/routerEnv.js';
import * as dockerSvc from '../services/docker/index.js';
import * as workspaceSvc from '../services/workspace.js';
import { appendLog } from '../server/utils/logger.js';
import {
    setSsoEnabled,
    disableSsoConfig,
    gatherSsoStatus,
    extractShortAgentName as extractSsoShortName,
    SSO_ENV_ROLE_CANDIDATES,
    resolveEnvRoleValues as resolveSsoEnvRoleValues
} from '../services/sso.js';
import ClientCommands from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const WORKSPACE_ENV_FILENAME = '.env';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LLM_SYSTEM_CONTEXT_PATH = path.join(PROJECT_ROOT, 'docs', 'ploinky-overview.md');

let cachedLlmSystemContext = null;

function loadLlmSystemContext() {
    if (cachedLlmSystemContext !== null) {
        return cachedLlmSystemContext;
    }

    try {
        const content = fs.readFileSync(LLM_SYSTEM_CONTEXT_PATH, 'utf8');
        cachedLlmSystemContext = content.trim();
    } catch (error) {
        cachedLlmSystemContext = '';
        debugLog('loadLlmSystemContext failed:', error?.message || error);
    }

    return cachedLlmSystemContext;
}

function formatValidApiKeyList(validKeys) {
    if (!Array.isArray(validKeys) || !validKeys.length) return '[]';
    return `[${validKeys.join(', ')}]`;
}

function composeUserCommand(command, options = []) {
    const parts = [command, ...options].filter(Boolean);
    return parts.join(' ').trim();
}

function buildLlmPrompt(rawInput) {
    const sections = [];
    const systemContext = loadLlmSystemContext();
    if (systemContext) {
        sections.push('System context for Ploinky CLI and runtime:\n' + systemContext);
    }

    sections.push(
        'You are a command guide for an operating system that has Ploinky CLI installed.',
        'Given the user input, propose the best next step the user should execute inside the CLI or system. '
            + 'If more than one action is required, return a numbered list with each step on its own line.',
        'Each step should reference a concrete Ploinky command (for example "add repo demo" or "enable agent basic/chatbot"). or system command (Ex: ls, cd .. ,nano file.txt)',
        'If the input is unclear, respond with a short tip suggesting they run "help".',
        `User input: "${rawInput}"`
    );

    return sections.join('\n\n');
}

function extractLlmErrorDetails(error) {
    const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
    const firstAttempt = attempts.length ? attempts[0] : null;
    const candidate = firstAttempt?.error || error;
    let code = null;

    if (candidate?.response?.status && Number.isInteger(candidate.response.status)) {
        code = Number(candidate.response.status);
    } else if (typeof candidate?.status === 'number') {
        code = Number(candidate.status);
    }

    let primaryMessage = '';
    if (typeof candidate?.message === 'string' && candidate.message.trim()) {
        primaryMessage = candidate.message;
    } else if (typeof candidate === 'string' && candidate.trim()) {
        primaryMessage = candidate;
    } else if (typeof error?.message === 'string' && error.message.trim()) {
        primaryMessage = error.message;
    }

    if (!code) {
        const codeMatch = primaryMessage.match(/\b(\d{3})\b/);
        if (codeMatch) {
            code = Number(codeMatch[1]);
        }
    }

    let message = primaryMessage || 'All model invocations failed.';
    if (message.includes('\n')) {
        message = message.split(/\r?\n/)[0].trim();
    }
    const MAX_LEN = 200;
    if (message.length > MAX_LEN) {
        message = `${message.slice(0, MAX_LEN)}...`;
    }

    return {
        code,
        message,
    };
}

async function suggestCommandWithLLM(commandLabel, options = []) {
    const rawInput = composeUserCommand(commandLabel, options) || commandLabel || '';
    if (!rawInput.trim()) {
        return { status: 'empty' };
    }

    const prompt = buildLlmPrompt(rawInput);
    try {
        const response = await defaultLLMInvokerStrategy({
            prompt,
            mode: 'fast',
            params: { temperature: 0.1 },
        });
        if (typeof response === 'string' && response.trim()) {
            return { status: 'ok', suggestion: response.trim() };
        }
        return { status: 'empty' };
    } catch (error) {
        debugLog('LLM suggestion failed:', error?.message || error);
        const details = extractLlmErrorDetails(error);
        return { status: 'error', error: details };
    }
}

function commandExistsSync(cmd) {
    if (!cmd) return false;
    const checker = process.platform === 'win32' ? 'where' : 'which';
    try {
        execSync(`${checker} ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function resolveCdTarget(target) {
    const homeDir = os.homedir() || process.cwd();
    if (!target || target === '~') {
        return homeDir;
    }
    if (target.startsWith('~/')) {
        return path.join(homeDir, target.slice(2));
    }
    return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

async function handleSystemCommand(command, options = []) {
    if (!command) return false;

    if (command === 'cd') {
        const destination = resolveCdTarget(options[0]);
        try {
            process.chdir(destination);
        } catch (error) {
            console.error(`cd: ${error?.message || error}`);
        }
        return true;
    }

    if (!commandExistsSync(command)) {
        return false;
    }

    return await new Promise((resolve) => {
        const child = spawn(command, options, { stdio: 'inherit' });
        let settled = false;

        child.on('error', (error) => {
            settled = true;
            if (error?.code === 'ENOENT') {
                resolve(false);
            } else {
                console.error(error?.message || error);
                resolve(true);
            }
        });

        child.on('exit', () => {
            if (!settled) {
                resolve(true);
            }
        });
    });
}

async function handleInvalidCommand(command, options = []) {
    const commandLabel = command || '';
    const validKeyNames = loadValidLlmApiKeys();
    const envPath = path.resolve(process.cwd(), WORKSPACE_ENV_FILENAME);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const validKeysList = formatValidApiKeyList(validKeyNames);

    if (!availableKeys.length) {
        console.log(`Command '${commandLabel}' is not recognized as a Ploinky command or system executable. Type help to see options or configure .env file in current directory with one of these api keys : ${validKeysList}`);
        return;
    }

    console.log('Asking the LLM for guidance...');

    const llmResult = await suggestCommandWithLLM(commandLabel, options);
    if (llmResult?.status === 'ok' && llmResult.suggestion) {
        console.log('[LLM] Suggested next steps:');
        console.log(llmResult.suggestion);
        return;
    }

    if (llmResult?.status === 'error' && llmResult.error) {
        if (llmResult.error.code === 401) {
            console.log('LLM call failed: API key invalid.');
        } else {
            console.log(`LLM call failed: ${llmResult.error.message}`);
        }
        console.log('Run `help` to see all available Ploinky commands and their usage.');
        return;
    }

    console.log(`Command '${commandLabel}' is not recognized as a Ploinky command or system executable. Type help to see options or configure .env file in current directory with one of these api keys : ${validKeysList}`);
}

// --- Start of Original Functions ---

// Track containers started in this CLI session that are not persistent agent containers
// Session tracking moved to docker.js
function registerSessionContainer(name) { try { dockerSvc.addSessionContainer(name); } catch (_) { } }
function cleanupSessionContainers() { try { dockerSvc.cleanupSessionSet(); } catch (_) { } }

function getRepoNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    return fs.readdirSync(REPOS_DIR).filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
}

function getAgentNames() {
    const summary = collectAgentsSummary();
    if (!summary.length) return [];

    const catalog = [];
    for (const item of summary) {
        if (!item || !Array.isArray(item.agents)) continue;
        for (const agent of item.agents) {
            if (agent && agent.name) {
                catalog.push({ repo: agent.repo, name: agent.name });
            }
        }
    }

    if (!catalog.length) return [];

    const counts = {};
    for (const agent of catalog) {
        counts[agent.name] = (counts[agent.name] || 0) + 1;
    }

    const suggestions = new Set();
    for (const agent of catalog) {
        const repoName = agent.repo || '';
        if (repoName) {
            suggestions.add(`${repoName}/${agent.name}`);
            suggestions.add(`${repoName}:${agent.name}`);
        }
        if (counts[agent.name] === 1) {
            suggestions.add(agent.name);
        }
    }

    return Array.from(suggestions).sort();
}

function addRepo(repoName, repoUrl) {
    if (!repoName) { showHelp(); throw new Error('Missing repository name.'); }
    const res = reposSvc.addRepo(repoName, repoUrl);
    if (res.status === 'exists') console.log(`✓ Repository '${repoName}' already exists.`);
    else console.log(`✓ Repository '${repoName}' added successfully.`);
}

async function updateRepo(repoName) {
    if (!repoName) throw new Error('Usage: update repo <name>');
    try {
        reposSvc.updateRepo(repoName);
        console.log(`✓ Repo '${repoName}' updated.`);
    } catch (err) {
        throw new Error(`update repo failed: ${err?.message || err}`);
    }
}


const INLINE_ASSIGNMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseInlineAssignmentToken(token) {
    if (typeof token !== 'string') return null;
    if (!token || token.includes('/') || token.includes('\\') || token.startsWith('$')) return null;
    const separators = ['=', ':'];
    let separatorIndex = -1;
    for (const sep of separators) {
        const idx = token.indexOf(sep);
        if (idx > 0 && (separatorIndex === -1 || idx < separatorIndex)) {
            separatorIndex = idx;
        }
    }
    if (separatorIndex <= 0) return null;
    const name = token.slice(0, separatorIndex);
    if (!INLINE_ASSIGNMENT_NAME.test(name)) return null;
    const value = token.slice(separatorIndex + 1);
    return { name, value };
}

function expandInlineAssignment(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return tokens;
    const assignment = parseInlineAssignmentToken(tokens[0]);
    if (!assignment) return tokens;
    return [assignment.name, assignment.value, ...tokens.slice(1)];
}

function setVar(varName, valueOrAlias) {
    if (!varName || typeof valueOrAlias !== 'string' || valueOrAlias.length === 0) {
        showHelp();
        throw new Error('Usage: var <VAR> <value|$OTHER>');
    }
    // Store raw value; if it starts with '$', it becomes an alias. Resolution happens at use time.
    envSvc.setEnvVar(varName, valueOrAlias);
    console.log(`✓ Set variable '${varName}'.`);
}

const ENABLED_REPOS_FILE = reposSvc.ENABLED_REPOS_FILE;
function loadEnabledRepos() { return reposSvc.loadEnabledRepos(); }
function saveEnabledRepos(list) { return reposSvc.saveEnabledRepos(list); }
function enableRepo(repoName) {
    if (!repoName) throw new Error('Usage: enable repo <name>');
    reposSvc.enableRepo(repoName);
    console.log(`✓ Repo '${repoName}' enabled. Use 'list agents' to view agents.`);
}
function disableRepo(repoName) {
    if (!repoName) throw new Error('Usage: disable repo <name>');
    reposSvc.disableRepo(repoName);
    console.log(`✓ Repo '${repoName}' disabled.`);
}

async function enableAgent(agentName, mode, repoNameParam) {
    if (!agentName) throw new Error('Usage: enable agent <name|repo/name> [global|devel [repoName]]');
    const { shortAgentName, repoName } = agentsSvc.enableAgent(agentName, mode, repoNameParam);
    console.log(`✓ Agent '${shortAgentName}' from repo '${repoName}' enabled. Use 'start' to start all configured agents.`);
}

function killRouterIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/router.pid');
        let stopped = false;
        let port = 8080;
        try {
            const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
            if (routing.port) port = parseInt(routing.port, 10) || port;
        } catch (_) { }

        const logRouterStop = (pid, signal, source) => {
            try {
                appendLog('server_stop', { pid, signal, source, port });
            } catch (_) { }
        };

        // 1) Stop by recorded PID if present
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
            if (pid && !Number.isNaN(pid)) {
                try {
                    process.kill(pid, 'SIGTERM');
                    logRouterStop(pid, 'SIGTERM', 'pid_file');
                    console.log(`Stopped Router (pid ${pid}).`);
                    stopped = true;
                } catch (_) { }
            }
            try { fs.unlinkSync(pidFile); } catch (_) { }
        }

        // 2) Fallback: detect by configured port in .ploinky/routing.json
        if (!stopped) {
            const tryKill = (pid) => {
                if (!pid) return false;
                try {
                    process.kill(pid, 'SIGTERM');
                    logRouterStop(pid, 'SIGTERM', 'port_scan');
                    console.log(`Stopped Router (port ${port}, pid ${pid}).`);
                    return true;
                } catch (_) { return false; }
            };

            const findPids = () => {
                const pids = new Set();
                try {
                    const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN`, { stdio: 'pipe' }).toString();
                    out.split(/\s+/).filter(Boolean).forEach(x => { const n = parseInt(x, 10); if (!Number.isNaN(n)) pids.add(n); });
                } catch (_) { }
                if (!pids.size) {
                    try {
                        const out = execSync(`ss -ltnp`, { stdio: 'pipe' }).toString();
                        out.split(/\n+/).forEach(line => {
                            if (line.includes(`:${port}`) && line.includes('pid=')) {
                                const m = line.match(/pid=(\d+)/);
                                if (m) { const n = parseInt(m[1], 10); if (!Number.isNaN(n)) pids.add(n); }
                            }
                        });
                    } catch (_) { }
                }
                return Array.from(pids);
            };

            const pids = findPids();
            for (const pid of pids) {
                if (tryKill(pid)) { stopped = true; }
            }
            if (!stopped && pids.length) {
                // try SIGKILL as last resort
                for (const pid of pids) {
                    try {
                        process.kill(pid, 'SIGKILL');
                        logRouterStop(pid, 'SIGKILL', 'port_scan');
                        console.log(`Killed Router (pid ${pid}).`);
                        stopped = true;
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }
}

function findAgentManifest(agentName) {
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}

// --- End of Original Functions ---


async function shutdownSession() {
    try { cleanupSessionContainers(); } catch (e) { debugLog('shutdown error:', e.message); }
    console.log('Shutdown completed for current session containers.');
}

// Configure the shell used by WebTTY/webconsole
function configureWebttyShell(input) {
    const allowed = new Set(['sh', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish']);
    const name = String(input || '').trim();
    if (!allowed.has(name) && !name.startsWith('/')) {
        console.error(`Unsupported shell '${name}'. Allowed: ${Array.from(allowed).join(', ')}, or an absolute path.`);
        return false;
    }
    // Resolve to executable (absolute path or from PATH)
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const candidates = name.startsWith('/') ? [name] : pathDirs.map(d => path.join(d, name));
    let found = null;
    for (const p of candidates) {
        try { fs.accessSync(p, fs.constants.X_OK); found = p; break; } catch (_) { }
    }
    if (!found) {
        console.error(`Cannot execute shell '${name}': not found or not executable in PATH.`);
        return false;
    }
    try {
        envSvc.setEnvVar('WEBTTY_SHELL', found);
        envSvc.setEnvVar('WEBTTY_COMMAND', `exec ${name}`);
        console.log(`✓ Configured WebTTY shell: ${name} (${found}).`);
        console.log('Note: Restart the router (restart) for changes to take effect.');
        return true;
    } catch (e) {
        console.error(`Failed to configure WebTTY shell: ${e?.message || e}`);
        return false;
    }
}

async function destroyAll() {
    try {
        const list = dockerSvc.destroyWorkspaceContainers({ fast: true });
        if (list.length) {
            console.log('Removed containers:');
            list.forEach(n => console.log(` - ${n}`));
        }
        console.log(`Destroyed ${list.length} containers from this workspace.`);
    }
    catch (e) { console.error('Destroy failed:', e.message); }
}

function parseFlagArgs(args = []) {
    const flags = {};
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (!token || !String(token).startsWith('--')) {
            rest.push(token);
            continue;
        }
        const eqIdx = token.indexOf('=');
        let key = token.slice(2);
        let value;
        if (eqIdx !== -1) {
            key = token.slice(2, eqIdx);
            value = token.slice(eqIdx + 1);
        } else if (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) {
            value = args[i + 1];
            i += 1;
        } else {
            value = 'true';
        }
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        flags[key] = value;
    }
    return { flags, rest };
}

function printSsoDetails(status, { includeSecrets = false } = {}) {
    const { config, secrets, routerPort, providerHostPort } = status;
    if (!config.enabled) {
        console.log('SSO: disabled');
        return;
    }

    const baseUrl = config.baseUrl || secrets.baseUrl || '(unset)';
    const realm = config.realm || secrets.realm || '(unset)';
    const clientId = config.clientId || secrets.clientId || '(unset)';
    const scope = config.scope || secrets.scope || '(unset)';

    const providerShort = config.providerAgentShort || config.keycloakAgentShort || extractSsoShortName(config.providerAgent || config.keycloakAgent);
    const providerAgent = config.providerAgent || config.keycloakAgent;
    const providerLabel = providerShort && providerShort !== providerAgent
        ? `${providerAgent} (${providerShort})`
        : providerAgent;

    const databaseShort = config.databaseAgentShort || config.postgresAgentShort || extractSsoShortName(config.databaseAgent || config.postgresAgent);
    const databaseAgent = config.databaseAgent || config.postgresAgent;
    const databaseLabel = databaseShort && databaseShort !== databaseAgent
        ? `${databaseAgent} (${databaseShort})`
        : databaseAgent;

    const redirectUri = config.redirectUri || secrets.redirectUri || `http://127.0.0.1:${routerPort}/auth/callback`;
    const logoutRedirectUri = config.logoutRedirectUri || secrets.logoutRedirectUri || `http://127.0.0.1:${routerPort}/`;

    console.log('SSO: enabled');
    console.log(`  Provider agent: ${providerLabel}${providerHostPort ? ` (host port ${providerHostPort})` : ''}`);
    console.log(`  Database agent: ${databaseLabel}`);
    console.log(`  Base URL: ${baseUrl}`);
    console.log(`  Realm: ${realm}`);
    console.log(`  Client ID: ${clientId}`);
    console.log(`  Scope: ${scope}`);
    console.log(`  Redirect URI: ${redirectUri}`);
    console.log(`  Logout redirect: ${logoutRedirectUri}`);

    if (includeSecrets) {
        const clientSecretDisplay = secrets.clientSecret ? '[set]' : '(unset)';
        const adminUserDisplay = secrets.adminUser || '(unset)';
        const adminPasswordDisplay = secrets.adminPassword ? '[set]' : '(unset)';
        console.log(`  Client secret: ${clientSecretDisplay}`);
        console.log(`  Admin user: ${adminUserDisplay}`);
        console.log(`  Admin password: ${adminPasswordDisplay}`);
    }
}

async function enableSsoCommand() {
    const requiredChecks = [
        { key: 'baseUrl', label: 'Keycloak base URL', candidates: SSO_ENV_ROLE_CANDIDATES.baseUrl },
    ];
    const optionalChecks = [
        { key: 'realm', label: 'Keycloak realm', candidates: SSO_ENV_ROLE_CANDIDATES.realm },
        { key: 'clientId', label: 'Keycloak client ID', candidates: SSO_ENV_ROLE_CANDIDATES.clientId },
        { key: 'clientSecret', label: 'Keycloak client secret', candidates: SSO_ENV_ROLE_CANDIDATES.clientSecret }
    ];

    const resolved = resolveSsoEnvRoleValues();

    const missing = requiredChecks.filter(item => {
        const value = resolved[item.key];
        return !value || !String(value).trim();
    });

    if (missing.length) {
        const details = missing.map(item => item.candidates.filter(Boolean).join('/') || item.label).join(', ');
        throw new Error(`Missing required SSO environment variables: ${details}. Set them via 'ploinky var <NAME> <value>' or export them before enabling SSO.`);
    }

    const missingOptional = optionalChecks.filter(item => {
        const value = resolved[item.key];
        return !value || !String(value).trim();
    });
    if (missingOptional.length) {
        const hint = missingOptional.map(item => item.candidates.filter(Boolean).join('/')).join(', ');
        console.log(`Warning: optional SSO environment variables not set: ${hint}. Router will continue without them.`);
    }

    setSsoEnabled(true);
    console.log('✓ SSO enabled. Router will enforce Single Sign-On using existing environment variables.');
    printSsoDetails(gatherSsoStatus(), { includeSecrets: true });
}

function disableSsoCommand() {
    disableSsoConfig();
    console.log('✓ SSO disabled. Restart the workspace to return to token-based auth.');
}

function showSsoStatusCommand() {
    printSsoDetails(gatherSsoStatus(), { includeSecrets: true });
}

async function handleSsoCommand(options = []) {
    const subcommand = (options[0] || 'status').toLowerCase();
    const rest = options.slice(1);
    if (subcommand === 'enable') {
        if (rest.length > 0) {
            throw new Error('Usage: ploinky sso enable');
        }
        await enableSsoCommand();
        return;
    }
    if (subcommand === 'disable') {
        disableSsoCommand();
        return;
    }
    if (subcommand === 'status') {
        showSsoStatusCommand();
        return;
    }
    showHelp(['sso']);
}

async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'shell':
            if (!options[0]) { showHelp(); break; }
            await runShell(options[0]);
            break;
        case 'cli':
            if (!options[0]) { showHelp(); break; }
            await runCli(options[0], options.slice(1));
            break;
        // 'agent' command removed; use 'enable agent <agentName>' then 'start'
        case 'add':
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else showHelp();
            break;
        case 'vars': {
            try {
                const env = envSvc;
                let secrets = env.parseSecrets();
                if (!secrets.APP_NAME || !String(secrets.APP_NAME).trim()) {
                    try { env.setEnvVar('APP_NAME', path.basename(process.cwd())); } catch (_) { }
                }
                const tokens = ['WEBTTY_TOKEN', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN'];
                for (const t of tokens) {
                    if (!secrets[t] || !String(secrets[t]).trim()) {
                        try { env.setEnvVar(t, crypto.randomBytes(32).toString('hex')); } catch (_) { }
                    }
                }
                const merged = env.parseSecrets();
                const printOrder = ['APP_NAME', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN', 'WEBTTY_TOKEN'];
                const keys = Array.from(new Set([...printOrder, ...Object.keys(merged).sort()]));
                keys.forEach(k => console.log(`${k}=${merged[k] ?? ''}`));
            } catch (e) { console.error('Failed to list variables:', e.message); }
            break;
        }
        case 'var': {
            const assignment = parseInlineAssignmentToken(options[0]);
            const normalized = expandInlineAssignment(options).filter(item => item !== undefined);
            const name = normalized[0];
            let valueTokens = normalized.slice(1);
            if (assignment && assignment.value === '' && valueTokens.length > 1 && valueTokens[0] === '') {
                valueTokens = valueTokens.slice(1);
            }
            const value = valueTokens.join(' ');
            if (!name || !value) { showHelp(); throw new Error('Usage: var <VAR> <value>'); }
            setVar(name, value);
            break;
        }
        case 'echo': {
            if (!options[0]) { showHelp(); throw new Error('Usage: echo <VAR|$VAR>'); }
            const output = envSvc.echoVar(options[0]);
            console.log(output);
            break;
        }
        case 'update':
            if (options[0] === 'agent') await updateAgent(options[1]);
            else if (options[0] === 'repo') await updateRepo(options[1]);
            else showHelp();
            break;
        case 'refresh':
            if (options[0] === 'agent' && options[1]) await refreshAgent(options[1]); else showHelp();
            break;
        case 'enable':
            if (options[0] === 'repo') enableRepo(options[1]);
            else if (options[0] === 'agent') await enableAgent(options[1], options[2], options[3]);
            else showHelp();
            break;
        case 'expose': {
            if (!options[0]) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> [<$VAR|value>] [agentName]'); }
            const assignment = parseInlineAssignmentToken(options[0]);
            const normalized = expandInlineAssignment(options).filter(item => item !== undefined);
            const exposedName = normalized[0];
            if (!exposedName) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> [<$VAR|value>] [agentName]'); }
            const remainder = normalized.slice(1);
            let valueArg = remainder.length ? remainder.shift() : undefined;
            if (assignment && assignment.value === '' && valueArg === '' && remainder.length) {
                valueArg = remainder.shift();
            }
            let agentArg = remainder.length ? remainder.shift() : undefined;
            if (remainder.length) {
                agentArg = agentArg === undefined ? remainder.join(' ') : [agentArg, ...remainder].join(' ');
            }

            if (agentArg === undefined) {
                if (!valueArg) {
                    valueArg = undefined;
                } else if (typeof valueArg === 'string' && valueArg.startsWith('$')) {
                    // Explicit alias, keep as-is and let envSvc resolve agent from config
                    agentArg = undefined;
                } else {
                    let agentLookup = null;
                    try { agentLookup = findAgent(valueArg); } catch (_) { agentLookup = null; }
                    if (agentLookup) {
                        agentArg = valueArg;
                        valueArg = undefined;
                    }
                }
            }

            try {
                const res = envSvc.exposeEnv(exposedName, valueArg, agentArg);
                console.log(`✓ Exposed '${exposedName}' for agent '${res.agentName}'.`);
            } catch (err) {
                throw new Error(`expose failed: ${err?.message || err}`);
            }
            break;
        }
        case 'disable': {
            if (!options.length) {
                showHelp();
                break;
            }

            if (options[0] === 'repo') {
                disableRepo(options[1]);
                break;
            }

            let target = options.join(' ').trim();
            if (options[0] === 'agent') {
                target = options.slice(1).join(' ').trim();
            }

            if (!target) {
                showHelp();
                break;
            }

            try {
                const result = agentsSvc.disableAgent(target);
                switch (result.status) {
                    case 'removed':
                        console.log(`✓ Agent '${result.shortAgentName}' from repo '${result.repoName}' disabled.`);
                        break;
                    case 'not-found':
                        console.log(`Agent '${target}' is not enabled in this workspace.`);
                        break;
                    case 'static-removed':
                        console.log(`✓ Static agent '${target}' configuration cleared.`);
                        break;
                    case 'ambiguous':
                        console.log(`Agent name '${target}' is ambiguous. Please specify one of:`);
                        for (const entry of result.matches || []) {
                            console.log(`  - ${entry}`);
                        }
                        break;
                    case 'container-exists':
                        console.log(`Cannot disable agent '${result.shortAgentName}' because container '${result.containerName}' still exists. Please destroy the container before disabling the agent.`);
                        break;
                    default:
                        console.log(`No changes made for agent '${target}'.`);
                        break;
                }
            } catch (error) {
                throw new Error(`disable agent failed: ${error?.message || error}`);
            }
            break;
        }
        // 'run' legacy commands removed; use 'start', 'cli', 'shell', 'console'.
        case 'start':
            await startWorkspace(options[0], options[1], { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
            break;
        // 'route' and 'probe' commands removed (replaced by start/status and client commands)
        case 'webconsole': {
            // Alias of webtty; supports optional shell and --rotate
            const argsList = (options || []).filter(Boolean);
            let shellCandidate = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else if (!shellCandidate) {
                    shellCandidate = arg;
                }
            }
            if (shellCandidate) {
                const ok = configureWebttyShell(shellCandidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) { }
            }
            if (rotate) await refreshComponentToken('webtty');
            else ensureComponentToken('webtty');
            break;
        }
        case 'webchat': {
            const argsList = (options || []).filter(Boolean);
            let rotate = false;
            const positional = [];
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else {
                    positional.push(arg);
                }
            }

            if (rotate) refreshComponentToken('webchat');
            else ensureComponentToken('webchat');

            if (!rotate && positional.length) {
                console.warn('webchat: argument-based configuration has been removed; tokens are still managed by this command.');
            }
            break;
        }
        case 'sso':
            await handleSsoCommand(options);
            break;
        case 'webtty': {
            const argsList = (options || []).filter(Boolean);
            let shellCandidate = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else if (!shellCandidate) {
                    shellCandidate = arg;
                }
            }
            if (shellCandidate) {
                const ok = configureWebttyShell(shellCandidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) { }
            }
            if (rotate) await refreshComponentToken('webtty');
            else ensureComponentToken('webtty');
            break;
        }
        case 'dashboard': {
            const rotate = (options || []).includes('--rotate');
            if (rotate) await refreshComponentToken('dashboard');
            else ensureComponentToken('dashboard');
            break;
        }
        case 'webmeet': {
            const argsList = (options || []).filter(Boolean);
            let moderator = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                    continue;
                }
                if (!moderator) moderator = arg;
            }
            if (moderator) {
                try {
                    await enableAgent(moderator);
                    envSvc.setEnvVar('WEBMEET_AGENT', moderator);
                    console.log(`✓ Stored WebMeet moderator agent: ${moderator}`);
                } catch (e) {
                    console.error(`webmeet: failed to configure agent '${moderator}': ${e?.message || e}`);
                }
            }
            if (rotate) {
                refreshComponentToken('webmeet');
            } else {
                ensureComponentToken('webmeet');
            }
            break;
        }
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else if (options[0] === 'routes') listRoutes();
            else showHelp();
            break;
        case 'status':
            await statusWorkspace();
            break;
        case 'restart': {
            const target = (options[0] || '').trim();
            if (target && target.toLowerCase() === 'router') {
                const cfg = workspaceSvc.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) {
                    console.error('restart router: start is not configured. Run: start <staticAgent> <port> first.');
                    break;
                }
                console.log('[restart] Restarting RoutingServer (containers untouched)...');
                killRouterIfRunning();
                await startWorkspace(undefined, undefined, {
                    refreshComponentToken,
                    ensureComponentToken,
                    enableAgent,
                    killRouterIfRunning: () => { }
                });
                console.log('[restart] RoutingServer restarted.');
                break;
            }

            if (target) {
                const agentName = target;
                const { getAgentContainerName, getRuntime, isContainerRunning } = dockerSvc;
                let resolved;
                try {
                    resolved = findAgent(agentName);
                } catch (err) {
                    console.error(err?.message || `Agent '${agentName}' not found.`);
                    return;
                }

                const runtime = getRuntime();
                const containerName = getAgentContainerName(resolved.shortAgentName, resolved.repo);

                if (!isContainerRunning(containerName)) {
                    console.error(`Agent '${agentName}' is not running.`);
                    return;
                }

                console.log(`Restarting (stop/start) agent '${agentName}'...`);

                try {
                    execSync(`${runtime} stop ${containerName}`, { stdio: 'inherit' });
                } catch (e) {
                    console.error(`Failed to stop container ${containerName}: ${e.message}`);
                    return;
                }

                try {
                    execSync(`${runtime} start ${containerName}`, { stdio: 'inherit' });
                    console.log('✓ Agent restarted.');
                } catch (e) {
                    console.error(`Failed to start container ${containerName}: ${e.message}`);
                }
            } else {
                const cfg = workspaceSvc.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) { console.error('restart: start is not configured. Run: start <staticAgent> <port>'); break; }
                console.log('[restart] Stopping Router and configured agents...');
                killRouterIfRunning();
                console.log('[restart] Stopping configured agent containers...');
                const list = dockerSvc.stopConfiguredAgents();
                if (list.length) { console.log('[restart] Stopped containers:'); list.forEach(n => console.log(` - ${n}`)); }
                else { console.log('[restart] No containers to stop.'); }
                console.log('[restart] Starting workspace...');
                await startWorkspace(undefined, undefined, { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
                console.log('[restart] Done.');
            }
            break;
        }
        case 'delete':
            showHelp();
            break;
        case 'shutdown': {
            console.log('[shutdown] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[shutdown] Removing workspace containers...');
            const list = dockerSvc.destroyWorkspaceContainers();
            if (list.length) {
                console.log('[shutdown] Removed containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Destroyed ${list.length} containers from this workspace (per .ploinky/agents).`);
            break;
        }
        case 'stop': {
            console.log('[stop] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[stop] Stopping configured agent containers...');
            const list = dockerSvc.stopConfiguredAgents();
            if (list.length) {
                console.log('[stop] Stopped containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Stopped ${list.length} configured agent containers.`);
            break;
        }
        case 'destroy':
            console.log('[destroy] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[destroy] Removing all workspace containers...');
            await destroyAll();
            break;
        case 'logs': {
            const sub = options[0];
            if (sub === 'tail') {
                const kind = options[1] || 'router';
                if (kind !== 'router') { console.log('Only router logs are available.'); break; }
                await logsTail('router');
            } else if (sub === 'last') {
                const count = options[1] || '200';
                const kind = options[2];
                if (kind && kind !== 'router') { console.log('Only router logs are available.'); break; }
                showLast(count, 'router');
            } else { console.log("Usage: logs tail [router] | logs last <count>"); }
            break;
        }
        case 'clean':
            console.log('[clean] Removing all workspace containers...');
            await destroyAll();
            break;
        case 'help':
            showHelp(options);
            break;
        case 'cloud':
            console.log('Cloud commands are not available in this build.');
            break;
        case 'client': {
            await new ClientCommands().handleClientCommand(options);
            break;
        }
        default: {
            if (!isKnownCommand(command)) {
                const handled = await handleSystemCommand(command, options);
                if (!handled) {
                    await handleInvalidCommand(command, options);
                }
            } else {
                console.log(`Command '${command}' is currently not supported by this build. Type help to see available options.`);
            }
            break;
        }
    }
}

export {
    handleCommand,
    getAgentNames,
    getRepoNames,
    findAgentManifest,
    addRepo,
    enableRepo,
    disableRepo,
    listAgents,
    listRepos,
    listCurrentAgents,
    shutdownSession,
    cleanupSessionContainers,
    destroyAll
};
