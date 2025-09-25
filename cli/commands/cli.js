const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
// Web console components now served via RoutingServer; local PTY handled there when available.
const { PLOINKY_DIR } = require('../services/config');
const { debugLog } = require('../services/utils');
// AgentCoreClient is required lazily only by runTask to avoid hard dependency for other commands
const { showHelp } = require('../services/help');
// Cloud and Client command handlers are required lazily inside handleCommand

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const reposSvc = require('../services/repos');
const envSvc = require('../services/secretVars');
const agentsSvc = require('../services/agents');
const { listRepos, listAgents, listCurrentAgents, listRoutes, statusWorkspace, collectAgentsSummary } = require('../services/status');
const { logsTail, showLast } = require('../services/logUtils');
const {
    startWorkspace,
    runCli,
    runShell,
    refreshAgent
} = require('../services/workspaceUtil');
const { refreshComponentToken, ensureComponentToken, getComponentToken } = require('../server/routerEnv');

// --- Start of Original Functions ---

// Track containers started in this CLI session that are not persistent agent containers
// Session tracking moved to docker.js
function registerSessionContainer(name) { try { require('../services/docker').addSessionContainer(name); } catch (_) {} }
function cleanupSessionContainers() { try { require('../services/docker').cleanupSessionSet(); } catch (_) {} }

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


function setVar(varName, valueOrAlias) {
    if (!varName || typeof valueOrAlias !== 'string' || valueOrAlias.length === 0) {
        showHelp();
        throw new Error('Usage: set <VAR> <$OTHER|value>');
    }
    // Store raw value; if it starts with '$', it becomes an alias. Resolution happens at use time.
    envSvc.setEnvVar(varName, valueOrAlias);
    console.log(`✓ Set variable '${varName}'.`);
}

const ENABLED_REPOS_FILE = require('../services/repos').ENABLED_REPOS_FILE;
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

async function enableAgent(agentName) {
    if (!agentName) throw new Error('Usage: enable agent <name|repo/name>');
    const { shortAgentName, repoName } = agentsSvc.enableAgent(agentName);
    console.log(`✓ Agent '${shortAgentName}' from repo '${repoName}' enabled. Use 'start' to start all configured agents.`);
}

function executeBashCommand(command, args) {
    const fullCommand = [command, ...args].join(' ');
    try {
        execSync(fullCommand, { stdio: 'inherit' });
    } catch (error) {}
}

function killRouterIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/router.pid');
        let stopped = false;
        // 1) Stop by recorded PID if present
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
            if (pid && !Number.isNaN(pid)) {
                try { process.kill(pid, 'SIGTERM'); console.log(`Stopped Router (pid ${pid}).`); stopped = true; } catch(_) {}
            }
            try { fs.unlinkSync(pidFile); } catch(_) {}
        }

        // 2) Fallback: detect by configured port in .ploinky/routing.json
        if (!stopped) {
            let port = 8080;
            try {
                const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
                if (routing.port) port = parseInt(routing.port, 10) || port;
            } catch(_) {}

            const tryKill = (pid) => {
                if (!pid) return false;
                try { process.kill(pid, 'SIGTERM'); console.log(`Stopped Router (port ${port}, pid ${pid}).`); return true; } catch(_) { return false; }
            };

            const findPids = () => {
                const pids = new Set();
                const { execSync } = require('child_process');
                try {
                    const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN`, { stdio: 'pipe' }).toString();
                    out.split(/\s+/).filter(Boolean).forEach(x => { const n = parseInt(x, 10); if (!Number.isNaN(n)) pids.add(n); });
                } catch(_) {}
                if (!pids.size) {
                    try {
                        const out = execSync(`ss -ltnp`, { stdio: 'pipe' }).toString();
                        out.split(/\n+/).forEach(line => {
                            if (line.includes(`:${port}`) && line.includes('pid=')) {
                                const m = line.match(/pid=(\d+)/);
                                if (m) { const n = parseInt(m[1], 10); if (!Number.isNaN(n)) pids.add(n); }
                            }
                        });
                    } catch(_) {}
                }
                return Array.from(pids);
            };

            const pids = findPids();
            for (const pid of pids) {
                if (tryKill(pid)) { stopped = true; }
            }
            if (!stopped && pids.length) {
                // try SIGKILL as last resort
                for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); console.log(`Killed Router (pid ${pid}).`); stopped = true; } catch(_) {} }
            }
        }
    } catch(_) {}
}

function findAgentManifest(agentName) {
    const { findAgent } = require('../services/utils');
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
    const allowed = new Set(['sh','zsh','dash','ksh','csh','tcsh','fish']);
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
        try { fs.accessSync(p, fs.constants.X_OK); found = p; break; } catch (_) {}
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
    const { destroyWorkspaceContainers } = require('../services/docker');
    try { const list = destroyWorkspaceContainers(); if (list.length) { console.log('Removed containers:'); list.forEach(n => console.log(` - ${n}`)); } console.log(`Destroyed ${list.length} containers from this workspace.`); }
    catch (e) { console.error('Destroy failed:', e.message); }
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
        case 'set': {
            console.log("'set' is deprecated. Use 'var <NAME> <value>' to set and 'vars' to list.");
            if (!options[0]) { // behave like 'vars'
                try {
                    const env = require('../services/secretVars');
                    const path = require('path');
                    const crypto = require('crypto');
                    let secrets = env.parseSecrets();
                    if (!secrets.APP_NAME || !String(secrets.APP_NAME).trim()) {
                        try { env.setEnvVar('APP_NAME', path.basename(process.cwd())); } catch(_) {}
                    }
                    const tokens = ['WEBTTY_TOKEN', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN'];
                    for (const t of tokens) {
                        if (!secrets[t] || !String(secrets[t]).trim()) {
                            try { env.setEnvVar(t, crypto.randomBytes(32).toString('hex')); } catch(_) {}
                        }
                    }
                    const merged = env.parseSecrets();
                    const printOrder = ['APP_NAME', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN', 'WEBTTY_TOKEN'];
                    const keys = Array.from(new Set([...printOrder, ...Object.keys(merged).sort()]));
                    keys.forEach(k => console.log(`${k}=${merged[k] ?? ''}`));
                } catch (e) { console.error('Failed to list variables:', e.message); }
            } else { // behave like 'var'
                const name = options[0];
                const value = options.slice(1).join(' ');
                setVar(name, value);
            }
            break; }
        case 'vars': {
            try {
                const env = require('../services/secretVars');
                const path = require('path');
                const crypto = require('crypto');
                let secrets = env.parseSecrets();
                if (!secrets.APP_NAME || !String(secrets.APP_NAME).trim()) {
                    try { env.setEnvVar('APP_NAME', path.basename(process.cwd())); } catch(_) {}
                }
                const tokens = ['WEBTTY_TOKEN', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN'];
                for (const t of tokens) {
                    if (!secrets[t] || !String(secrets[t]).trim()) {
                        try { env.setEnvVar(t, crypto.randomBytes(32).toString('hex')); } catch(_) {}
                    }
                }
                const merged = env.parseSecrets();
                const printOrder = ['APP_NAME', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN', 'WEBTTY_TOKEN'];
                const keys = Array.from(new Set([...printOrder, ...Object.keys(merged).sort()]));
                keys.forEach(k => console.log(`${k}=${merged[k] ?? ''}`));
            } catch (e) { console.error('Failed to list variables:', e.message); }
            break; }
        case 'var': {
            const name = options[0];
            const value = options.slice(1).join(' ');
            if (!name || !value) { showHelp(); throw new Error('Usage: var <VAR> <value>'); }
            setVar(name, value);
            break; }
        case 'echo': {
            if (!options[0]) { showHelp(); throw new Error('Usage: echo <VAR|$VAR>'); }
            const output = envSvc.echoVar(options[0]);
            console.log(output);
            break; }
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
            else if (options[0] === 'agent') await enableAgent(options[1]);
            else showHelp();
            break;
        case 'expose': {
            if (!options[0] || !options[1]) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> <$VAR|value> [agentName]'); }
            try {
                const res = envSvc.exposeEnv(options[0], options[1], options[2]);
                console.log(`✓ Exposed '${options[0]}' for agent '${res.agentName}'.`);
            } catch (err) {
                throw new Error(`expose failed: ${err?.message || err}`);
            }
            break; }
        case 'disable':
            if (options[0] === 'repo') disableRepo(options[1]); else showHelp();
            break;
        // 'run' legacy commands removed; use 'start', 'cli', 'shell', 'console'.
        case 'start':
            await startWorkspace(options[0], options[1], { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
            break;
        // 'route' and 'probe' commands removed (replaced by start/status and client commands)
        case 'webconsole': {
            // Optional shell parameter (alias of webtty)
            const candidate = options[0];
            if (candidate && !String(candidate).startsWith('-')) {
                const ok = configureWebttyShell(candidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) {}
            }
            await refreshComponentToken('webtty');
            break; }
        case 'webchat': {
            const rotate = options.includes('--rotate');
            if (rotate) refreshComponentToken('webchat');
            else ensureComponentToken('webchat');
            break; }
        case 'webtty': {
            const candidate = options[0];
            if (candidate && !String(candidate).startsWith('-')) {
                const ok = configureWebttyShell(candidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) {}
            }
            await refreshComponentToken('webtty');
            break; }
        case 'voicechat':
            console.log('voicechat: feature removed; use /webmeet instead.');
            break;
        case 'dashboard':
            await refreshComponentToken('dashboard');
            break;
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
            break; }
        case 'admin-mode':
            console.log('admin-mode is handled via the router dashboard at /dashboard.');
            break;
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
            if (options[0]) {
                const target = options[0];
                try {
                    const { findAgent } = require('../services/utils');
                    const res = findAgent(target);
                    const short = res.shortAgentName;
                    const manifest = JSON.parse(fs.readFileSync(res.manifestPath, 'utf8'));
                    const agentPath = path.dirname(res.manifestPath);
                    const { stopAndRemove, ensureAgentService, getServiceContainerName } = require('../services/docker');
                    const cname = getServiceContainerName(short);
                    try { stopAndRemove(cname); } catch(_) {}
                    const { containerName, hostPort } = ensureAgentService(short, manifest, agentPath);
                    console.log(`[restart] restarted '${short}' [container: ${containerName}]`);

                    // Update routing.json for this agent and ensure Router is running
                    try {
                        const routingFile = path.resolve('.ploinky/routing.json');
                        let cfg = { routes: {} };
                        try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch(_) {}
                        cfg.routes = cfg.routes || {};
                        const repoName = path.basename(path.dirname(agentPath));
                        cfg.routes[short] = cfg.routes[short] || {};
                        cfg.routes[short].container = containerName;
                        cfg.routes[short].hostPath = agentPath;
                        cfg.routes[short].repo = repoName;
                        cfg.routes[short].agent = short;
                        if (hostPort) cfg.routes[short].hostPort = hostPort;
                        // Preserve existing port config; fallback if missing
                        let port = 8080;
                        if (cfg && cfg.port) { port = parseInt(cfg.port, 10) || port; }
                        try {
                            const ws = require('../services/workspace');
                            const saved = ws.getConfig();
                            if (saved && saved.static && saved.static.port) {
                                port = parseInt(saved.static.port, 10) || port;
                            }
                        } catch(_) {}
                        cfg.port = port;
                        fs.mkdirSync(path.dirname(routingFile), { recursive: true });
                        fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));

                        // Ensure RoutingServer is running on configured port
                        const isRouterUp = (p) => {
                            const { execSync } = require('child_process');
                            try {
                                const out = execSync(`lsof -t -i :${p} -sTCP:LISTEN`, { stdio: 'pipe' }).toString().trim();
                                if (out) return true;
                            } catch(_) {}
                            try {
                                const out = execSync('ss -ltnp', { stdio: 'pipe' }).toString();
                                return out.includes(`:${p}`) && out.includes('LISTEN');
                            } catch(_) { return false; }
                        };
                        if (!isRouterUp(cfg.port)) {
                            const runningDir = path.resolve('.ploinky/running');
                            fs.mkdirSync(runningDir, { recursive: true });
                            const routerPath = path.resolve(__dirname, '../server/RoutingServer.js');
                            const routerPidFile = path.join(runningDir, 'router.pid');
                            const child = require('child_process').spawn(process.execPath, [routerPath], {
                                detached: true,
                                stdio: ['ignore', 'inherit', 'inherit'],
                                env: { ...process.env, PORT: String(cfg.port), PLOINKY_ROUTER_PID_FILE: routerPidFile }
                            });
                            try { fs.writeFileSync(routerPidFile, String(child.pid)); } catch(_) {}
                            child.unref();
                            console.log(`[restart] RoutingServer launched (pid ${child.pid}) on port ${cfg.port}.`);
                        }
                    } catch (e) {
                        console.error('[restart] routing update/router start failed:', e?.message||e);
                    }
                } catch (e) {
                    console.error(`[restart] ${target}: ${e?.message||e}`);
                }
            } else {
                const ws = require('../services/workspace');
                const cfg = ws.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) { console.error('restart: start is not configured. Run: start <staticAgent> <port>'); break; }
                const { stopConfiguredAgents } = require('../services/docker');
                console.log('[restart] Stopping Router and configured agents...');
                killRouterIfRunning();
                console.log('[restart] Stopping configured agent containers...');
                const list = stopConfiguredAgents();
                if (list.length) { console.log('[restart] Stopped containers:'); list.forEach(n => console.log(` - ${n}`)); }
                else { console.log('[restart] No containers to stop.'); }
                console.log('[restart] Starting workspace...');
                await startWorkspace(undefined, undefined, { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
                console.log('[restart] Done.');
            }
            break; }
        case 'delete':
            showHelp();
            break;
        case 'shutdown': {
            console.log('[shutdown] Stopping RoutingServer...');
            killRouterIfRunning();
            const { destroyWorkspaceContainers } = require('../services/docker');
            console.log('[shutdown] Removing workspace containers...');
            const list = destroyWorkspaceContainers();
            if (list.length) {
                console.log('[shutdown] Removed containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Destroyed ${list.length} containers from this workspace (per .ploinky/agents).`);
            break; }
        case 'stop': {
            console.log('[stop] Stopping RoutingServer...');
            killRouterIfRunning();
            const { stopConfiguredAgents } = require('../services/docker');
            console.log('[stop] Stopping configured agent containers...');
            const list = stopConfiguredAgents();
            if (list.length) {
                console.log('[stop] Stopped containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Stopped ${list.length} configured agent containers.`);
            break; }
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
            break; }
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
            const ClientCommands = require('./client');
            await new ClientCommands().handleClientCommand(options);
            break; }
        default:
            executeBashCommand(command, options);
    }
}

module.exports = {
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
