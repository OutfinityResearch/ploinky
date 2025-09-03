const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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
    const containerName = `ploinky_${safeRepoName}_${safeAgentName}`;
    debugLog(`Calculated container name: ${containerName}`);
    return containerName;
}

function isContainerRunning(containerName) {
    const command = `${containerRuntime} ps -q -f name=^${containerName}$`;
    debugLog(`Checking if container is running with command: ${command}`);
    try {
        const result = execSync(command).toString();
        return result.trim().length > 0;
    } catch (error) {
        return false;
    }
}

function containerExists(containerName) {
    const command = `${containerRuntime} ps -a -q -f name=^${containerName}$`;
    debugLog(`Checking if container exists with command: ${command}`);
    try {
        const result = execSync(command).toString();
        return result.trim().length > 0;
    } catch (error) {
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
    const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));

    let firstRun = false;
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVars = getSecretsForAgent(manifest).join(' ');
        const createCommand = `${containerRuntime} create -it --name ${containerName} -v "${process.cwd()}:${process.cwd()}" ${envVars} ${manifest.container} /bin/bash`;
        debugLog(`Executing create command: ${createCommand}`);
        execSync(createCommand, { stdio: 'inherit' });
        agents[containerName] = { agentName, repoName };
        fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
        debugLog(`Updated agents file at: ${AGENTS_FILE}`);
        firstRun = true;
    }

    if (!isContainerRunning(containerName)) {
        const startCommand = `${containerRuntime} start ${containerName}`;
        debugLog(`Executing start command: ${startCommand}`);
        execSync(startCommand, { stdio: 'inherit' });
    }

    if (firstRun && manifest.install) {
        console.log(`Running install command for '${agentName}'...`);
        const installCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} bash -c "cd ${process.cwd()} && ${manifest.install}"`;
        debugLog(`Executing install command: ${installCommand}`);
        execSync(installCommand, { stdio: 'inherit' });
    }

    console.log(`Running command in '${agentName}': ${command}`);
    const execCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} bash -c "cd ${process.cwd()} && ${command}"`;
    debugLog(`Executing run command: ${execCommand}`);
    try {
        execSync(execCommand, { stdio: 'inherit' });
    } catch (error) {
        debugLog(`Caught error during ${containerRuntime} exec. This is often expected if the command exits with a non-zero code.`);
    }
}

module.exports = { runCommandInContainer };