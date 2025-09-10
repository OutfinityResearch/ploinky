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

// --- Start of Original Functions ---

const PREDEFINED_REPOS = {
    'basic':   { url: 'https://github.com/PloinkyRepos/Basic.git', description: 'Default base agents' },
    'cloud':   { url: 'https://github.com/PloinkyRepos/cloud.git', description: 'Cloud infrastructure agents (AWS, Azure, GCP, etc.)' },
    'vibe':    { url: 'https://github.com/PloinkyRepos/vibe.git', description: 'Vibe coding agents' },
    'security':{ url: 'https://github.com/PloinkyRepos/security.git', description: 'Security and scanning tools' },
    'extra':   { url: 'https://github.com/PloinkyRepos/extra.git', description: 'Additional utility agents' },
    'demo':    { url: 'https://github.com/PloinkyRepos/demo.git', description: 'Demo agents and examples' }
};

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
    let actualUrl = repoUrl;
    if (!repoUrl && PREDEFINED_REPOS[repoName.toLowerCase()]) {
        const predefined = PREDEFINED_REPOS[repoName.toLowerCase()];
        actualUrl = predefined.url;
        console.log(`Using predefined repository: ${repoName} (${predefined.description})`);
    } else if (!repoUrl) { showHelp(); throw new Error('Missing repository URL.'); }
    const repoPath = path.join(REPOS_DIR, repoName);
    if (fs.existsSync(repoPath)) { console.log(`✓ Repository '${repoName}' already exists.`); return; }
    console.log(`Cloning repository from ${actualUrl}...`);
    execSync(`git clone ${actualUrl} ${repoPath}`, { stdio: 'inherit' });
    console.log(`✓ Repository '${repoName}' added successfully.`);
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


function setEnv(varName, varValue) {
    const { SECRETS_FILE } = require('../services/config');
    if (!varName || typeof varValue !== 'string' || varValue.length === 0) { showHelp(); throw new Error('Usage: set env <VAR> <VALUE>'); }
    const envLine = `${varName}=${varValue}`;
    let current = '';
    try { if (fs.existsSync(SECRETS_FILE)) current = fs.readFileSync(SECRETS_FILE, 'utf8'); } catch (_) {}
    const lines = current ? current.split('\n').filter(Boolean) : [];
    const idx = lines.findIndex(l => l.startsWith(varName + '='));
    if (idx >= 0) lines[idx] = envLine; else lines.push(envLine);
    fs.writeFileSync(SECRETS_FILE, lines.join('\n'));
    console.log(`✓ Set secret env '${varName}'.`);
}

