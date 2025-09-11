const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AGENTS_FILE, SECRETS_FILE, REPOS_DIR } = require('./config');
const { buildEnvFlags, getExposedNames, buildEnvMap } = require('./secretVars');
const workspace = require('./workspace');
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
function loadAgentsMap() { return workspace.loadAgents(); }
function saveAgentsMap(map) { return workspace.saveAgents(map); }


function getAgentContainerName(agentName, repoName) {
    const safeAgentName = agentName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeRepoName = repoName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    // Include a short hash of the current working directory for uniqueness
    const cwdHash = crypto.createHash('sha256')
        .update(process.cwd())
        .digest('hex')
        .substring(0, 8);
    const projectDir = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
    
    // Format: ploinky_<repo>_<agent>_<project>_<cwdhash>
    const containerName = `ploinky_${safeRepoName}_${safeAgentName}_${projectDir}_${cwdHash}`;
    debugLog(`Calculated container name: ${containerName} (for path: ${process.cwd()})`);
    return containerName;
}

function getServiceContainerName(agentName) {
    const safeAgentName = agentName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const projectDir = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cwdHash = crypto.createHash('sha256')
        .update(process.cwd())
        .digest('hex')
        .substring(0, 6);
    return `ploinky_agent_${safeAgentName}_${projectDir}_${cwdHash}`;
}
module.exports.getServiceContainerName = getServiceContainerName;

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
    const vars = buildEnvFlags(manifest);
    debugLog(`Formatted env vars for ${containerRuntime} command: ${vars.join(' ')}`);
    return vars;
}

function flagsToArgs(flags) {
    // Convert ["-e VAR=val", "-e OTHER=val"] -> ["-e","VAR=val","-e","OTHER=val"] for spawn args
    const out = [];
    for (const f of (flags || [])) {
        if (!f) continue;
        const parts = String(f).split(' ');
        for (const p of parts) { if (p) out.push(p); }
    }
    return out;
}

function runCommandInContainer(agentName, repoName, manifest, command, interactive = false) {
    const containerName = getAgentContainerName(agentName, repoName);
    let agents = loadAgentsMap();
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
        
        // Collect declared env names (legacy env[] + expose[] names) for registry
        const declaredEnvNames = [ ...(manifest.env||[]), ...getExposedNames(manifest) ];
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
                env: Array.from(new Set(declaredEnvNames)).map(name => ({ name })),
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
    
    if (interactive && (command === '/bin/sh')) {
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
    const agentLibPath = path.resolve(__dirname, '../../Agent');
    const agentPath = path.join(REPOS_DIR, repoName, agentName);
    const absAgentPath = path.resolve(agentPath);
    // If container exists but env hash label mismatches, recreate
    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch(_) {}
        }
    }
    let createdNew = false;
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVars = getSecretsForAgent(manifest).join(' ');
        const volZ = (containerRuntime === 'podman') ? ':z' : '';
        const roOpt = (containerRuntime === 'podman') ? ':ro,z' : ':ro';
        let containerImage = manifest.container;
        const envHash = computeEnvHash(manifest);
        try {
            const createCommand = `${containerRuntime} create -it --name ${containerName} --label ploinky.envhash=${envHash} \
              -v "${currentDir}:${currentDir}${volZ}" \
              -v "${agentLibPath}:/Agent${roOpt}" \
              -v "${absAgentPath}:/code${roOpt}" \
              ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
            debugLog(`Executing create command: ${createCommand}`);
            execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
            createdNew = true;
        } catch (error) {
            if (containerRuntime === 'podman' && String(error.message||'').includes('short-name')) {
                if (!containerImage.includes('/')) containerImage = `docker.io/library/${containerImage}`;
                else if (!containerImage.startsWith('docker.io/') && !containerImage.includes('.')) containerImage = `docker.io/${containerImage}`;
                console.log(`Retrying with full registry name: ${containerImage}`);
                const retryCommand = `${containerRuntime} create -it --name ${containerName} --label ploinky.envhash=${envHash} \
                  -v "${currentDir}:${currentDir}${volZ}" \
                  -v "${agentLibPath}:/Agent${roOpt}" \
                  -v "${absAgentPath}:/code${roOpt}" \
                  ${envVars} ${containerImage} /bin/sh -lc \"while :; do sleep 3600; done\"`;
                debugLog(`Executing retry command: ${retryCommand}`);
                execSync(retryCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
                manifest.container = containerImage;
                createdNew = true;
            } else {
                console.error('[docker.ensureAgentContainer] create failed:', error.message || error);
                throw error;
            }
        }
        // Registrează în agents registry
        const agents = loadAgentsMap();
        const declaredEnvNamesX = [ ...(manifest.env||[]), ...getExposedNames(manifest) ];
        agents[containerName] = {
            agentName,
            repoName,
            containerImage,
            createdAt: new Date().toISOString(),
            projectPath: currentDir,
            type: 'interactive',
            config: { binds: [ { source: currentDir, target: currentDir }, { source: agentLibPath, target: '/Agent', ro: true }, { source: absAgentPath, target: '/code', ro: true } ], env: Array.from(new Set(declaredEnvNamesX)).map(name => ({ name })), ports: [] }
        };
        saveAgentsMap(agents);
    }
    if (!isContainerRunning(containerName)) {
        const startCommand = `${containerRuntime} start ${containerName}`;
        debugLog(`Executing start command: ${startCommand}`);
        try { execSync(startCommand, { stdio: 'inherit' }); }
        catch (e) { console.error('[docker.ensureAgentContainer] start failed:', e.message || e); throw e; }
    }
    // Run install on first creation if defined
    try {
        if (createdNew && manifest.install && String(manifest.install).trim()) {
            console.log(`Running install command for '${agentName}'...`);
            const installCommand = `${containerRuntime} exec ${containerName} sh -lc "cd '${currentDir}' && ${manifest.install}"`;
            debugLog(`Executing install command: ${installCommand}`);
            execSync(installCommand, { stdio: 'inherit' });
        }
    } catch (e) {
        console.log(`[install] ${agentName}: ${e?.message||e}`);
    }
    return containerName;
}

