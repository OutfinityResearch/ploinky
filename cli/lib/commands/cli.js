const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, execFileSync, spawn } = require('child_process');
let pty; // lazy require to enable TTY resize if available
const { PLOINKY_DIR } = require('../config');
const { debugLog } = require('../utils');
// AgentCoreClient is required lazily only by runTask to avoid hard dependency for other commands
const { showHelp } = require('../help');
// Cloud and Client command handlers are required lazily inside handleCommand

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');

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
function registerSessionContainer(name) { try { require('../docker').addSessionContainer(name); } catch (_) {} }
function cleanupSessionContainers() { try { require('../docker').cleanupSessionSet(); } catch (_) {} }

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

function newAgent(repoName, agentName, containerImage) {
    if (!repoName || !agentName) { showHelp(); throw new Error('Missing required parameters.'); }
    const repoPath = path.join(REPOS_DIR, repoName);
    if (!fs.existsSync(repoPath)) { throw new Error(`Repository '${repoName}' not found.`); }
    const agentPath = path.join(repoPath, agentName);
    if (fs.existsSync(agentPath)) { throw new Error(`Agent '${agentName}' already exists.`); }
    fs.mkdirSync(agentPath, { recursive: true });

    // Interactive prompts for manifest fields
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise(res => rl.question(`${q} [${def}]: `, ans => res(ans || def)));

    (async () => {
        const defaults = {
            container: containerImage || 'node:18-alpine',
            install: "echo 'No installation needed for buildpack Bash.'",
            update: "",
            cli: "bash",
            agent: "/agent/AgentServer.sh 'node /code/demoApi.js'",
            about: "Bash shell environment. Run any bash commands and scripts"
        };
        const container = await ask('Container image', defaults.container);
        const install = await ask('Install command', defaults.install);
        const upd = await ask('Update command', defaults.update);
        const cli = await ask('CLI command', defaults.cli);
        const agent = await ask('Agent command (persistent)', defaults.agent);
        const about = await ask('About/description', defaults.about);
        rl.close();

        const manifest = { name: agentName, container, install, update: upd, cli, agent, about, env: [] };
        fs.writeFileSync(path.join(agentPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`✓ Agent '${agentName}' created in repository '${repoName}'.`);
    })();
}

async function updateAgent(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: update agent <name>'); }
    const manifestPath = findAgentManifest(agentName);
    const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const get = (k, alt) => (current[k] != null ? current[k] : alt);
    const defaults = {
        container: get('container', current.image || 'node:18-alpine'),
        install: get('install', (current.commands?.install) || "echo 'No installation needed for buildpack Bash.'"),
        update: get('update', (current.commands?.update) || ""),
        cli: get('cli', (current.commands?.cli) || "bash"),
        agent: get('agent', (current.commands?.run) || ""),
        about: get('about', '-')
    };
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise(res => rl.question(`${q} [${def}]: `, ans => res(ans || def)));
    const container = await ask('Container image', defaults.container);
    const install = await ask('Install command', defaults.install);
    const upd = await ask('Update command', defaults.update);
    const cli = await ask('CLI command', defaults.cli);
    const agent = await ask('Agent command (persistent)', defaults.agent);
    const about = await ask('About/description', defaults.about);
    rl.close();
    const updated = { name: current.name || agentName, container, install, update: upd, cli, agent, about, env: current.env || [] };
    fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
    console.log(`✓ Updated manifest for '${agentName}'.`);
}

function addEnv(varName, varValue) {
    if (!varName || !varValue) { showHelp(); throw new Error('Missing required parameters.'); }
    const envFilePath = path.join(PLOINKY_DIR, 'secrets.env');
    const envLine = `${varName}=${varValue}`;
    if (fs.existsSync(envFilePath)) {
        fs.appendFileSync(envFilePath, `\n${envLine}`);
    } else {
        fs.writeFileSync(envFilePath, envLine);
    }
    console.log(`✓ Added secret environment variable '${varName}'.`);
}

function enableEnv(agentName, varName) {
    if (!agentName || !varName) { showHelp(); throw new Error('Missing required parameters.'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.env) manifest.env = [];
    if (!manifest.env.includes(varName)) {
        manifest.env.push(varName);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`✓ Enabled environment variable '${varName}' for agent '${agentName}'.`);
    }
}

const ENABLED_REPOS_FILE = path.join(PLOINKY_DIR, 'enabled_repos.json');
function loadEnabledRepos() {
    try {
        if (fs.existsSync(ENABLED_REPOS_FILE)) {
            const data = JSON.parse(fs.readFileSync(ENABLED_REPOS_FILE, 'utf8'));
            return Array.isArray(data) ? data : [];
        }
    } catch (_) {}
    return [];
}
function saveEnabledRepos(list) {
    try { fs.mkdirSync(PLOINKY_DIR, { recursive: true }); fs.writeFileSync(ENABLED_REPOS_FILE, JSON.stringify(list, null, 2)); } catch (_) {}
}
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

function listAgents() {
    const enabled = loadEnabledRepos();
    if (enabled.length === 0) {
        console.log('No repos enabled. Use: enable repo <name>');
        return;
    }
    for (const repo of enabled) {
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
    console.log("\nTip: to see more agents, use 'add repo <name>' or 'enable repo <name>'.");
}

function listCurrentAgents() {
    try {
        const { getAgentsRegistry } = require('../docker');
        const reg = getAgentsRegistry();
        const names = Object.keys(reg || {});
        if (!names.length) { console.log('No agents recorded for this workspace yet.'); return; }
        console.log('Current agents (from .ploinky/.agents):');
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
    const enabled = new Set(loadEnabledRepos());
    console.log('Available repositories:');
    for (const [name, info] of Object.entries(PREDEFINED_REPOS)) {
        const installed = fs.existsSync(path.join(REPOS_DIR, name));
        const flags = `${installed ? '[installed]' : ''}${enabled.has(name) ? ' [enabled]' : ''}`.trim();
        console.log(`- ${name}: ${info.url} ${flags ? ' ' + flags : ''}`);
    }
    console.log("\nUse 'add repo <name>' to install and 'enable repo <name>' to include in agent listings.");
}

function executeBashCommand(command, args) {
    const fullCommand = [command, ...args].join(' ');
    try {
        execSync(fullCommand, { stdio: 'inherit' });
    } catch (error) {}
}

function findAgentManifest(agentName) {
    if (!fs.existsSync(REPOS_DIR)) { throw new Error('No repositories found.'); }
    const repos = fs.readdirSync(REPOS_DIR).filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
    for (const repo of repos) {
        const manifestPath = path.join(REPOS_DIR, repo, agentName, 'manifest.json');
        if (fs.existsSync(manifestPath)) return manifestPath;
    }
    throw new Error(`Agent '${agentName}' not found.`);
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
    return (manifest.cli && String(manifest.cli)) || (manifest.commands && manifest.commands.cli) || '';
}


async function runTask(agentName, command, args) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.taskRunner !== 'http') {
        throw new Error(`Agent '${agentName}' is not configured for HTTP tasks.`);
    }
    const agentPath = path.dirname(manifestPath);
    const { ensureAgentCore } = require('../docker');
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

async function runBash(agentName) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const repoName = path.basename(path.dirname(agentPath));
    const { runCommandInContainer, getAgentContainerName } = require('../docker');
    try { registerSessionContainer(getAgentContainerName(agentName, repoName)); } catch (_) {}
    await runCommandInContainer(agentName, repoName, manifest, '/bin/bash', true);
}

async function runWebTTY(agentName, passwordArg, portArg) {
    if (!agentName || !passwordArg) {
        throw new Error("Usage: run webtty <agentName> <password> [port]");
    }
    // Require node-pty for a proper interactive TTY (echo, line editing, resize)
    try { pty = require('node-pty'); } catch (e) { throw new Error("'node-pty' is required for WebTTY. Install it with: (cd cli && npm install node-pty)"); }

    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const repoName = path.basename(path.dirname(agentPath));
    const { ensureAgentContainer, getRuntime, getAgentContainerName } = require('../docker');
    // Ensure container is up using docker.js and mount current working dir
    const containerName = ensureAgentContainer(agentName, repoName, manifest);
    const runtime = getRuntime();

    const numericPort = parseInt(portArg, 10);
    const port = (!isNaN(numericPort) && numericPort > 0) ? numericPort : (parseInt(process.env.WEBTTY_PORT, 10) || 8089);
    const password = String(passwordArg);

    // Use refactored modules for TTY and HTTP server
    const { createTTYSession } = require('../webtty/tty');
    const { startWebTTYServer } = require('../webtty/server');
    const ttySession = createTTYSession({ runtime, containerName, ptyLib: pty, workdir: process.cwd() });
    startWebTTYServer({ agentName, runtime, containerName, port, ttySession, password, workdir: process.cwd() });
}

async function runWeb(agentName, portArg) {
    if (!agentName) { throw new Error('Usage: run web <agentName> [port]'); }
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
        const { ensureAgentContainer } = require('../docker');
        ensureAgentContainer(agentName, repoName, manifest);
        console.log(`✓ Ensured container for static agent '${agentName}'.`);
    } catch (e) { console.error('Warning: could not ensure static container:', e.message); }
    console.log(`[Ploinky] Starting RoutingServer on port ${port}, serving static from ${agentPath}`);
    const serverPath = path.resolve(__dirname, '../../../cloud/RoutingServer.js');
    const child = require('child_process').spawn('node', [serverPath], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
    // Wait for child to run; do not exit main process
    await new Promise((resolve) => { child.on('exit', () => resolve()); });
}

async function addRoute(agentName) {
    if (!agentName) { throw new Error('Usage: route <agentName>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { ensureAgentService } = require('../docker');
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
                const { ensureAgentContainer } = require('../docker');
                ensureAgentContainer(agentName, repoName, manifest);
                console.log(`✓ Static agent container started: ${agentName}`);
            } catch (e) {
                console.error('Static container start failed:', e.message);
            }
        }
        // Start API routes containers
        const routes = (cfg.routes && typeof cfg.routes === 'object') ? cfg.routes : {};
        const { ensureAgentService } = require('../docker');
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
        console.log('Done. Start RoutingServer with: run web <agent> [port] (for static), and routes are ready.');
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
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cliBase = getCliCmd(manifest);
    if (!cliBase || !cliBase.trim()) {
        throw new Error(`Manifest for '${agentName}' has no 'cli' command.`);
    }
    const agentPath = path.dirname(manifestPath);
    const repoName = path.basename(path.dirname(agentPath));
    const { runCommandInContainer, getAgentContainerName } = require('../docker');
    const cmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
    console.log(`[run cli] ${agentName}: ${cmd}`);
    // Attach interactively for CLI as well
    try { registerSessionContainer(getAgentContainerName(agentName, repoName)); } catch (_) {}
    await runCommandInContainer(agentName, repoName, manifest, cmd, true);
}

async function runAgent(agentName) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!getAgentCmd(manifest).trim()) {
        throw new Error(`Manifest for '${agentName}' has no 'agent' command.`);
    }
    const agentPath = path.dirname(manifestPath);
    const { startAgentContainer, getRuntime } = require('../docker');
    const containerName = startAgentContainer(agentName, manifest, agentPath);
    console.log(`✓ Agent container '${containerName}' is running (persistent).`);
    try { const runtime = getRuntime(); const logs = execSync(`${runtime} logs --since 10s ${containerName}`).toString(); if (logs) console.log(logs); } catch (_) {}
}

