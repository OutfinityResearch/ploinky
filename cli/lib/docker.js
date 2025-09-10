const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AGENTS_FILE, SECRETS_FILE } = require('./config');
const { debugLog } = require('./utils');

function getContainerRuntime() {
    try {
        execSync('command -v docker', { stdio: 'ignore' });
        debugLog('Using docker as container runtime.');
        return 'docker';
    } catch (e) {
        try {
            execSync('command -v podman', { stdio: 'ignore' });
            debugLog('Using podman as container runtime.');
            return 'podman';
        } catch (e2) {
            console.error('Neither docker nor podman found in PATH. Please install one of them.');
            process.exit(1);
        }
    }
}

const containerRuntime = getContainerRuntime();

// Agents registry (AGENTS_FILE): JSON map keyed de numele containerului.
// Folosit pentru a limita operațiile (ex. destroy) la workspace-ul curent.
// Schema per entry:
// {
//   agentName, repoName, containerId?, containerImage,
//   createdAt, projectPath,
//   type: 'interactive' | 'agent' | 'agentCore',
//   config: {
//     binds: [ { source, target } ],
//     env: [ { name, value? } ],
//     ports: [ { containerPort, hostPort } ]
//   }
// }
function loadAgentsMap() {
  try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8') || '{}') || {}; } catch (_) { return {}; }
}
function saveAgentsMap(map) {
  try { fs.writeFileSync(AGENTS_FILE, JSON.stringify(map, null, 2)); } catch (e) { debugLog('saveAgentsMap error: ' + (e?.message||e)); }
}


function getAgentContainerName(agentName, repoName) {
    const safeAgentName = agentName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeRepoName = repoName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    // Include a short hash of the current working directory for uniqueness
    const cwdHash = crypto.createHash('sha256')
        .update(process.cwd())
        .digest('hex')
        .substring(0, 8);
    
    // Format: ploinky_<repo>_<agent>_<cwdhash>
    const containerName = `ploinky_${safeRepoName}_${safeAgentName}_${cwdHash}`;
    debugLog(`Calculated container name: ${containerName} (for path: ${process.cwd()})`);
    return containerName;
}

function isContainerRunning(containerName) {
    // Use exact name matching for better compatibility
    const command = `${containerRuntime} ps --format "{{.Names}}" | grep -x "${containerName}"`;
    debugLog(`Checking if container is running with command: ${command}`);
    try {
        const result = execSync(command, { stdio: 'pipe' }).toString();
        const running = result.trim().length > 0;
        debugLog(`Container '${containerName}' is running: ${running}`);
        return running;
    } catch (error) {
        debugLog(`Container '${containerName}' is not running (grep failed)`);
        return false;
    }
}

function containerExists(containerName) {
    // Use exact name matching without regex anchors for better compatibility
    const command = `${containerRuntime} ps -a --format "{{.Names}}" | grep -x "${containerName}"`;
    debugLog(`Checking if container exists with command: ${command}`);
    try {
        const result = execSync(command, { stdio: 'pipe' }).toString();
        const exists = result.trim().length > 0;
        debugLog(`Container '${containerName}' exists: ${exists}`);
        return exists;
    } catch (error) {
        debugLog(`Container '${containerName}' does not exist (grep failed)`);
        return false;
    }
}

function getSecretsForAgent(manifest) {
    if (!manifest.env || manifest.env.length === 0) {
        debugLog('No environment variables to inject.');
        return [];
    }
    debugLog(`Found environment variables to inject: ${manifest.env.join(', ')}`);
    const secrets = fs.readFileSync(SECRETS_FILE, 'utf-8');
    const secretLines = secrets.split('\n');
    const envVars = [];

    for (const varName of manifest.env) {
        const secretLine = secretLines.find(line => line.startsWith(`${varName}=`));
        if (secretLine) {
            envVars.push(`-e ${secretLine}`);
        }
    }
    debugLog(`Formatted env vars for ${containerRuntime} command: ${envVars.join(' ')}`);
    return envVars;
}