function getRuntime() { return containerRuntime; }

// Start all configured agents recorded in workspace registry (if present but not running)
function startConfiguredAgents() {
    const agents = workspace.loadAgents();
    const names = Object.entries(agents || {})
        .filter(([name, rec]) => rec && rec.type && typeof name === 'string' && !name.startsWith('_'))
        .map(([name]) => name);
    const startedList = [];
    for (const name of names) {
        try {
            if (!isContainerRunning(name) && containerExists(name)) {
                execSync(`${containerRuntime} start ${name}`, { stdio: 'ignore' });
                startedList.push(name);
            }
        } catch (e) { debugLog(`startConfiguredAgents: ${name} ${e?.message||e}`); }
    }
    return startedList;
}

// Stop (but do not remove) all containers recorded in workspace registry
function stopConfiguredAgents() {
    const agents = workspace.loadAgents();
    const names = Object.entries(agents || {})
        .filter(([name, rec]) => rec && rec.type && typeof name === 'string' && !name.startsWith('_'))
        .map(([name]) => name);
    const stoppedList = [];
    for (const name of names) {
        try {
            console.log(`[stop] Stopping container: ${name}...`);
            execSync(`${containerRuntime} stop ${name}`, { stdio: 'ignore' });
            console.log(`[stop] ✓ stopped ${name}`);
            stoppedList.push(name);
        } catch (e) {
            console.log(`[stop] ${name}: ${e?.message||e}`);
        }
    }
    return stoppedList;
}
function parseHostPort(output) {
    try {
        if (!output) return 0;
        // Handle lines like "0.0.0.0:32768", "[::]:32768", ":::32768", or just "32768"
        const firstLine = String(output).split(/\n+/)[0].trim();
        const m = firstLine.match(/(\d+)\s*$/);
        return m ? parseInt(m[1], 10) : 0;
    } catch (_) { return 0; }
}

