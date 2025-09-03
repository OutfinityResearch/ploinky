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
        const createCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${envVars} ${manifest.container} /bin/bash`;
        
        debugLog(`Executing create command: ${createCommand}`);
        const createOutput = execSync(createCommand, { stdio: 'pipe' }).toString().trim();
        const containerId = createOutput; // The create command returns the container ID
        
        agents[containerName] = { 
            agentName, 
            repoName,
            containerId: containerId,
            containerImage: manifest.container,
            createdAt: new Date().toISOString(),
            projectPath: currentDir
        };
        fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
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
        const installCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} bash -c "cd '${currentDir}' && ${manifest.install}"`;
        debugLog(`Executing install command: ${installCommand}`);
        execSync(installCommand, { stdio: 'inherit' });
    }

    console.log(`Running command in '${agentName}': ${command}`);
    // Prepend cd to the command string itself
    // For interactive sessions, create a clean terminal environment
    let bashCommand;
    let envVars = '';
    
    if (interactive && command === '/bin/bash') {
        // Create a temporary .inputrc to disable bracketed paste and mouse
        const inputrcContent = `
set enable-bracketed-paste off
set enable-mouse off
        `;
        // Use a cleaner approach with environment setup
        bashCommand = `cd '${currentDir}' && exec bash`;
        // Create .inputrc in container to disable problematic features
        const setupCommand = `${containerRuntime} exec ${containerName} bash -c "echo '${inputrcContent}' > /tmp/.inputrc"`;
        try {
            execSync(setupCommand, { stdio: 'pipe' });
            envVars = '-e INPUTRC=/tmp/.inputrc';
        } catch (e) {
            debugLog('Could not create custom .inputrc, continuing without it');
        }
    } else {
        bashCommand = `cd '${currentDir}' && ${command}`;
    }
    
    const execCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${envVars} ${containerName} bash -c "${bashCommand}"`;
    debugLog(`Executing run command: ${execCommand}`);
    try {
        execSync(execCommand, { stdio: 'inherit' });
    } catch (error) {
        debugLog(`Caught error during ${containerRuntime} exec. This is often expected if the command exits with a non-zero code.`);
    }
    
    // Stop the container after interactive sessions to prevent it from staying up
    // Only stop if it was an interactive bash session
    if (interactive && (command === '/bin/bash' || command.includes('bash'))) {
        console.log(`Stopping container ${containerName}...`);
        try {
            const stopCommand = `${containerRuntime} stop ${containerName}`;
            debugLog(`Executing stop command: ${stopCommand}`);
            execSync(stopCommand, { stdio: 'pipe' });
            console.log(`Container stopped.`);
        } catch (e) {
            console.error(`Warning: Could not stop container ${containerName}: ${e.message}`);
            debugLog(`Stop container error details: ${e.toString()}`);
        }
    }
}

module.exports = { runCommandInContainer };
