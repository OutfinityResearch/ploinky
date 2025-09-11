const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, execFileSync, spawn } = require('child_process');
let pty; // lazy require to enable TTY resize if available
const { PLOINKY_DIR } = require('../services/config');
const { debugLog } = require('../services/utils');
// AgentCoreClient is required lazily only by runTask to avoid hard dependency for other commands
const { showHelp } = require('../services/help');
// Cloud and Client command handlers are required lazily inside handleCommand

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const reposSvc = require('../services/repos');
const envSvc = require('../services/secretVars');
const agentsSvc = require('../services/agents');
const { applyManifestDirectives } = require('../services/bootstrapManifest');

// --- Start of Original Functions ---

const PREDEFINED_REPOS = reposSvc.getPredefinedRepos();

// Track containers started in this CLI session that are not persistent agent containers
// Session tracking moved to docker.js
function registerSessionContainer(name) { try { require('../services/docker').addSessionContainer(name); } catch (_) {} }
function cleanupSessionContainers() { try { require('../services/docker').cleanupSessionSet(); } catch (_) {} }

function getRepoNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    return fs.readdirSync(REPOS_DIR).filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
}

function getAgentNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    const agentNames = [];
    const repos = getRepoNames();
    for (const repo of repos) {
        const repoPath = path.join(REPOS_DIR, repo);
        const agents = fs.readdirSync(repoPath).filter(file => {
            const agentPath = path.join(repoPath, file);
            return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
        });
        agents.forEach(agent => agentNames.push(agent));
    }
    return [...new Set(agentNames)];
}

function addRepo(repoName, repoUrl) {
    if (!repoName) { showHelp(); throw new Error('Missing repository name.'); }
    const res = reposSvc.addRepo(repoName, repoUrl);
    if (res.status === 'exists') console.log(`✓ Repository '${repoName}' already exists.`);
    else console.log(`✓ Repository '${repoName}' added successfully.`);
}