async function ensureAgentCore(manifest, agentPath) {
    const runtime = containerRuntime;
    const containerName = getServiceContainerName(manifest.name);
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
            const hostPort = parseHostPort(portMapping);
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
        const hostPort = parseHostPort(portMapping);
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

// Start a persistent agent container in detached mode.
// Behavior:
// - Working directory: current project root (process.cwd()), mounted RW at the same path inside container.
// - Map Ploinky's Agent tools directory (repository 'Agent') read-only into /Agent inside the container.
// - If manifest.agent is provided (non-empty), run it via /bin/sh -lc <agentCmd>.
// - If manifest.agent is missing/empty, run fallback supervisor '/Agent/AgentServer.sh' which loops and restarts AgentServer.js.
// - Always keep the container running; do not auto-stop on exit.
function startAgentContainer(agentName, manifest, agentPath) {
    const runtime = containerRuntime;
    const containerName = getServiceContainerName(agentName);
    try { execSync(`${runtime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
    try { execSync(`${runtime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    const cwd = process.cwd();
    const agentLibPath = path.resolve(__dirname, '../../Agent');
    const envHash = computeEnvHash(manifest);
    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime==='podman'?':z':''}`,
        '-v', `${agentLibPath}:/Agent${runtime==='podman'?':ro,z':':ro'}`,
        '-v', `${path.resolve(agentPath)}:/code${runtime==='podman'?':ro,z':':ro'}`
    ];
    // Inject environment for exposed variables
    const envFlags = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags.length) args.push(...envFlags);
    const entry = agentCmd ? agentCmd : 'sh /Agent/AgentServer.sh';
    args.push(image, '/bin/sh', '-lc', entry);
    const { spawnSync } = require('child_process');
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) { throw new Error(`${runtime} run failed with code ${res.status}`); }
    // Înregistrează în registry
    const agents = loadAgentsMap();
    const declaredEnvNames2 = [ ...(manifest.env||[]), ...getExposedNames(manifest) ];
    agents[containerName] = {
        agentName,
        repoName: path.basename(path.dirname(agentPath)),
        containerImage: image,
        createdAt: new Date().toISOString(),
        projectPath: process.cwd(),
        type: 'agent',
        config: { binds: [ { source: cwd, target: cwd }, { source: agentLibPath, target: '/Agent' }, { source: agentPath, target: '/code' } ], env: Array.from(new Set(declaredEnvNames2)).map(name => ({ name })), ports: [] }
    };
    saveAgentsMap(agents);
    return containerName;
}

function stopAndRemove(name) {
    const runtime = containerRuntime;
    try {
        console.log(`[destroy] Removing container: ${name}`);
        // Most robust: rm -f (forces stop + remove)
        execSync(`${runtime} rm -f ${name}`, { stdio: 'ignore' });
        console.log(`[destroy] ✓ removed ${name}`);
    } catch (e) {
        console.log(`[destroy] rm -f failed for ${name}: ${e.message}. Trying stop then rm...`);
        try { console.log(`[destroy] - stopping ${name}...`); execSync(`${runtime} stop ${name}`, { stdio: 'ignore' }); console.log(`[destroy] - stopped ${name}`); } catch (e2) { console.log(`[destroy] - stop failed for ${name}: ${e2.message}`); }
        try { console.log(`[destroy] - removing ${name}...`); execSync(`${runtime} rm ${name}`, { stdio: 'ignore' }); console.log(`[destroy] - removed ${name}`); } catch (e3) { console.log(`[destroy] - rm failed for ${name}: ${e3.message}`); }
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
    const removedList = [];
    for (const [name, rec] of Object.entries(agents)) {
        if (rec && rec.type && rec.projectPath === cwd) {
            try { stopAndRemove(name); delete agents[name]; removedList.push(name); }
            catch (e) { console.log(`[destroy] ${name} error: ${e?.message||e}`); }
        }
    }
    saveAgentsMap(agents);
    return removedList;
}

// Session container tracking (optional helpers)
const SESSION = new Set();
function addSessionContainer(name) { if (name) try { SESSION.add(name); } catch (_) {} }
function cleanupSessionSet() { const list = Array.from(SESSION); stopAndRemoveMany(list); SESSION.clear(); return list.length; }

function getAgentsRegistry() { return loadAgentsMap(); }

module.exports = { runCommandInContainer, ensureAgentContainer, getAgentContainerName, getRuntime, ensureAgentCore, startAgentContainer, stopAndRemove, stopAndRemoveMany, destroyAllPloinky, addSessionContainer, cleanupSessionSet, listAllContainerNames, destroyWorkspaceContainers, getAgentsRegistry, startConfiguredAgents, stopConfiguredAgents, ensureAgentService, getServiceContainerName };

// Build exec args for attaching to a running container with sh -lc and a given entry command.
// Returns an array suitable to be used with spawn/spawnSync: [ 'exec', '-it', <container>, 'sh', '-lc', <cmd> ]
function buildExecArgs(containerName, workdir, entryCommand, interactive = true) {
    const wd = workdir || process.cwd();
    const cmd = entryCommand && String(entryCommand).trim() ? entryCommand : 'exec sh';
    const args = ['exec'];
    if (interactive) args.push('-it');
    args.push(containerName, 'sh', '-lc', `cd '${wd}' && ${cmd}`);
    return args;
}

module.exports.buildExecArgs = buildExecArgs;

// Attach to a running container and run a command interactively with proper TTY.
// Returns the exit code from the spawned process.
function attachInteractive(containerName, workdir, entryCommand) {
    const runtime = containerRuntime;
    const { spawnSync } = require('child_process');
    const execArgs = buildExecArgs(containerName, workdir, entryCommand, true);
    const res = spawnSync(runtime, execArgs, { stdio: 'inherit' });
    return res.status ?? 0;
}

module.exports.attachInteractive = attachInteractive;

function computeEnvHash(manifest) {
    try {
        const map = buildEnvMap(manifest);
        const sorted = Object.keys(map).sort().reduce((o,k)=>{o[k]=map[k];return o;},{});
        const data = JSON.stringify(sorted);
        return require('crypto').createHash('sha256').update(data).digest('hex');
    } catch (_) {
        return '';
    }
}

function getContainerLabel(containerName, key) {
    try {
        const out = execSync(`${containerRuntime} inspect ${containerName} --format '{{ json .Config.Labels }}'`, { stdio: 'pipe' }).toString();
        const labels = JSON.parse(out || '{}') || {};
        return labels[key] || '';
    } catch (_) { return ''; }
}

// Ensure an agent service is running on container port 7000 mapped to random host port (>10000)
// Ensure an agent service is running on container port 7000 mapped to random host port (>10000).
// Uses the same mounting strategy as startAgentContainer. Falls back to /Agent/AgentServer.sh if no agent command set.
function ensureAgentService(agentName, manifest, agentPath, preferredHostPort) {
    const runtime = containerRuntime;
    const repoName = path.basename(path.dirname(agentPath));
    // Use a dedicated service container name with cwd hash to avoid clashes across workspaces
    const containerName = getServiceContainerName(agentName);
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    const cwd = process.cwd();
    const agentLibPath = path.resolve(__dirname, '../../Agent');
    const absAgentPath = path.resolve(agentPath);

    // If container exists, ensure it's running and return current mapped port.
    let createdNew = false;
    if (containerExists(containerName)) {
        // Recreate container if env hash changed or missing
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${runtime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch(_) {}
        }
    }
    if (containerExists(containerName)) {
        if (!isContainerRunning(containerName)) {
            try { execSync(`${runtime} start ${containerName}`, { stdio: 'inherit' }); } catch (e) { debugLog(`start ${containerName} error: ${e.message}`); }
        }
        try {
            const portMap = execSync(`${runtime} port ${containerName} 7000/tcp`, { stdio: 'pipe' }).toString().trim();
            const hostPort = parseHostPort(portMap);
            if (hostPort) { return { containerName, hostPort }; }
            // No mapping; remove and recreate below
            try { execSync(`${runtime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch(_) {}
        } catch (_) {
            // Fall through to recreate if mapping cannot be determined
        }
    }

    const hostPort = preferredHostPort || (10000 + Math.floor(Math.random() * 50000));
    // Build run args with mounts:
    // - Mount current directory RW at same path (workdir = cwd)
    // - Mount Agent library RO at /agent
    // - Mount agentPath RO at /code (for apps expecting /code)
    const envHash2 = computeEnvHash(manifest);
    const args = ['run', '-d', '-p', `${hostPort}:7000`, '--name', containerName, '--label', `ploinky.envhash=${envHash2}`,
        '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime==='podman'?':z':''}`,
        '-v', `${agentLibPath}:/Agent${runtime==='podman'?':ro,z':':ro'}`,
        '-v', `${absAgentPath}:/code${runtime==='podman'?':ro,z':':ro'}`
    ];
    const envFlags2 = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags2.length) args.push(...envFlags2);
    const cmd = agentCmd || 'sh /Agent/AgentServer.sh';
    args.push(image, '/bin/sh', '-lc', cmd);
    const { spawnSync } = require('child_process');
    const runRes = spawnSync(runtime, args, { stdio: 'inherit' });
    if (runRes.status !== 0) { throw new Error(`${runtime} run failed with code ${runRes.status}`); }
    createdNew = true;

    // Save to registry
    const agents = loadAgentsMap();
    const declaredEnvNames3 = [ ...(manifest.env||[]), ...getExposedNames(manifest) ];
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
            env: Array.from(new Set(declaredEnvNames3)).map(name => ({ name })),
            ports: [ { containerPort: 7000, hostPort } ]
        }
    };
    saveAgentsMap(agents);

    // Run install once on first creation
    try {
        if (createdNew && manifest.install && String(manifest.install).trim()) {
            console.log(`[install] running for '${agentName}'...`);
            const cwd = process.cwd();
            const installCmd = `${runtime} exec ${containerName} sh -lc "cd '${cwd}' && ${manifest.install}"`;
            debugLog(`Executing install (service): ${installCmd}`);
            execSync(installCmd, { stdio: 'inherit' });
        }
    } catch (e) {
        console.log(`[install] ${agentName}: ${e?.message||e}`);
    }
    return { containerName, hostPort };
}
module.exports.ensureAgentService = ensureAgentService;