async function refreshAgent(agentName) {
    if (!agentName) { showHelp(); throw new Error('Usage: refresh agent <name>'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const { stopAndRemove, startAgentContainer } = require('../docker');
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
    const { destroyWorkspaceContainers } = require('../docker');
    try { const n = destroyWorkspaceContainers(); console.log(`Destroyed ${n} containers from this workspace.`); }
    catch (e) { console.error('Destroy failed:', e.message); }
}

async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'add':
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else if (options[0] === 'env') addEnv(options[1], options.slice(2).join(' '));
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
            else showHelp();
            break;
        case 'disable':
            if (options[0] === 'repo') disableRepo(options[1]); else showHelp();
            break;
        case 'run':
            if (options.length === 0) { await runAll(); break; }
            if (options[0] === 'task') await runTask(options[1], options[2], options.slice(3));
            else if (options[0] === 'bash') await runBash(options[1]);
            else if (options[0] === 'cli') await runCli(options[1], options.slice(2));
            else if (options[0] === 'agent') await runAgent(options[1]);
            else if (options[0] === 'webtty') await runWebTTY(options[1], options[2], options[3]);
            else if (options[0] === 'web') await runWeb(options[1], options[2]);
            else showHelp();
            break;
        case 'route':
            if (options[0] === 'list') listRoutes();
            else if (options[0] === 'delete') deleteRoute(options[1]);
            else if (options[0] === 'add') await addRoute(options[1]);
            else await addRoute(options[0]);
            break;
        case 'probe':
            if (options[0] === 'route') await probeRoute(options[1], options.slice(2).join(' '));
            else showHelp();
            break;
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else if (options[0] === 'current-agents') listCurrentAgents();
            else if (options[0] === 'routes') listRoutes();
            else showHelp();
            break;
        case 'delete':
            if (options[0] === 'route') deleteRoute(options[1]);
            else showHelp();
            break;
        case 'shutdown':
            await shutdownSession();
            break;
        case 'destroy':
            await destroyAll();
            break;
        case 'help':
            showHelp(options);
            break;
        case 'cloud': {
            const CloudCommands = require('../cloudCommands');
            new CloudCommands().handleCloudCommand(options);
            break; }
        case 'client': {
            const ClientCommands = require('./client');
            new ClientCommands().handleClientCommand(options);
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
    newAgent,
    updateAgent,
    enableEnv,
    enableRepo,
    disableRepo,
    addEnv,
    listAgents,
    listRepos,
    listCurrentAgents,
    shutdownSession,
    cleanupSessionContainers,
    destroyAll
};