function ensureAgentManifest(agentName) {
    try { const p = findAgentManifest(agentName); return p; } catch (_) {}
    const repo = 'basic';
    const repoPath = path.join(REPOS_DIR, repo);
    fs.mkdirSync(repoPath, { recursive: true });
    const agentPath = path.join(repoPath, agentName);
    fs.mkdirSync(agentPath, { recursive: true });
    const manifest = { name: agentName, container: 'node:18-alpine', install: "", update: "", cli: "sh", agent: "", about: `Auto-created agent '${agentName}'.`, env: [] };
    fs.writeFileSync(path.join(agentPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return path.join(agentPath, 'manifest.json');
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

function echoVar(nameOrAlias) {
    if (!nameOrAlias) { showHelp(); throw new Error('Usage: echo <VAR|$VAR>'); }
    const isAlias = String(nameOrAlias).startsWith('$');
    const varName = isAlias ? String(nameOrAlias).slice(1) : String(nameOrAlias);
    if (!varName) { console.log(''); return; }
    try {
        const rawMap = envSvc.parseSecrets();
        const raw = rawMap[varName];
        if (isAlias) {
            const resolved = envSvc.resolveVarValue(varName);
            console.log(resolved ?? '');
        } else {
            console.log(`${varName}=${raw ?? ''}`);
        }
    } catch(_) { console.log(''); }
}

// Replace: enable env => expose
async function exposeEnv(exposedName, valueOrRef, agentNameOpt) {
    if (!exposedName || !valueOrRef) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> <$VAR|value> [agentName]'); }
    let agentName = agentNameOpt;
    if (!agentName) {
        // fallback to static agent from workspace config if present
        try { const ws = require('../services/workspace'); const cfg = ws.getConfig(); if (cfg && cfg.static && cfg.static.agent) { agentName = cfg.static.agent; } } catch(_) {}
    }
    if (!agentName) throw new Error('Missing agent name. Provide [agentName] or configure static with start <agent> <port>.');
    const manifestPath = findAgentManifest(agentName);
    envSvc.updateAgentExpose(manifestPath, exposedName, valueOrRef);
    console.log(`✓ Exposed '${exposedName}' for agent '${agentName}'.`);
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

function listAgents() {
    const activeRepos = reposSvc.getActiveRepos(REPOS_DIR);
    if (!activeRepos || activeRepos.length === 0) { console.log('No repos installed. Use: add repo <name>'); return; }
    for (const repo of activeRepos) {
        const repoPath = path.join(REPOS_DIR, repo);
        const installed = fs.existsSync(repoPath);
        console.log(`\n[Repo] ${repo}${installed ? '' : ' (not installed)'}:`);
        if (!installed) { console.log('  (install with: add repo ' + repo + ')'); continue; }
        const entries = fs.readdirSync(repoPath).filter(f => fs.existsSync(path.join(repoPath, f, 'manifest.json')));
        if (entries.length === 0) { console.log('  (no agents found)'); continue; }
        for (const agent of entries) {
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(repoPath, agent, 'manifest.json'), 'utf8'));
                const about = manifest.about || '-';
                console.log(`  - ${agent}: ${about}`);
            } catch (_) {
                console.log(`  - ${agent}`);
            }
        }
    }
    console.log("\nTip: enable repos with 'enable repo <name>' to control listings. If none are enabled, installed repos are used by default.");
}

function listCurrentAgents() {
    try {
        const { getAgentsRegistry } = require('../services/docker');
        const reg = getAgentsRegistry();
        const names = Object.keys(reg || {});
        if (!names.length) { console.log('No agents recorded for this workspace yet.'); return; }
    console.log('Current agents (from .ploinky/agents):');
        for (const name of names) {
            const r = reg[name] || {};
            const type = r.type || '-';
            const agent = r.agentName || '-';
            const repo = r.repoName || '-';
            const img = r.containerImage || '-';
            const cwd = r.projectPath || '-';
            const created = r.createdAt || '-';
            const binds = (r.config && r.config.binds ? r.config.binds.length : 0);
            const envs = (r.config && r.config.env ? r.config.env.length : 0);
            const ports = (r.config && r.config.ports ? r.config.ports.map(p => `${p.containerPort}->${p.hostPort}`).join(', ') : '');
            console.log(`- ${name}`);
            console.log(`    type: ${type}  agent: ${agent}  repo: ${repo}`);
            console.log(`    image: ${img}`);
            console.log(`    created: ${created}`);
            console.log(`    cwd: ${cwd}`);
            console.log(`    binds: ${binds}  env: ${envs}${ports ? `  ports: ${ports}` : ''}`);
        }
    } catch (e) {
        console.error('Failed to list current agents:', e.message);
    }
}

function listRepos() {
    const enabled = new Set(reposSvc.loadEnabledRepos());
    console.log('Available repositories:');
    for (const [name, info] of Object.entries(PREDEFINED_REPOS)) {
        const installed = fs.existsSync(path.join(REPOS_DIR, name));
        const flags = `${installed ? '[installed]' : ''}${enabled.has(name) ? ' [enabled]' : ''}`.trim();
        console.log(`- ${name}: ${info.url} ${flags ? ' ' + flags : ''}`);
    }
    console.log("\nTip: enable repos with 'enable repo <name>'. If none are enabled, installed repos are used by default for agent listings.");
}

async function statusWorkspace() {
    const ws = require('../services/workspace');
    const reg0 = ws.loadAgents();
    // Deduplicate by agentName; prefer workspace-scoped key
    const { getAgentContainerName } = require('../services/docker');
    const byAgent = {};
    for (const [key, rec] of Object.entries(reg0 || {})) {
        if (!rec || !rec.agentName) continue;
        const a = rec.agentName; const repo = rec.repoName || '';
        const expectedKey = getAgentContainerName(a, repo);
        if (!byAgent[a]) { byAgent[a] = { key, rec }; }
        const haveExpected = byAgent[a].key === expectedKey;
        const isExpected = key === expectedKey;
        if (isExpected && !haveExpected) { byAgent[a] = { key, rec }; }
    }
    const reg = Object.fromEntries(Object.values(byAgent).map(({key, rec}) => [key, rec]));
    const cfg = ws.getConfig();
    const names = Object.keys(reg || {}).filter(k => k !== '_config');
    // Read routing to annotate API routes
    let routes = {};
    let staticAgentName = null;
    try {
        const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
        routes = routing.routes || {};
        staticAgentName = (routing.static && routing.static.agent) || null;
    } catch(_) {}
    const { colorize, ANSI } = require('../services/utils');
    console.log(colorize('Workspace status', 'bold'));
    try {
        const crypto = require('crypto');
        const path = require('path');
        const proj = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const wsid = crypto.createHash('sha256').update(process.cwd()).digest('hex').substring(0, 6);
        console.log(`- Workspace: ${colorize(proj,'cyan')} ${colorize('['+wsid+']','yellow')}`);
    } catch(_) {}
    const effectiveStatic = (cfg && cfg.static)
        ? cfg.static
        : (staticAgentName ? { agent: staticAgentName, port: (function(){ try { const r = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'),'utf8'))||{}; return r.port||8088; } catch(_) { return 8088; } })() } : null);
    if (effectiveStatic && effectiveStatic.agent) {
        console.log(`- Static: agent=${colorize(effectiveStatic.agent,'cyan')} port=${colorize(effectiveStatic.port,'yellow')}`);
    } else {
        console.log(colorize('- Static: (not configured)', 'yellow'));
        console.log('  Tip: start <staticAgent> <port> to configure.');
    }
    // Web servers status (Console/Chat/Dashboard)
    try {
        const env = require('../services/secretVars');
        const webPorts = {
            console: (function(){ const v = parseInt(env.resolveVarValue('WEBTTY_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:9001; })(),
            chat: (function(){ const v = parseInt(env.resolveVarValue('WEBCHAT_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:8080; })(),
            dashboard: (function(){ const v = parseInt(env.resolveVarValue('WEBDASHBOARD_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:9000; })(),
        };
        const check = (name, file, port) => {
            try {
                const pidFile = path.resolve('.ploinky/running/'+file);
                if (fs.existsSync(pidFile)) {
                    const pid = parseInt(fs.readFileSync(pidFile,'utf8').trim(),10);
                    if (pid && !Number.isNaN(pid)) {
                        try { process.kill(pid, 0); console.log(`- ${name}: running (pid ${pid}) on port ${port}`); }
                        catch { console.log(`- ${name}: not running (stale pid ${pid}); expected port ${port}`); }
                    } else { console.log(`- ${name}: (no pid); expected port ${port}`); }
                } else { console.log(`- ${name}: (not running); expected port ${port}`); }
            } catch(_) { console.log(`- ${name}: (unknown); expected port ${port}`); }
        };
        check('Dashboard', 'dashboard.pid', webPorts.dashboard);
        check('Console', 'webtty.pid', webPorts.console);
        check('Chat', 'webchat.pid', webPorts.chat);
    } catch(_) {}

    // Router status
    try {
        const pidFile = path.resolve('.ploinky/running/router.pid');
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile,'utf8').trim(),10);
            if (pid && !Number.isNaN(pid)) {
                try { process.kill(pid, 0); console.log(`- Router: running (pid ${pid})`); }
                catch { console.log(`- Router: not running (stale pid ${pid})`); }
            } else { console.log('- Router: (no pid)'); }
        } else { console.log('- Router: (not running)'); }
    } catch(_) { console.log('- Router: (unknown)'); }

    if (!names.length) { console.log('- Agents: (none enabled)'); return; }
    console.log(colorize('- Agents:', 'bold'));
    const { getRuntime } = require('../services/docker');
    const runtime = getRuntime();
    const execSync = require('child_process').execSync;
    for (const name of names) {
        const r = reg[name] || {};
        const agentName = r.agentName;
        const route = (agentName && routes[agentName]) ? routes[agentName] : null;
        // Prefer service container from routing; fallback to interactive registry key
        const displayContainer = (route && route.container) ? route.container : name;
        let running = false;
        let statusText = '';
        try {
            statusText = execSync(`${runtime} ps -a --filter name=^\/${displayContainer}$ --format "{{.Status}}"`, { stdio: 'pipe' }).toString().trim();
            const liveName = execSync(`${runtime} ps --filter name=^\/${displayContainer}$ --format "{{.Names}}"`, { stdio: 'pipe' }).toString().trim();
            running = (liveName === displayContainer);
        } catch(_) {}
        // Ports: prefer routing hostPort mapping (7000->hostPort). Fallback to registry ports.
        const ports = (route && route.hostPort) ? (`7000->${route.hostPort}`) : ((r.config && r.config.ports ? r.config.ports.map(p => `${p.containerPort}->${p.hostPort||'?'} `).join(', ') : ''));
        let stateStr;
        if (running) {
            stateStr = colorize('(running)', 'green');
        } else if (statusText && /exited/i.test(statusText)) {
            const codeMatch = statusText.match(/exited \((\d+)\)/i);
            const code = codeMatch ? codeMatch[1] : '?';
            stateStr = colorize(`(exited code ${code})`, 'red');
        } else if (statusText) {
            stateStr = colorize(`(${statusText})`, 'yellow');
        } else {
            stateStr = colorize('(stopped)', 'red');
        }
        const agentLabel = (r.agentName===staticAgentName) ? `${colorize(r.agentName,'cyan')} ${colorize('[static]','yellow')}` : colorize(r.agentName||'?','cyan');
        const routeInfo = (route && route.hostPort)
          ? `  api: ${colorize('http://127.0.0.1:'+route.hostPort+'/api','green')}`
          : '';
        console.log(`  • ${agentLabel}  [container: ${colorize(displayContainer,'magenta')}] ${stateStr}${routeInfo}`);
        console.log(`    image: ${colorize(r.containerImage||'?','yellow')}  repo: ${r.repoName||'?'}  cwd: ${r.projectPath||'?'}${ports? '  ports: '+colorize(ports,'blue'):''}`);
        // Show exposed env var names
        let envNames = [];
        try { if (Array.isArray(r?.config?.env)) envNames = r.config.env.map(e => e && e.name).filter(Boolean); } catch(_) {}
        if (!envNames.length) {
            try {
                const manifestPath = findAgentManifest(r.agentName);
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const { getExposedNames } = require('../services/secretVars');
                envNames = getExposedNames(manifest) || [];
            } catch(_) {}
        }
        if (envNames.length) {
            console.log(`    env expose: ${envNames.join(', ')}`);
        }
        if (!running && statusText && /exited/i.test(statusText)) {
            console.log(colorize('    hint: container exited. Check your agent command or base image.', 'yellow'));
            console.log(colorize('          - If using default supervisor, ensure the image provides `node` for /Agent/AgentServer.js', 'yellow'));
            console.log(colorize('          - Or set `agent` in manifest.json to a valid long-running command', 'yellow'));
            console.log(colorize('          - Debug with: p-cli cli <agentName> or p-cli shell <agentName>', 'yellow'));
            const rt = require('../services/docker').getRuntime();
            console.log(colorize(`          - Inspect logs: ${rt} logs ${name}`, 'yellow'));
        }
    }
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
            let port = 8088;
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

function killWebTTYIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/webtty.pid');
        if (!fs.existsSync(pidFile)) return;
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (pid && !Number.isNaN(pid)) {
            try { process.kill(pid, 'SIGTERM'); console.log(`Stopped WebTTY (pid ${pid}).`); } catch(_) {}
        }
        try { fs.unlinkSync(pidFile); } catch(_) {}
    } catch(_) {}
}

function killWebChatIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/webchat.pid');
        if (!fs.existsSync(pidFile)) return;
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (pid && !Number.isNaN(pid)) {
            try { process.kill(pid, 'SIGTERM'); console.log(`Stopped WebChat (pid ${pid}).`); } catch(_) {}
        }
        try { fs.unlinkSync(pidFile); } catch(_) {}
    } catch(_) {}
}

function killDashboardIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/dashboard.pid');
        if (!fs.existsSync(pidFile)) return;
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (pid && !Number.isNaN(pid)) {
            try { process.kill(pid, 'SIGTERM'); console.log(`Stopped Dashboard (pid ${pid}).`); } catch(_) {}
        }
        try { fs.unlinkSync(pidFile); } catch(_) {}
    } catch(_) {}
}

function findAgentManifest(agentName) {
    const { findAgent } = require('../services/utils');
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}

// --- End of Original Functions ---


// --- Start of New/Refactored Functions ---

// Container runtime helpers moved to docker.js
function getAgentCmd(manifest) {
    return (manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '';
}
function getCliCmd(manifest) {
    return (
        (manifest.cli && String(manifest.cli)) ||
        (manifest.commands && manifest.commands.cli) ||
        (manifest.run && String(manifest.run)) ||
        (manifest.commands && manifest.commands.run) ||
        ''
    );
}



async function runConsole(passwordArg, ...cmdTokens) {
    if (!passwordArg) { throw new Error("Usage: console <password> [command...]\nExample: console mypass p-cli shell MyAgent\n         console mypass /bin/bash"); }
    // Require node-pty for a proper interactive TTY
    try { pty = require('node-pty'); } catch (e) { throw new Error("'node-pty' is required for WebTTY. Install it with: (cd cli && npm install node-pty)"); }
    const command = (cmdTokens && cmdTokens.length) ? cmdTokens.join(' ') : (process.env.SHELL || '/bin/bash');
    const mode = (process.env.WEBTTY_MODE || 'console');
    // Internal config-driven ports
    let port;
    try {
        const env = require('../services/secretVars');
        if (mode === 'chat') {
            const v = parseInt(env.resolveVarValue('WEBCHAT_PORT'), 10);
            port = (!Number.isNaN(v) && v > 0) ? v : 8080;
        } else { // console
            const v = parseInt(env.resolveVarValue('WEBTTY_PORT'), 10);
            port = (!Number.isNaN(v) && v > 0) ? v : 9001;
        }
    } catch(_) { port = (mode === 'chat') ? 8080 : 9001; }
    const password = String(passwordArg);
    let title = 'Local Console';
    try { const env = require('../services/secretVars'); const t = env.resolveVarValue('WEBTTY_TITLE'); if (t && String(t).trim()) title = String(t); } catch(_) {}

    const { createLocalTTYFactory } = require('../webtty/tty');
    const { startWebTTYServer } = require('../webtty/server');
    console.log(`[console] local command: ${command}`);
    const ttyFactory = createLocalTTYFactory({ ptyLib: pty, workdir: process.cwd(), command });
    const srv = startWebTTYServer({ agentName: 'local', runtime: 'local', containerName: '-', port, ttyFactory, password, workdir: process.cwd(), entry: command, title, mode });
    try {
        srv.on('listening', () => {
            try {
                const runningDir = path.resolve('.ploinky/running');
                fs.mkdirSync(runningDir, { recursive: true });
                const pidName = (mode === 'chat') ? 'webchat.pid' : 'webtty.pid';
                fs.writeFileSync(path.join(runningDir, pidName), String(process.pid));
            } catch(_) {}
        });
        srv.on('error', (e) => {
            console.error(`[webtty] Failed to start on port ${port}: ${e?.message || e}`);
            console.error('Tip: set WEBTTY_PORT to a free port or stop the existing server.');
        });
    } catch(_) {}
}

async function startWorkspace(staticAgentArg, portArg) {
    try {
        const ws = require('../services/workspace');
        if (staticAgentArg) {
            const portNum = parseInt(portArg || '0', 10) || 8088;
            const cfg = ws.getConfig() || {};
            cfg.static = { agent: staticAgentArg, port: portNum };
            ws.setConfig(cfg);
        }
        const cfg0 = ws.getConfig() || {};
        if (!cfg0.static || !cfg0.static.agent || !cfg0.static.port) {
            console.error('start: missing static agent or port. Usage: start <staticAgent> <port> (first time).');
            return;
        }
        // New: apply manifest directives from static agent (repos + enable)
        try { await applyManifestDirectives(cfg0.static.agent); } catch (_) {}
        let reg = ws.loadAgents();
        // Deduplicate entries by agentName; prefer the workspace-scoped key from getAgentContainerName
        const { getAgentContainerName } = require('../services/docker');
        const byAgent = {};
        for (const [key, rec] of Object.entries(reg || {})) {
            if (!rec || !rec.agentName) continue;
            const a = rec.agentName; const repo = rec.repoName || '';
            const expectedKey = getAgentContainerName(a, repo);
            if (!byAgent[a]) { byAgent[a] = { key, rec }; }
            const haveExpected = byAgent[a].key === expectedKey;
            const isExpected = key === expectedKey;
            if (isExpected && !haveExpected) { byAgent[a] = { key, rec }; }
        }
        // Write back deduped map, preserving config
        const dedup = Object.fromEntries(Object.values(byAgent).map(({key, rec}) => [key, rec]));
        const preservedCfg = ws.getConfig();
        if (preservedCfg && Object.keys(preservedCfg).length) dedup._config = preservedCfg;
        ws.saveAgents(dedup);
        reg = dedup;
        const names = Object.keys(reg || {});
        const { ensureAgentService, ensureAgentContainer } = require('../services/docker');
        const routingFile = path.resolve('.ploinky/routing.json');
        let cfg = { routes: {} };
        try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch (_) {}
        cfg.routes = cfg.routes || {};
        const { colorize } = require('../services/utils');
        const staticAgent = cfg0.static.agent;
        const staticPort = cfg0.static.port;
        // Resolve static agent strictly; do not auto-create if missing
        let staticManifestPath = null;
        let staticAgentPath = null;
        try {
            const { findAgent } = require('../services/utils');
            const res = findAgent(staticAgent);
            staticManifestPath = res.manifestPath;
            staticAgentPath = path.dirname(staticManifestPath);
        } catch (e) {
            console.error(`start: static agent '${staticAgent}' not found in any repo. Use 'enable agent <repo/name>' or check repos.`);
            return;
        }
        // Do not start a separate interactive container for the static agent here.
        cfg.port = staticPort;
        const { getServiceContainerName } = require('../services/docker');
        cfg.static = { agent: staticAgent, container: getServiceContainerName(staticAgent), hostPath: staticAgentPath };
        // Do not ensure a separate container for the static agent; static files are served from hostPath.
        console.log(`Static: agent=${colorize(staticAgent,'cyan')} port=${colorize(staticPort,'yellow')}`);
        const missing = [];
        for (const name of names) {
            const rec = reg[name] || {}; const agentName = rec.agentName || null;
            if (!agentName) continue;
            // Resolve agent strictly; error if not found
            let manifestPath;
            let manifest;
            let agentPath;
            try {
                const { findAgent } = require('../services/utils');
                const res = findAgent(agentName);
                manifestPath = res.manifestPath;
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                agentPath = path.dirname(manifestPath);
            } catch (e) {
                missing.push(agentName);
                continue;
            }
            console.log(colorize(`→ Ensuring service for '${agentName}'...`, 'bold'));
            const { containerName, hostPort } = ensureAgentService(agentName, manifest, agentPath);
            console.log(`  OK: /apis/${colorize(agentName,'cyan')} -> ${colorize('http://127.0.0.1:'+hostPort+'/api','green')}  [container: ${containerName}]`);
            cfg.routes[agentName] = { container: containerName, hostPort };
        }
        if (missing.length) {
            throw new Error(`Missing agents in repos: ${missing.join(', ')}. Enable/add them before 'start'.`);
        }
        fs.mkdirSync(path.dirname(routingFile), { recursive: true });
        fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
        console.log('✓ Routes updated from .ploinky/agents');

        // Start RoutingServer attached
        // Ensure any previously running router is stopped to avoid EADDRINUSE
        try { killRouterIfRunning(); } catch(_) {}
        const port = parseInt(cfg.port || process.env.ROUTER_PORT || '8088', 10);
        console.log(`[Ploinky] Starting RoutingServer on port ${port}`);
        const serverPath = path.resolve(__dirname, '../server/RoutingServer.js');
        const child = require('child_process').spawn('node', [serverPath], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
        try {
            const runningDir = path.resolve('.ploinky/running');
            fs.mkdirSync(runningDir, { recursive: true });
            fs.writeFileSync(path.join(runningDir, 'router.pid'), String(child.pid));
        } catch(_) {}
        await new Promise((resolve) => { child.on('exit', () => resolve()); });
    } catch (e) {
        console.error('start (workspace) failed:', e.message);
    }
}

async function runCli(agentName, args) {
    if (!agentName) { showHelp(); throw new Error('Usage: cli <agentName> [args...]'); }
    const { findAgent } = require('../services/utils');
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cliBase = getCliCmd(manifest);
    if (!cliBase || !cliBase.trim()) { throw new Error(`Manifest for '${shortAgentName}' has no 'cli' command.`); }
    const cmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
    const { ensureAgentService, attachInteractive } = require('../services/docker');
    const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
    const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
    console.log(`[cli] container: ${containerName}`);
    console.log(`[cli] command: ${cmd}`);
    console.log(`[cli] agent: ${shortAgentName}`);
    attachInteractive(containerName, process.cwd(), cmd);
}

async function runShell(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: shell <agentName>'); }
    const { findAgent } = require('../services/utils');
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const { ensureAgentService, attachInteractive } = require('../services/docker');
    const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
    const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
    const cmd = '/bin/sh';
    console.log(`[shell] container: ${containerName}`);
    console.log(`[shell] command: ${cmd}`);
    console.log(`[shell] agent: ${shortAgentName}`);
    attachInteractive(containerName, process.cwd(), cmd);
}

async function refreshAgent(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: refresh agent <name>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { stopAndRemove, startAgentContainer, getServiceContainerName } = require('../services/docker');
    const containerName = getServiceContainerName(agentName);
    stopAndRemove(containerName);
    const agentCmd = getAgentCmd(manifest).trim();
    if (agentCmd) { console.log('Restarting agent container...'); startAgentContainer(agentName, manifest, agentPath); console.log('✓ Agent restarted.'); }
    else { console.log('No agent command configured; container removed if present.'); }
}

async function shutdownSession() {
    try { cleanupSessionContainers(); } catch (e) { debugLog('shutdown error:', e.message); }
    console.log('Shutdown completed for current session containers.');
}

async function destroyAll() {
    const { destroyWorkspaceContainers } = require('../services/docker');
    try { const list = destroyWorkspaceContainers(); if (list.length) { console.log('Removed containers:'); list.forEach(n => console.log(` - ${n}`)); } console.log(`Destroyed ${list.length} containers from this workspace.`); }
    catch (e) { console.error('Destroy failed:', e.message); }
}

function getLogPath(kind) {
    const base = path.resolve('.ploinky/logs');
    const map = { router: 'router.log', webtty: 'webtty.log' };
    const file = map[kind] || map.router;
    return path.join(base, file);
}

async function logsTail(kind) {
    const file = getLogPath(kind);
    if (!fs.existsSync(file)) { console.log(`No log file yet: ${file}`); return; }
    try {
        const { spawn } = require('child_process');
        const p = spawn('tail', ['-f', file], { stdio: 'inherit' });
        await new Promise(resolve => p.on('exit', resolve));
    } catch (_) {
        // Fallback: simple watcher
        console.log(`Following ${file} (fallback watcher). Stop with Ctrl+C.`);
        let pos = fs.statSync(file).size;
        const fd = fs.openSync(file, 'r');
        const loop = () => {
            try {
                const st = fs.statSync(file);
                if (st.size > pos) {
                    const len = st.size - pos; const buf = Buffer.alloc(len);
                    fs.readSync(fd, buf, 0, len, pos); process.stdout.write(buf.toString('utf8'));
                    pos = st.size;
                }
            } catch(_) {}
            setTimeout(loop, 1000);
        };
        loop();
    }
}

function showLast(count, kind) {
    const n = Math.max(1, parseInt(count || '200', 10) || 200);
    const file = kind ? getLogPath(kind) : null;
    const list = file ? [file] : [getLogPath('router'), getLogPath('webtty')];
    for (const f of list) {
        if (!fs.existsSync(f)) { console.log(`No log file: ${f}`); continue; }
        try {
            const { spawnSync } = require('child_process');
            const r = spawnSync('tail', ['-n', String(n), f], { stdio: 'inherit' });
            if (r.status !== 0) throw new Error('tail failed');
        } catch (e) {
            // Fallback: read file and slice lines
            try {
                const data = fs.readFileSync(f, 'utf8');
                const lines = data.split('\n');
                const chunk = lines.slice(-n).join('\n');
                console.log(chunk);
            } catch (e2) { console.error(`Failed to read ${f}: ${e2.message}`); }
        }
    }
}

async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'shell':
            await runShell(options[0]);
            break;
        case 'cli':
            await runCli(options[0], options.slice(1));
            break;
        // 'agent' command removed; use 'enable agent <agentName>' then 'start'
        case 'add':
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else showHelp();
            break;
        case 'set': {
            const defaults = ['WEBTTY_PORT', 'WEBCHAT_PORT', 'WEBDASHBOARD_PORT', 'WEBTTY_TITLE'];
            if (!options[0]) {
                try {
                    const env = require('../services/secretVars');
                    const map = env.parseSecrets();
                    for (const k of defaults) { if (!Object.prototype.hasOwnProperty.call(map, k)) { env.declareVar(k); } }
                    const merged = env.parseSecrets();
                    Object.keys(merged).sort().forEach(k => console.log(`${k}=${merged[k] ?? ''}`));
                } catch (e) { console.error('Failed to list variables:', e.message); }
            } else {
                const name = options[0];
                const value = options.slice(1).join(' ');
                setVar(name, value);
                if (name === 'WEBTTY_PORT' || name === 'WEBCHAT_PORT' || name === 'WEBDASHBOARD_PORT') {
                    console.log(`Hint: restart the respective server to apply ${name}.`);
                }
            }
            break; }
        case 'echo':
            echoVar(options[0]);
            break;
        case 'new':
            if (options[0] === 'agent') newAgent(options[1], options[2], options[3]);
            else showHelp();
            break;
        case 'update':
            if (options[0] === 'agent') await updateAgent(options[1]); else showHelp();
            break;
        case 'refresh':
            if (options[0] === 'agent') await refreshAgent(options[1]); else showHelp();
            break;
        case 'enable':
            if (options[0] === 'repo') enableRepo(options[1]);
            else if (options[0] === 'agent') await enableAgent(options[1]);
            else showHelp();
            break;
        case 'expose':
            await exposeEnv(options[0], options[1], options[2]);
            break;
        case 'disable':
            if (options[0] === 'repo') disableRepo(options[1]); else showHelp();
            break;
        // 'run' legacy commands removed; use 'start', 'cli', 'shell', 'console'.
        case 'start':
            await startWorkspace(options[0], options[1]);
            break;
        // 'route' and 'probe' commands removed (replaced by start/status and client commands)
        case 'webconsole':
            // Synonym for 'webtty' (console-only server)
            process.env.WEBTTY_MODE = 'console';
            await runConsole(options[0], ...options.slice(1));
            break;
        case 'webchat':
            process.env.WEBTTY_MODE = 'chat';
            await runConsole(options[0], ...options.slice(1));
            break;
        case 'webtty':
            process.env.WEBTTY_MODE = 'console';
            await runConsole(options[0], ...options.slice(1));
            break;
        case 'dashboard': {
            const password = options[0];
            if (!password) { throw new Error("Usage: dashboard <password>"); }
            const mode = 'dashboard';
            let port;
            try { const env = require('../services/secretVars'); const v = parseInt(env.resolveVarValue('WEBDASHBOARD_PORT'), 10); port = (!Number.isNaN(v) && v > 0) ? v : 9000; } catch(_) { port = 9000; }
            const { startWebTTYServer } = require('../webtty/server');
            const srv = startWebTTYServer({ agentName: 'local', runtime: 'local', containerName: '-', port, ttyFactory: null, password: String(password), workdir: process.cwd(), entry: '', title: 'Dashboard', mode });
            try {
                srv.on('listening', () => {
                    try {
                        const runningDir = path.resolve('.ploinky/running');
                        fs.mkdirSync(runningDir, { recursive: true });
                        fs.writeFileSync(path.join(runningDir, 'dashboard.pid'), String(process.pid));
                    } catch(_) {}
                });
            } catch(_) {}
            break; }
        case 'admin-mode': {
            const sub = options[0];
            if (sub === 'task') { const ClientCommands = require('./client'); await new ClientCommands().handleClientCommand(['task', ...options.slice(1)]); break; }
            const password = options[0];
            if (!password) { throw new Error("Usage: admin-mode <password> [command...]\nStarts: webtty (console), webchat (chat), dashboard"); }
            const cmd = (options.slice(1).length ? options.slice(1) : [(process.env.SHELL || '/bin/bash')]);
            const nodeBin = process.argv[0];
            const cliPath = path.resolve(__dirname, '../index.js');
            const env = require('../services/secretVars');
            const ports = {
                webtty: (()=>{ const v = parseInt(env.resolveVarValue('WEBTTY_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:9001; })(),
                webchat: (()=>{ const v = parseInt(env.resolveVarValue('WEBCHAT_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:8080; })(),
                dashboard: (()=>{ const v = parseInt(env.resolveVarValue('WEBDASHBOARD_PORT'),10); return (!Number.isNaN(v)&&v>0)?v:9000; })(),
            };
            const procs = [];
            const spawnOne = (args, extraEnv = {}) => {
                const p = spawn(nodeBin, [cliPath, ...args], { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
                procs.push(p);
                return p;
            };
            spawnOne(['webtty', password, ...cmd], { WEBTTY_PORT: String(ports.webtty) });
            spawnOne(['webchat', password, ...cmd], { WEBCHAT_PORT: String(ports.webchat) });
            spawnOne(['dashboard', password], { WEBDASHBOARD_PORT: String(ports.dashboard) });
            break; }
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
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
                    const { containerName } = ensureAgentService(short, manifest, agentPath);
                    console.log(`[restart] restarted '${short}' [container: ${containerName}]`);
                } catch (e) {
                    console.error(`[restart] ${target}: ${e?.message||e}`);
                }
            } else {
                const ws = require('../services/workspace');
                const cfg = ws.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) { console.error('restart: start is not configured. Run: start <staticAgent> <port>'); break; }
                const { stopConfiguredAgents } = require('../services/docker');
                console.log('[restart] Stopping Web servers and Router...');
                killWebTTYIfRunning();
                killWebChatIfRunning();
                killDashboardIfRunning();
                killRouterIfRunning();
                console.log('[restart] Stopping configured agent containers...');
                const list = stopConfiguredAgents();
                if (list.length) { console.log('[restart] Stopped containers:'); list.forEach(n => console.log(` - ${n}`)); }
                else { console.log('[restart] No containers to stop.'); }
                console.log('[restart] Starting workspace...');
                await startWorkspace();
                console.log('[restart] Done.');
            }
            break; }
        case 'delete':
            showHelp();
            break;
        case 'shutdown': {
            console.log('[shutdown] Stopping Web servers and RoutingServer...');
            killWebTTYIfRunning();
            killWebChatIfRunning();
            killDashboardIfRunning();
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
            console.log('[stop] Stopping Web servers and RoutingServer...');
            killWebTTYIfRunning();
            killWebChatIfRunning();
            killDashboardIfRunning();
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
            console.log('[destroy] Stopping Web servers and RoutingServer...');
            killWebTTYIfRunning();
            killWebChatIfRunning();
            killDashboardIfRunning();
            killRouterIfRunning();
            console.log('[destroy] Removing all workspace containers...');
            await destroyAll();
            break;
        case 'logs': {
            const sub = options[0];
            if (sub === 'tail') {
                const kind = options[1] || 'router';
                await logsTail(kind);
            } else if (sub === 'last') {
                const count = options[1] || '200';
                const kind = options[2];
                showLast(count, kind);
            } else { console.log("Usage: logs tail <router|webtty> | logs last <count> [router|webtty]"); }
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