function runCommandInContainer(agentName, repoName, manifest, command, interactive = false) {
    const containerName = getAgentContainerName(agentName, repoName);
    let agents = {};
    try {
        agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
    } catch (e) {
        debugLog('Agents file not found or invalid, creating new one');
        agents = {};
    }
    const currentDir = process.cwd();

    let firstRun = false;
    debugLog(`Checking if container '${containerName}' exists...`);
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVars = getSecretsForAgent(manifest).join(' ');
        // Use --mount for podman for better SELinux handling, -v for docker. No --workdir here.
        const mountOption = containerRuntime === 'podman' 
            ? `--mount type=bind,source="${currentDir}",destination="${currentDir}",relabel=shared` 
            : `-v "${currentDir}:${currentDir}"`;
        
        // Try to create container, with fallback to docker.io prefix for Podman
        let containerImage = manifest.container;
        let createOutput;
        let containerId;
        
        try {
            const createCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
            debugLog(`Executing create command: ${createCommand}`);
            // Use pipe to capture container ID but also show any pulling progress
            createOutput = execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] }).toString().trim();
            containerId = createOutput;
        } catch (error) {
            // If Podman fails with short-name error, try with docker.io prefix
            if (containerRuntime === 'podman' && error.message.includes('short-name')) {
                debugLog(`Short-name resolution failed, trying with docker.io prefix...`);
                
                // Add docker.io/library/ prefix if not already present
                if (!containerImage.includes('/')) {
                    // Simple name like 'debian:latest' -> 'docker.io/library/debian:latest'
                    containerImage = `docker.io/library/${containerImage}`;
                } else if (!containerImage.startsWith('docker.io/') && !containerImage.includes('.')) {
                    // User image like 'user/image:tag' -> 'docker.io/user/image:tag'
                    containerImage = `docker.io/${containerImage}`;
                }
                
                console.log(`Retrying with full registry name: ${containerImage}`);
                const retryCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${envVars} ${containerImage} /bin/sh -lc \"while :; do sleep 3600; done\"`;
                debugLog(`Executing retry command: ${retryCommand}`);
                
                try {
                    createOutput = execSync(retryCommand, { stdio: ['pipe', 'pipe', 'inherit'] }).toString().trim();
                    containerId = createOutput;
                    
                    // Update manifest with the working image name for future use
                    manifest.container = containerImage;
                } catch (retryError) {
                    console.error(`Failed to create container even with full registry name.`);
                    throw retryError;
                }
            } else {
                throw error;
            }
        }
        
        agents[containerName] = {
            agentName,
            repoName,
            containerId: containerId,
            containerImage: containerImage,
            createdAt: new Date().toISOString(),
            projectPath: currentDir,
            type: 'interactive',
            config: {
                binds: [ { source: currentDir, target: currentDir } ],
                env: (manifest.env||[]).map(name => ({ name })),
                ports: []
            }
        };
        saveAgentsMap(agents);
        debugLog(`Updated agents file with container ID: ${containerId}`);
        firstRun = true;
    }

    if (!isContainerRunning(containerName)) {
        // Check container state before trying to start
        try {
            const stateCommand = `${containerRuntime} ps -a --format "{{.Names}}\t{{.Status}}" | grep "^${containerName}"`;
            const stateResult = execSync(stateCommand, { stdio: 'pipe' }).toString().trim();
            debugLog(`Container state: ${stateResult}`);
            
            // If container exists but is in a bad state, try to stop it first
            if (stateResult.includes('Exited')) {
                debugLog(`Container is in Exited state, starting it...`);
            } else if (stateResult && !stateResult.includes('Up')) {
                debugLog(`Container is in unexpected state, attempting to stop first...`);
                try {
                    execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'pipe' });
                } catch (e) {
                    debugLog(`Could not stop container: ${e.message}`);
                }
            }
        } catch (e) {
            debugLog(`Could not check container state: ${e.message}`);
        }
        
        const startCommand = `${containerRuntime} start ${containerName}`;
        debugLog(`Executing start command: ${startCommand}`);
        try {
            execSync(startCommand, { stdio: 'inherit' });
        } catch (error) {
            console.error(`Error starting container. Try removing it with: ${containerRuntime} rm ${containerName}`);
            throw error;
        }
    }

    if (firstRun && manifest.install) {
        console.log(`Running install command for '${agentName}'...`);
        // Prepend cd to the command string itself
        const installCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} sh -lc "cd '${currentDir}' && ${manifest.install}"`;
        debugLog(`Executing install command: ${installCommand}`);
        execSync(installCommand, { stdio: 'inherit' });
    }

    console.log(`Running command in '${agentName}': ${command}`);
    // Prepend cd to the command string itself
    // For interactive sessions, create a clean terminal environment
    let bashCommand;
    let envVars = '';
    
    if (interactive && (command === '/bin/bash' || command === '/bin/sh')) {
        // Use POSIX sh for compatibility
        bashCommand = `cd '${currentDir}' && exec sh`;
    } else {
        bashCommand = `cd '${currentDir}' && ${command}`;
    }

    const execCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${envVars} ${containerName} sh -lc "${bashCommand}"`;
    debugLog(`Executing run command: ${execCommand}`);
    
    if (interactive) {
        // Use spawnSync for interactive sessions to properly handle TTY and signals
        console.log(`[Ploinky] Attaching to container '${containerName}' (interactive TTY).`);
        console.log(`[Ploinky] Working directory in container: ${currentDir}`);
        console.log(`[Ploinky] Exit the program or shell to return to the Ploinky prompt.`);
        const { spawnSync } = require('child_process');
        const args = ['exec'];
        if (interactive) args.push('-it');
        if (envVars) args.push(...envVars.split(' '));
        args.push(containerName, 'sh', '-lc', bashCommand);
        
        debugLog(`Running interactive session with args: ${args.join(' ')}`);
        
        // Run the interactive session synchronously
        const result = spawnSync(containerRuntime, args, {
            stdio: 'inherit',
            shell: false
        });
        
        debugLog(`Container session ended with code ${result.status}`);
        console.log(`[Ploinky] Detached from container '${containerName}'. Exit code: ${result.status ?? 'unknown'}`);
    } else {
        // Non-interactive commands can use execSync
        const t0 = Date.now();
        let code = 0;
        try {
            execSync(execCommand, { stdio: 'inherit' });
        } catch (error) {
            code = (error && typeof error.status === 'number') ? error.status : 1;
            debugLog(`Caught error during ${containerRuntime} exec. Exit code: ${code}`);
        } finally {
            const dt = Date.now() - t0;
            console.log(`[Ploinky] Command finished in ${dt} ms with exit code ${code}.`);
        }
    }
    
    // Keep container running after interactive sessions.
}