function enableEnv(varName, agentName) {
    if (!agentName || !varName) { showHelp(); throw new Error('Usage: enable env <VAR> <agentName>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.env) manifest.env = [];
    if (!manifest.env.includes(varName)) {
        manifest.env.push(varName);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`✓ Enabled env '${varName}' for agent '${agentName}'.`);
    }
}

const ENABLED_REPOS_FILE = require('../services/repos').ENABLED_REPOS_FILE;
function loadEnabledRepos() { return reposSvc.loadEnabledRepos(); }
function saveEnabledRepos(list) { return reposSvc.saveEnabledRepos(list); }
function enableRepo(repoName) {
    if (!repoName) throw new Error('Usage: enable repo <name>');
    if (!PREDEFINED_REPOS[repoName]) throw new Error(`Unknown repo '${repoName}'. Use 'list repos' to see options.`);
    const list = loadEnabledRepos();
    if (!list.includes(repoName)) { list.push(repoName); saveEnabledRepos(list); }
    // If repo not installed locally, clone it now (same as add repo)
    const repoPath = path.join(REPOS_DIR, repoName);
    if (!fs.existsSync(repoPath)) {
        console.log(`Repository '${repoName}' is not installed. Cloning now...`);
        try {
            const predefined = PREDEFINED_REPOS[repoName];
            const url = predefined && predefined.url ? predefined.url : null;
            if (!url) throw new Error('No URL configured for repo');
            execSync(`git clone ${url} ${repoPath}`, { stdio: 'inherit' });
            console.log(`✓ Repository '${repoName}' installed.`);
        } catch (e) {
            console.error(`Failed to clone repository '${repoName}':`, e.message);
        }
    }
    console.log(`✓ Repo '${repoName}' enabled. Use 'list agents' to view agents.`);
}
function disableRepo(repoName) {
    if (!repoName) throw new Error('Usage: disable repo <name>');
    const list = loadEnabledRepos();
    const filtered = list.filter(r => r !== repoName);
    saveEnabledRepos(filtered);
    console.log(`✓ Repo '${repoName}' disabled.`);
}

async function enableAgent(agentName) {
    if (!agentName) throw new Error('Usage: enable agent <name|repo/name>');
    // Resolve existing agent; do NOT auto-create
    const { findAgent } = require('../services/utils');
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    // Use workspace-scoped service container name
    const { getAgentContainerName } = require('../services/docker');
    const containerName = getAgentContainerName(shortAgentName, repoName);
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const cwd = process.cwd();
    const record = {
        agentName: shortAgentName,
        repoName,
        containerImage: image,
        createdAt: new Date().toISOString(),
        projectPath: cwd,
        type: 'agent',
        config: {
            binds: [ { source: cwd, target: cwd }, { source: agentLibPath, target: '/Agent' }, { source: agentPath, target: '/code' } ],
            env: [],
            ports: [ { containerPort: 7000 } ]
        }
    };
    const ws = require('../services/workspace');
    const map = ws.loadAgents();
    // Migrate any old entries for the same agent to the new key
    for (const key of Object.keys(map)) {
        const r = map[key];
        if (r && r.agentName === shortAgentName && key !== containerName) {
            try { delete map[key]; } catch(_) {}
        }
    }
    map[containerName] = record;
    ws.saveAgents(map);
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

function listRoutes() {
    try {
        const routingFile = path.resolve('.ploinky/routing.json');
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
        const routes = cfg.routes || {};
        const keys = Object.keys(routes);
        console.log('RoutingServer configuration:');
        console.log(`- port: ${cfg.port || '(default 8088 or env PORT)'}`);
        if (cfg.static && cfg.static.hostPath) {
            console.log(`- static.hostPath: ${cfg.static.hostPath}`);
        }
        if (!keys.length) {
            console.log('- routes: (none)');
            console.log("Tip: add one with 'route add <agent>' then test with 'probe route <agent>'");
            return;
        }
        console.log('- routes:');
        for (const k of keys) {
            const r = routes[k];
            console.log(`  /apis/${k} -> http://127.0.0.1:${r.hostPort || '?'} /api  (container: ${r.container || '?'})`);
        }
        console.log("Tip: probe a route with 'probe route <agent>'");
    } catch (e) {
        console.error('Failed to list routes:', e.message);
    }
}

function deleteRoute(agentName) {
    if (!agentName) { throw new Error('Usage: delete route <agentName>'); }
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
    cfg.routes = cfg.routes || {};
    if (!cfg.routes[agentName]) { console.log(`No route found for '${agentName}'.`); return; }
    delete cfg.routes[agentName];
    fs.mkdirSync(path.dirname(routingFile), { recursive: true });
    fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
    console.log(`Deleted route for '${agentName}'.`);
    console.log("Tip: run 'route list' to verify remaining routes.");
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
    const effectiveStatic = (cfg && cfg.static)
        ? cfg.static
        : (staticAgentName ? { agent: staticAgentName, port: (function(){ try { const r = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'),'utf8'))||{}; return r.port||8088; } catch(_) { return 8088; } })() } : null);
    if (effectiveStatic && effectiveStatic.agent) {
        console.log(`- Static: agent=${colorize(effectiveStatic.agent,'cyan')} port=${colorize(effectiveStatic.port,'yellow')}`);
    } else {
        console.log(colorize('- Static: (not configured)', 'yellow'));
        console.log('  Tip: start <staticAgent> <port> to configure.');
    }
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
        let running = false;
        let statusText = '';
        try {
            statusText = execSync(`${runtime} ps -a --filter name=^\/${name}$ --format "{{.Status}}"`, { stdio: 'pipe' }).toString().trim();
            const liveName = execSync(`${runtime} ps --filter name=^\/${name}$ --format "{{.Names}}"`, { stdio: 'pipe' }).toString().trim();
            running = (liveName === name);
        } catch(_) {}
        const ports = (r.config && r.config.ports ? r.config.ports.map(p => `${p.containerPort}->${p.hostPort||'?'} `).join(', ') : '');
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
        const routeInfo = (r.agentName && routes[r.agentName] && routes[r.agentName].hostPort)
          ? `  api: ${colorize('http://127.0.0.1:'+routes[r.agentName].hostPort+'/api','green')}`
          : '';
        console.log(`  • ${agentLabel}  [container: ${colorize(name,'magenta')}] ${stateStr}${routeInfo}`);
        console.log(`    image: ${colorize(r.containerImage||'?','yellow')}  repo: ${r.repoName||'?'}  cwd: ${r.projectPath||'?'}${ports? '  ports: '+colorize(ports,'blue'):''}`);
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

function findAgentManifest(agentName) {
    const { findAgent } = require('../services/utils');
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}

// --- End of Original Functions ---


// --- Start of New/Refactored Functions ---

// Container runtime helpers moved to docker.js

function getImage(manifest) {
    return manifest.container || manifest.image || 'node:18-alpine';
}
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


async function runTask(agentName, command, args) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.taskRunner !== 'http') {
        throw new Error(`Agent '${agentName}' is not configured for HTTP tasks.`);
    }
    const agentPath = path.dirname(manifestPath);
    const { ensureAgentCore } = require('../services/docker');
    const { hostPort } = await ensureAgentCore(manifest, agentPath);
    
    console.log(`[Ploinky CLI] Running task on agent '${agentName}' via http://localhost:${hostPort}`);
    const AgentCoreClient = require('../../../agentCoreClient/lib/client');
    const client = new AgentCoreClient();
    try {
        const result = await client.runTask('localhost', hostPort, command, args);
        console.log('\n[Ploinky CLI] Task completed.');
        console.log('--------------------------');
        if (result.success) {
            console.log('Status: SUCCESS');
            console.log('Result:', result.data);
        } else {
            console.error('Status: FAILED');
            console.error('Error:', result.error);
        }
        console.log('--------------------------');
    } catch (error) {
        console.error(`[Ploinky CLI] An error occurred: ${error.message}`);
    }
}

async function runSh(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: shell <agentName>'); }
    const { findAgent } = require('../services/utils');
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const { ensureAgentContainer, getRuntime, buildExecArgs } = require('../services/docker');
    const containerName = ensureAgentContainer(shortAgentName, repoName, manifest);
    const runtime = getRuntime();
    const args = buildExecArgs(containerName, process.cwd(), '/bin/sh', true);
    console.log(`[shell] attaching to ${containerName} with command: /bin/sh`);
    require('child_process').spawnSync(runtime, args, { stdio: 'inherit' });
}

async function runWebTTY(agentName, passwordArg, portArg, titleArg) {
    if (!agentName || !passwordArg) {
        throw new Error("Usage: console <agentName> <password> [port]");
    }
    // Require node-pty for a proper interactive TTY (echo, line editing, resize)
    try { pty = require('node-pty'); } catch (e) { throw new Error("'node-pty' is required for WebTTY. Install it with: (cd cli && npm install node-pty)"); }

    const manifestPath = ensureAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const repoName = path.basename(path.dirname(agentPath));
    const { ensureAgentContainer, getRuntime, getAgentContainerName } = require('../services/docker');
    // Ensure agent is registered in workspace
    try { await enableAgent(agentName); } catch (_) {}
    // Ensure persistent agent container exists and is running
    let containerName;
    try { containerName = ensureAgentContainer(agentName, repoName, manifest); } catch (_) {}
    if (!containerName) { containerName = getAgentContainerName(agentName, repoName); }
    const runtime = getRuntime();

    const numericPort = parseInt(portArg, 10);
    const port = (!isNaN(numericPort) && numericPort > 0) ? numericPort : (parseInt(process.env.WEBTTY_PORT, 10) || 8089);
    const password = String(passwordArg);
    const title = String(titleArg || agentName);

    // Use refactored modules for TTY and HTTP server
    const { createTTYFactory } = require('../webtty/tty');
    const { startWebTTYServer } = require('../webtty/server');
    let entry = getCliCmd(manifest) || 'sh';
    // Fallback to sh if manifest requests bash but image doesn't include it (e.g., alpine)
    if (entry.trim() === 'bash') entry = 'sh';
    console.log(`[console] container: ${containerName}`);
    console.log(`[console] entry: ${entry}`);
    const ttyFactory = createTTYFactory({ runtime, containerName, ptyLib: pty, workdir: process.cwd(), entry });
    startWebTTYServer({ agentName, runtime, containerName, port, ttyFactory, password, workdir: process.cwd(), entry, title });
}

async function runWeb(agentName, portArg) {
    if (!agentName) { throw new Error('Usage: route static <agentName> [port]'); }
    const manifestPath = findAgentManifest(agentName);
    const agentPath = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const port = parseInt(portArg, 10) || 8088;
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
    cfg.port = port;
    cfg.static = { agent: agentName, container: `ploinky_agent_${agentName}`, hostPath: agentPath };
    cfg.routes = cfg.routes || {};
    fs.mkdirSync(path.dirname(routingFile), { recursive: true });
    fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
    // Ensure the static agent's container is up as well
    try {
        const repoName = path.basename(path.dirname(agentPath));
        const { ensureAgentContainer } = require('../services/docker');
        ensureAgentContainer(agentName, repoName, manifest);
        console.log(`✓ Ensured container for static agent '${agentName}'.`);
    } catch (e) { console.error('Warning: could not ensure static container:', e.message); }
    console.log(`[Ploinky] Starting RoutingServer on port ${port}, serving static from ${agentPath}`);
    const serverPath = path.resolve(__dirname, '../server/RoutingServer.js');
    const child = require('child_process').spawn('node', [serverPath], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
    // Wait for child to run; do not exit main process
    await new Promise((resolve) => { child.on('exit', () => resolve()); });
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
        const staticManifestPath = ensureAgentManifest(staticAgent);
        const staticManifest = JSON.parse(fs.readFileSync(staticManifestPath, 'utf8'));
        const staticAgentPath = path.dirname(staticManifestPath);
        // Do not start a separate interactive container for the static agent here.
        cfg.port = staticPort;
        cfg.static = { agent: staticAgent, container: `ploinky_agent_${staticAgent}`, hostPath: staticAgentPath };
        // Do not ensure a separate container for the static agent; static files are served from hostPath.
        console.log(`Static: agent=${colorize(staticAgent,'cyan')} port=${colorize(staticPort,'yellow')}`);
        for (const name of names) {
            const rec = reg[name] || {}; const agentName = rec.agentName || null;
            if (!agentName) continue;
            const manifestPath = ensureAgentManifest(agentName);
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const agentPath = path.dirname(manifestPath);
            console.log(colorize(`→ Ensuring service for '${agentName}'...`, 'bold'));
            const { containerName, hostPort } = ensureAgentService(agentName, manifest, agentPath);
            console.log(`  OK: /apis/${colorize(agentName,'cyan')} -> ${colorize('http://127.0.0.1:'+hostPort+'/api','green')}  [container: ${containerName}]`);
            cfg.routes[agentName] = { container: containerName, hostPort };
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

async function addRoute(agentName) {
    if (!agentName) { throw new Error('Usage: route <agentName>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { ensureAgentService } = require('../services/docker');
    const { containerName, hostPort } = ensureAgentService(agentName, manifest, agentPath);
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
    cfg.routes = cfg.routes || {};
    cfg.routes[agentName] = { container: containerName, hostPort };
    fs.mkdirSync(path.dirname(routingFile), { recursive: true });
    fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
    console.log(`[Ploinky] Route registered: /apis/${agentName} -> http://127.0.0.1:${hostPort}/api`);
    console.log(`Tip: test it with: probe route ${agentName}`);
}

async function runAll() {
    try {
        const configPath = path.resolve('.ploinky/routing.json');
        if (!fs.existsSync(configPath)) { console.log('No routing config found at .ploinky/routing.json'); return; }
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8') || '{}');
        // Start static container if configured
        if (cfg.static && cfg.static.agent) {
            try {
                const agentName = cfg.static.agent;
                const manifestPath = findAgentManifest(agentName);
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const repoName = path.basename(path.dirname(path.dirname(manifestPath)));
                const { ensureAgentContainer } = require('../services/docker');
                ensureAgentContainer(agentName, repoName, manifest);
                console.log(`✓ Static agent container started: ${agentName}`);
            } catch (e) {
                console.error('Static container start failed:', e.message);
            }
        }
        // Start API routes containers
        const routes = (cfg.routes && typeof cfg.routes === 'object') ? cfg.routes : {};
        const { ensureAgentService } = require('../services/docker');
        for (const agentName of Object.keys(routes)) {
            try {
                const manifestPath = findAgentManifest(agentName);
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const agentPath = path.dirname(manifestPath);
                const preferred = (routes[agentName] && routes[agentName].hostPort) ? routes[agentName].hostPort : undefined;
                const { hostPort } = ensureAgentService(agentName, manifest, agentPath, preferred);
                console.log(`✓ API route container started: ${agentName} (hostPort ${hostPort})`);
            } catch (e) {
                console.error(`API route start failed for '${agentName}':`, e.message);
            }
        }
        console.log('Done. Use "start" to generate routes from .ploinky/agents and run the Router.');
    } catch (e) {
        console.error('run (all) failed:', e.message);
    }
}

async function probeRoute(agentName, payloadStr) {
    if (!agentName) { throw new Error('Usage: probe route <agentName> [jsonPayload]'); }
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
    const port = cfg.port || 8088;
    let payload;
    if (payloadStr) {
        try { payload = JSON.parse(payloadStr); } catch (_) { payload = { command: 'probe', args: payloadStr }; }
    } else {
        payload = { command: 'probe' };
    }
    console.log(`[Ploinky] Probing route: POST http://127.0.0.1:${port}/apis/${agentName}`);
    const http = require('http');
    await new Promise((resolve) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: `/apis/${agentName}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
            let buf = [];
            r.on('data', d => buf.push(d));
            r.on('end', () => { try { console.log(JSON.stringify(JSON.parse(Buffer.concat(buf).toString('utf8') || '{}'), null, 2)); } catch (_) { console.log(Buffer.concat(buf).toString('utf8')); } resolve(); });
        });
        req.on('error', (e) => { console.error('Probe failed:', e.message); resolve(); });
        req.write(JSON.stringify(payload));
        req.end();
    });
}

async function runCli(agentName, args) {
    if (!agentName) { showHelp(); throw new Error('Usage: cli <agentName> [args...]'); }
    const { findAgent } = require('../services/utils');
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cliBase = getCliCmd(manifest);
    if (!cliBase || !cliBase.trim()) { throw new Error(`Manifest for '${shortAgentName}' has no 'cli' command.`); }
    const cmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
    const { ensureAgentContainer, getRuntime, buildExecArgs } = require('../services/docker');
    const containerName = ensureAgentContainer(shortAgentName, repoName, manifest);
    const runtime = getRuntime();
    const execArgs = buildExecArgs(containerName, process.cwd(), cmd, true);
    console.log(`[cli] container: ${containerName}`);
    console.log(`[cli] command: ${cmd}`);
    console.log(`[cli] agent: ${shortAgentName}`);
    require('child_process').spawnSync(runtime, execArgs, { stdio: 'inherit' });
}

async function runAgent(agentName) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { startAgentContainer, getRuntime } = require('../services/docker');
    const containerName = startAgentContainer(agentName, manifest, agentPath);
    console.log(`✓ Agent container '${containerName}' is running (persistent).`);
    try { const runtime = getRuntime(); const logs = execSync(`${runtime} logs --since 10s ${containerName}`).toString(); if (logs) console.log(logs); } catch (_) {}
}

async function refreshAgent(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: refresh agent <name>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { stopAndRemove, startAgentContainer } = require('../services/docker');
    const containerName = `ploinky_agent_${agentName}`;
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

async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'shell':
            await runSh(options[0]);
            break;
        case 'cli':
            await runCli(options[0], options.slice(1));
            break;
        // 'agent' command removed; use 'enable agent <agentName>' then 'start'
        case 'add':
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else showHelp();
            break;
        case 'set':
            if (options[0] === 'env') setEnv(options[1], options.slice(2).join(' '));
            else showHelp();
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
            if (options[0] === 'env') enableEnv(options[1], options[2]);
            else if (options[0] === 'repo') enableRepo(options[1]);
            else if (options[0] === 'agent') await enableAgent(options[1]);
            else showHelp();
            break;
        case 'disable':
            if (options[0] === 'repo') disableRepo(options[1]); else showHelp();
            break;
        // 'run' legacy commands removed; use 'start', 'cli', 'shell', 'console'.
        case 'start':
            await startWorkspace(options[0], options[1]);
            break;
        // 'route' and 'probe' commands removed (replaced by start/status and client commands)
        case 'console':
            await runWebTTY(options[0], options[1], options[2]);
            break;
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else if (options[0] === 'current-agents') listCurrentAgents();
            else showHelp();
            break;
        case 'status':
            await statusWorkspace();
            break;
        case 'restart': {
            const ws = require('../services/workspace');
            const cfg = ws.getConfig();
            if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) { console.error('restart: start is not configured. Run: start <staticAgent> <port>'); break; }
            const { stopConfiguredAgents } = require('../services/docker');
            console.log('[restart] Stopping configured agent containers...');
            const list = stopConfiguredAgents();
            if (list.length) { console.log('[restart] Stopped containers:'); list.forEach(n => console.log(` - ${n}`)); }
            else { console.log('[restart] No containers to stop.'); }
            console.log('[restart] Starting workspace...');
            await startWorkspace();
            console.log('[restart] Done.');
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
            console.log('[destroy] Removing all workspace containers...');
            await destroyAll();
            break;
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
    setEnv,
    enableEnv,
    enableRepo,
    disableRepo,
    listAgents,
    listRepos,
    listCurrentAgents,
    shutdownSession,
    cleanupSessionContainers,
    destroyAll
};
