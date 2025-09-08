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
    'cloud': { url: 'https://github.com/PlonkyRepos/cloud.git', description: 'Cloud infrastructure agents (AWS, Azure, GCP, etc.)' },
    'vibe': { url: 'https://github.com/PlonkyRepos/vibe.git', description: 'Social media and communication agents' },
    'security': { url: 'https://github.com/PlonkyRepos/security.git', description: 'Security and scanning tools' },
    'extra': { url: 'https://github.com/PlonkyRepos/extra.git', description: 'Additional utility agents' }
};

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
    const manifest = { name: agentName, image: containerImage || 'node:18-alpine', commands: { install: "", update: "", run: "" }, env: [] };
    fs.writeFileSync(path.join(agentPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✓ Agent '${agentName}' created in repository '${repoName}'.`);
}

function setCommand(commandType, agentName, command) {
    if (!commandType || !agentName || !command) { showHelp(); throw new Error('Missing required parameters.'); }
    const validCommandTypes = ['install', 'update', 'run'];
    if (!validCommandTypes.includes(commandType)) { throw new Error('Invalid command type.'); }
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.commands[commandType] = command;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✓ Set ${commandType} command for '${agentName}'.`);
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

function listAgents() {
    console.log('Listing agents...'); // Simplified for brevity
}

function listRepos() {
    console.log('Listing repos...'); // Simplified for brevity
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

function getContainerRuntime() {
    try {
        execSync('which podman', { stdio: 'pipe' });
        return 'podman';
    } catch {
        try {
            execSync('which docker', { stdio: 'pipe' });
            return 'docker';
        } catch {
            throw new Error('No container runtime found. Please install Docker or Podman.');
        }
    }
}

// Ensure a generic agent container is running for interactive shells/web TTY
async function ensureAgentContainerRunning(agentName, manifest, agentPath) {
    const runtime = getContainerRuntime();
    const containerName = `ploinky_agent_${agentName}`;

    // If running, return
    try {
        const running = execSync(`${runtime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
        if (running === containerName) return;
    } catch (_) {}

    // If exists but stopped, start
    try {
        const exists = execSync(`${runtime} ps -a --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
        if (exists === containerName) {
            execSync(`${runtime} start ${containerName}`);
            await new Promise(r => setTimeout(r, 800));
            return;
        }
    } catch (_) {}

    // Create new container
    const image = manifest.image || 'node:18-alpine';
    const args = [
        'run', '-d', '--name', containerName,
        '-w', '/agent',
        '-v', `${agentPath}:/agent:z`,
        '-v', `${agentPath}:/code:z`
    ];
    // Start process: prefer configured run command; else sleep infinity
    const runCmd = (manifest.commands && manifest.commands.run) ? manifest.commands.run : '';
    if (runCmd && runCmd.trim()) {
        args.push(image, '/bin/sh', '-lc', runCmd);
    } else {
        args.push(image, 'sleep', 'infinity');
    }
    execFileSync(runtime, args, { stdio: 'inherit' });
    await new Promise(r => setTimeout(r, 800));
}

async function ensureContainerRunning(manifest, agentPath) {
    const runtime = getContainerRuntime();
    const containerName = `ploinky_agent_${manifest.name}`;
    const portFilePath = path.join(PLOINKY_DIR, 'running_agents', `${containerName}.port`);
    const lockDir = path.join(PLOINKY_DIR, 'locks');
    const lockFile = path.join(lockDir, `container_${containerName}.lock`);

    // Acquire Lock
    fs.mkdirSync(lockDir, { recursive: true });
    let retries = 50; // Wait for max 10 seconds
    while (retries > 0) {
        try {
            fs.mkdirSync(lockFile); // Atomic operation
            debugLog(`Process ${process.pid} acquired lock for ${containerName}`);
            break; // Lock acquired
        } catch (e) {
            if (e.code === 'EEXIST') {
                debugLog(`Process ${process.pid} waiting for lock on ${containerName}...`);
                await new Promise(resolve => setTimeout(resolve, 200));
                retries--;
            } else {
                throw e;
            }
        }
    }
    if (retries === 0) {
        throw new Error(`Could not acquire lock for container ${containerName}. It might be stuck.`);
    }

    try {
        // Check if we have a cached port file first (fast path)
        if (fs.existsSync(portFilePath)) {
            const cachedPort = fs.readFileSync(portFilePath, 'utf8').trim();
            if (cachedPort) {
                // Verify container is still running with this port
                try {
                    const runningContainer = execSync(`${runtime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
                    if (runningContainer === containerName) {
                        debugLog(`Using cached port ${cachedPort} for running container ${containerName}`);
                        return cachedPort;
                    }
                } catch (e) {
                    // Container might not be running, continue to check
                }
            }
        }
        
        // Check if container exists
        const existingContainer = execSync(`${runtime} ps -a --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
        if (existingContainer === containerName) {
            const runningContainer = execSync(`${runtime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
            if (runningContainer !== containerName) {
                debugLog(`Container for agent '${manifest.name}' exists but is stopped. Starting it...`);
                execSync(`${runtime} start ${containerName}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Get port from running container
            const portMapping = execSync(`${runtime} port ${containerName} 8080/tcp`).toString().trim();
            const hostPort = portMapping.split(':')[1];
            if (!hostPort) throw new Error(`Could not determine host port for running container ${containerName}`);
            
            // Cache the port for future use
            fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
            fs.writeFileSync(portFilePath, hostPort);
            
            return hostPort;
        }

        // Create container if it doesn't exist
        debugLog(`Creating persistent container for agent '${manifest.name}'...`);
        const image = manifest.image || 'node:18-alpine';
        const agentCorePath = path.resolve(__dirname, '../../../agentCore');
        
        const containerArgs = [
            'run',
            '-d', '-p', '8080', '--name', containerName,
            '-v', `${agentPath}:/agent:z`,
            '-v', `${agentCorePath}:/agentCore:z`
        ];
        
        // Add RUN_TASK environment variable if defined in manifest
        if (manifest.runTask) {
            containerArgs.push('-e', `RUN_TASK=${manifest.runTask}`);
            containerArgs.push('-e', 'CODE_DIR=/agent');
        }
        
        // Add PORT environment variable to ensure consistency
        containerArgs.push('-e', 'PORT=8080');
        
        containerArgs.push(image, 'node', '/agentCore/server.js');

        // Use execFileSync to preserve arguments with spaces (e.g., RUN_TASK values)
        execFileSync(runtime, containerArgs, { stdio: 'inherit' });
        debugLog(`✓ Container created. Waiting a moment for it to initialize...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        const portMapping = execSync(`${runtime} port ${containerName} 8080/tcp`).toString().trim();
        const hostPort = portMapping.split(':')[1];
        if (!hostPort) throw new Error(`Could not determine host port for new container ${containerName}`);

        fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
        fs.writeFileSync(portFilePath, hostPort);
        return hostPort;
    } finally {
        // Release Lock
        fs.rmdirSync(lockFile);
    }
}

async function runTask(agentName, command, args) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.taskRunner !== 'http') {
        throw new Error(`Agent '${agentName}' is not configured for HTTP tasks.`);
    }
    const agentPath = path.dirname(manifestPath);
    const hostPort = await ensureContainerRunning(manifest, agentPath);
    
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
    const containerName = `ploinky_agent_${agentName}`;
    await ensureAgentContainerRunning(agentName, manifest, agentPath);
    const runtime = getContainerRuntime();
    console.log(`Opening interactive sh shell in '${agentName}' container...`);
    const execArgs = ['exec', '-it', '-w', '/agent', containerName, 'sh'];
    spawn(runtime, execArgs, { stdio: 'inherit' });
}

async function runWebTTY(agentName, portArg, passwordArg) {
    if (!agentName) {
        throw new Error("Usage: run webtty <agentName> [port]");
    }
    // Try node-pty first for a proper interactive TTY (echo, line editing, resize)
    try { pty = require('node-pty'); } catch (e) { pty = null; }

    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const containerName = `ploinky_agent_${agentName}`;

    // Ensure container is up
    await ensureAgentContainerRunning(agentName, manifest, agentPath);
    const runtime = getContainerRuntime();

    const numericPort = parseInt(portArg, 10);
    const port = (!isNaN(numericPort) && numericPort > 0) ? numericPort : (parseInt(process.env.WEBTTY_PORT, 10) || 8089);
    const password = (!isNaN(numericPort) && passwordArg) ? passwordArg : (!isNaN(numericPort) ? passwordArg : portArg);

    // Use refactored modules for TTY and HTTP server
    const { createTTYSession } = require('../webtty/tty');
    const { startWebTTYServer } = require('../webtty/server');

    const ttySession = createTTYSession({ runtime, containerName, ptyLib: pty });
    startWebTTYServer({ agentName, runtime, containerName, port, ttySession, password });
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
        case 'set':
            setCommand(options[0], options[1], options.slice(2).join(' '));
            break;
        case 'enable':
            if (options[0] === 'env') enableEnv(options[1], options[2]);
            else showHelp();
            break;
        case 'run':
            if (options[0] === 'task') await runTask(options[1], options[2], options.slice(3));
            else if (options[0] === 'bash') await runBash(options[1]);
            else if (options[0] === 'webtty') await runWebTTY(options[1], options[2], options[3]);
            else showHelp();
            break;
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else showHelp();
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
    setCommand,
    enableEnv,
    addEnv,
    listAgents,
    listRepos
};