function ensureAgentContainer(agentName, repoName, manifest) {
    const containerName = getAgentContainerName(agentName, repoName);
    const currentDir = process.cwd();
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVars = getSecretsForAgent(manifest).join(' ');
        const mountOption = containerRuntime === 'podman'
            ? `--mount type=bind,source="${currentDir}",destination="${currentDir}",relabel=shared`
            : `-v "${currentDir}:${currentDir}"`;
        let containerImage = manifest.container;
        try {
            const createCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
            debugLog(`Executing create command: ${createCommand}`);
            execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
        } catch (error) {
            if (containerRuntime === 'podman' && String(error.message||'').includes('short-name')) {
                if (!containerImage.includes('/')) containerImage = `docker.io/library/${containerImage}`;
                else if (!containerImage.startsWith('docker.io/') && !containerImage.includes('.')) containerImage = `docker.io/${containerImage}`;
                console.log(`Retrying with full registry name: ${containerImage}`);
                const retryCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${envVars} ${containerImage} /bin/sh -lc \"while :; do sleep 3600; done\"`;
                debugLog(`Executing retry command: ${retryCommand}`);
                execSync(retryCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
                manifest.container = containerImage;
            } else {
                console.error('[docker.ensureAgentContainer] create failed:', error.message || error);
                throw error;
            }
        }
        // Registrează în AGENTS_FILE
        const agents = loadAgentsMap();
        agents[containerName] = {
            agentName,
            repoName,
            containerImage,
            createdAt: new Date().toISOString(),
            projectPath: currentDir,
            type: 'interactive',
            config: { binds: [ { source: currentDir, target: currentDir } ], env: (manifest.env||[]).map(name => ({ name })), ports: [] }
        };
        saveAgentsMap(agents);
    }
    if (!isContainerRunning(containerName)) {
        const startCommand = `${containerRuntime} start ${containerName}`;
        debugLog(`Executing start command: ${startCommand}`);
        try { execSync(startCommand, { stdio: 'inherit' }); }
        catch (e) { console.error('[docker.ensureAgentContainer] start failed:', e.message || e); throw e; }
    }
    return containerName;
}

function getRuntime() { return containerRuntime; }

async function ensureAgentCore(manifest, agentPath) {
    const runtime = containerRuntime;
    const containerName = `ploinky_agent_${manifest.name}`;
    const fs = require('fs');
    const path = require('path');
    const { PLOINKY_DIR } = require('./config');
    const portFilePath = path.join(PLOINKY_DIR, 'running_agents', `${containerName}.port`);
    const lockDir = path.join(PLOINKY_DIR, 'locks');
    const lockFile = path.join(lockDir, `container_${containerName}.lock`);

    // Acquire Lock
    fs.mkdirSync(lockDir, { recursive: true });
    let retries = 50; // Wait for max 10 seconds
    while (retries > 0) {
        try { fs.mkdirSync(lockFile); break; } catch (e) {
            if (e.code === 'EEXIST') { await new Promise(r => setTimeout(r, 200)); retries--; } else { throw e; }
        }
    }
    if (retries === 0) throw new Error(`Could not acquire lock for container ${containerName}. It might be stuck.`);

    try {
        if (fs.existsSync(portFilePath)) {
            const cachedPort = fs.readFileSync(portFilePath, 'utf8').trim();
            if (cachedPort) {
                try {
                    const runningContainer = execSync(`${runtime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
                    if (runningContainer === containerName) { return { containerName, hostPort: cachedPort }; }
                } catch (_) {}
            }
        }

        const existingContainer = execSync(`${runtime} ps -a --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
        if (existingContainer === containerName) {
            const runningContainer = execSync(`${runtime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
            if (runningContainer !== containerName) {
                execSync(`${runtime} start ${containerName}`);
                await new Promise(r => setTimeout(r, 1000));
            }
            const portMapping = execSync(`${runtime} port ${containerName} 8080/tcp`).toString().trim();
            const hostPort = portMapping.split(':')[1];
            if (!hostPort) throw new Error(`Could not determine host port for running container ${containerName}`);
            fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
            fs.writeFileSync(portFilePath, hostPort);
            // Asigură înregistrarea în registry dacă lipsea
            const agents = loadAgentsMap();
            if (!agents[containerName]) {
                agents[containerName] = {
                    agentName: manifest.name,
                    repoName: path.basename(path.dirname(agentPath)),
                    containerImage: manifest.container || manifest.image || 'node:18-alpine',
                    createdAt: new Date().toISOString(),
                    projectPath: process.cwd(),
                    type: 'agentCore',
                    config: { binds: [ { source: agentPath, target: '/agent' } ], env: [{ name: 'PORT', value: '8080' }], ports: [ { containerPort: 8080, hostPort } ] }
                };
                saveAgentsMap(agents);
            }
            return { containerName, hostPort };
        }

        const image = manifest.container || manifest.image || 'node:18-alpine';
        const agentCorePath = path.resolve(__dirname, '../../agentCore');
        const args = ['run', '-d', '-p', '8080', '--name', containerName,
            '-v', `${agentPath}:/agent:z`, '-v', `${agentCorePath}:/agentCore:z`];
        if (manifest.runTask) { args.push('-e', `RUN_TASK=${manifest.runTask}`, '-e', 'CODE_DIR=/agent'); }
        args.push('-e', 'PORT=8080', image, 'node', '/agentCore/server.js');
        execSync(`${runtime} ${args.join(' ')}`, { stdio: 'inherit' });
        await new Promise(r => setTimeout(r, 2000));
        const portMapping = execSync(`${runtime} port ${containerName} 8080/tcp`).toString().trim();
        const hostPort = portMapping.split(':')[1];
        if (!hostPort) throw new Error(`Could not determine host port for new container ${containerName}`);
        fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
        fs.writeFileSync(portFilePath, hostPort);
        // Înregistrează containerul în registry
        const agents = loadAgentsMap();
        agents[containerName] = {
            agentName: manifest.name,
            repoName: path.basename(path.dirname(agentPath)),
            containerImage: image,
            createdAt: new Date().toISOString(),
            projectPath: process.cwd(),
            type: 'agentCore',
            config: {
                binds: [ { source: agentPath, target: '/agent' }, { source: path.resolve(__dirname, '../../agentCore'), target: '/agentCore' } ],
                env: [ ...(manifest.runTask ? [{ name: 'RUN_TASK', value: String(manifest.runTask) }, { name: 'CODE_DIR', value: '/agent' }] : []), { name: 'PORT', value: '8080' } ],
                ports: [ { containerPort: 8080, hostPort } ]
            }
        };
        saveAgentsMap(agents);
        return { containerName, hostPort };
    } finally {
        try { fs.rmdirSync(lockFile); } catch (_) {}
    }
}

function startAgentContainer(agentName, manifest, agentPath) {
    const runtime = containerRuntime;
    const containerName = `ploinky_agent_${agentName}`;
    try { execSync(`${runtime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
    try { execSync(`${runtime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    if (!agentCmd) throw new Error(`Manifest for '${agentName}' has no 'agent' command.`);
    const args = ['run', '-d', '--name', containerName, '-w', '/agent',
        '-v', `${agentPath}:/agent:z`, '-v', `${agentPath}:/code:z`, image, '/bin/sh', '-lc', agentCmd];
    execSync(`${runtime} ${args.join(' ')}`, { stdio: 'inherit' });
    // Înregistrează în registry
    const agents = loadAgentsMap();
    agents[containerName] = {
        agentName,
        repoName: path.basename(path.dirname(agentPath)),
        containerImage: image,
        createdAt: new Date().toISOString(),
        projectPath: process.cwd(),
        type: 'agent',
        config: { binds: [ { source: agentPath, target: '/agent' }, { source: agentPath, target: '/code' } ], env: [], ports: [] }
    };
    saveAgentsMap(agents);
    return containerName;
}

function stopAndRemove(name) {
    const runtime = containerRuntime;
    try {
        // Most robust: rm -f (forces stop + remove)
        execSync(`${runtime} rm -f ${name}`, { stdio: 'ignore' });
    } catch (e) {
        debugLog(`rm -f ${name} error: ${e.message}`);
        try { execSync(`${runtime} stop ${name}`, { stdio: 'ignore' }); } catch (e2) { debugLog(`stop ${name} error: ${e2.message}`); }
        try { execSync(`${runtime} rm ${name}`, { stdio: 'ignore' }); } catch (e3) { debugLog(`rm ${name} error: ${e3.message}`); }
    }
}

function stopAndRemoveMany(names) {
    if (!Array.isArray(names)) return;
    for (const n of names) {
        try { stopAndRemove(n); } catch (e) { debugLog(`stopAndRemoveMany ${n} error: ${e?.message||e}`); }
    }
}

function listAllContainerNames() {
    const runtime = containerRuntime;
    try {
        const out = execSync(`${runtime} ps -a --format "{{.Names}}"`, { stdio: 'pipe' }).toString().trim();
        return out ? out.split(/\n+/).filter(Boolean) : [];
    } catch (e) {
        debugLog(`listAllContainerNames error: ${e?.message||e}`);
        return [];
    }
}

function destroyAllPloinky() {
    const names = listAllContainerNames().filter(n => n.startsWith('ploinky_'));
    stopAndRemoveMany(names);
    return names.length;
}

// Distruge DOAR containerele asociate workspace-ului curent (după AGENTS_FILE)
function destroyWorkspaceContainers() {
    const cwd = process.cwd();
    const agents = loadAgentsMap();
    let removed = 0;
    for (const [name, rec] of Object.entries(agents)) {
        if (rec && rec.projectPath === cwd) {
            try { stopAndRemove(name); delete agents[name]; removed++; }
            catch (e) { debugLog(`destroyWorkspaceContainers ${name} error: ${e?.message||e}`); }
        }
    }
    saveAgentsMap(agents);
    return removed;
}

// Session container tracking (optional helpers)
const SESSION = new Set();
function addSessionContainer(name) { if (name) try { SESSION.add(name); } catch (_) {} }
function cleanupSessionSet() { const list = Array.from(SESSION); stopAndRemoveMany(list); SESSION.clear(); return list.length; }

function getAgentsRegistry() { return loadAgentsMap(); }

module.exports = { runCommandInContainer, ensureAgentContainer, getAgentContainerName, getRuntime, ensureAgentCore, startAgentContainer, stopAndRemove, stopAndRemoveMany, destroyAllPloinky, addSessionContainer, cleanupSessionSet, listAllContainerNames, destroyWorkspaceContainers, getAgentsRegistry };

// Ensure an agent service is running on container port 7000 mapped to random host port (>10000)
function ensureAgentService(agentName, manifest, agentPath, preferredHostPort) {
    const runtime = containerRuntime;
    const containerName = `ploinky_agent_${agentName}`;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    const cwd = process.cwd();
    const agentLibPath = path.resolve(__dirname, '../../Agent');

    // If container exists, ensure it's running and return current mapped port.
    if (containerExists(containerName)) {
        if (!isContainerRunning(containerName)) {
            try { execSync(`${runtime} start ${containerName}`, { stdio: 'inherit' }); } catch (e) { debugLog(`start ${containerName} error: ${e.message}`); }
        }
        try {
            const portMap = execSync(`${runtime} port ${containerName} 7000/tcp`, { stdio: 'pipe' }).toString().trim();
            const hostPort = parseInt(portMap.split(':')[1] || '0', 10) || preferredHostPort || 0;
            return { containerName, hostPort };
        } catch (_) {
            // Fall through to recreate if mapping cannot be determined
        }
    }

    const hostPort = preferredHostPort || (10000 + Math.floor(Math.random() * 50000));
    // Build run args with mounts:
    // - Mount current directory RW at same path (workdir = cwd)
    // - Mount Agent library RO at /agent
    // - Mount agentPath RO at /code (for apps expecting /code)
    const args = ['run', '-d', '-p', `${hostPort}:7000`, '--name', containerName,
        '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime==='podman'?':z':''}`,
        '-v', `${agentLibPath}:/agent:ro${runtime==='podman'?',z':''}`,
        '-v', `${agentPath}:/code:ro${runtime==='podman'?',z':''}`
    ];
    const cmd = agentCmd || 'sh /agent/AgentServer.sh';
    args.push(image, '/bin/sh', '-lc', cmd);
    execSync(`${runtime} ${args.join(' ')}`, { stdio: 'inherit' });

    // Save to registry
    const agents = loadAgentsMap();
    agents[containerName] = {
        agentName,
        repoName: path.basename(path.dirname(agentPath)),
        containerImage: image,
        createdAt: new Date().toISOString(),
        projectPath: cwd,
        type: 'agent',
        config: {
            binds: [
                { source: cwd, target: cwd },
                { source: agentLibPath, target: '/agent', ro: true },
                { source: agentPath, target: '/code', ro: true }
            ],
            env: [],
            ports: [ { containerPort: 7000, hostPort } ]
        }
    };
    saveAgentsMap(agents);
    return { containerName, hostPort };
}
module.exports.ensureAgentService = ensureAgentService;
