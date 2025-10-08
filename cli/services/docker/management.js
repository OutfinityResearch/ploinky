import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getExposedNames, getManifestEnvNames, buildEnvFlags } from '../secretVars.js';
import { debugLog } from '../utils.js';
import {
    CONTAINER_CONFIG_PATH,
    PLOINKY_DIR,
    containerRuntime,
    containerExists,
    computeEnvHash,
    getAgentContainerName,
    getConfiguredProjectPath,
    getContainerLabel,
    getRuntime,
    getSecretsForAgent,
    getServiceContainerName,
    isContainerRunning,
    loadAgentsMap,
    parseHostPort,
    parseManifestPorts,
    saveAgentsMap,
    syncAgentMcpConfig,
    REPOS_DIR,
    flagsToArgs
} from './common.js';

import { loadAgents } from '../workspace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startConfiguredAgents() {
    const agents = loadAgents();
    const names = Object.entries(agents || {})
        .filter(([name, rec]) => rec && (rec.type === 'agent' || rec.type === 'agentCore') && typeof name === 'string' && !name.startsWith('_'))
        .map(([name]) => name);
    const startedList = [];
    for (const name of names) {
        try {
            if (!isContainerRunning(name) && containerExists(name)) {
                execSync(`${containerRuntime} start ${name}`, { stdio: 'ignore' });
                startedList.push(name);
            }
        } catch (e) {
            debugLog(`startConfiguredAgents: ${name} ${e?.message || e}`);
        }
    }
    return startedList;
}

function gracefulStopContainer(name, { prefix = '[destroy]' } = {}) {
    const exists = containerExists(name);
    if (!exists) return false;

    const log = (msg) => console.log(`${prefix} ${msg}`);
    if (!isContainerRunning(name)) {
        log(`${name} already stopped.`);
        return true;
    }

    try {
        log(`Sending SIGTERM to ${name}...`);
        execSync(`${containerRuntime} kill --signal SIGTERM ${name}`, { stdio: 'ignore' });
    } catch (e) {
        debugLog(`gracefulStopContainer SIGTERM ${name}: ${e?.message || e}`);
    }
    return true;
}

function waitForContainers(names, timeoutSec = 5) {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
        const stillRunning = names.filter((name) => isContainerRunning(name));
        if (!stillRunning.length) return [];
        try { execSync('sleep 1', { stdio: 'ignore' }); } catch (_) {}
    }
    return names.filter((name) => isContainerRunning(name));
}

function forceStopContainers(names, { prefix } = {}) {
    for (const name of names) {
        try {
            console.log(`${prefix} Forcing kill for ${name}...`);
            execSync(`${containerRuntime} kill ${name}`, { stdio: 'ignore' });
        } catch (e) {
            debugLog(`forceStopContainers kill ${name}: ${e?.message || e}`);
        }
    }
}

function getContainerCandidates(name, rec) {
    const candidates = new Set();
    if (name) candidates.add(name);
    if (rec && rec.agentName) {
        try { candidates.add(getServiceContainerName(rec.agentName)); } catch (_) {}
        try {
            const repoName = rec.repoName || '';
            candidates.add(getAgentContainerName(rec.agentName, repoName));
        } catch (_) {}
    }
    return Array.from(candidates);
}

function stopConfiguredAgents() {
    const agents = loadAgents();
    const entries = Object.entries(agents || {})
        .filter(([name, rec]) => rec && (rec.type === 'agent' || rec.type === 'agentCore') && typeof name === 'string' && !name.startsWith('_'));
    const candidateSet = new Set();
    for (const [name, rec] of entries) {
        const candidates = getContainerCandidates(name, rec).filter((candidate) => candidate && containerExists(candidate));
        if (!candidates.length) {
            const label = rec?.agentName ? `${rec.agentName}` : name;
            console.log(`[stop] ${label}: no running container found.`);
        }
        for (const candidate of candidates) candidateSet.add(candidate);
    }

    const allCandidates = Array.from(candidateSet);
    if (!allCandidates.length) return [];

    allCandidates.forEach((name) => gracefulStopContainer(name, { prefix: '[stop]' }));
    const remaining = waitForContainers(allCandidates, 5);
    if (remaining.length) {
        forceStopContainers(remaining, { prefix: '[stop]' });
        waitForContainers(remaining, 2);
    }

    const stopped = allCandidates.filter((name) => !isContainerRunning(name));
    stopped.forEach((name) => console.log(`[stop] Stopped ${name}`));
    return stopped;
}

async function ensureAgentCore(manifest, agentPath) {
    const containerName = getServiceContainerName(manifest.name);
    const portFilePath = path.join(PLOINKY_DIR, 'running_agents', `${containerName}.port`);
    const lockDir = path.join(PLOINKY_DIR, 'locks');
    const lockFile = path.join(lockDir, `container_${containerName}.lock`);

    fs.mkdirSync(lockDir, { recursive: true });
    let retries = 50;
    while (retries > 0) {
        try { fs.mkdirSync(lockFile); break; }
        catch (e) {
            if (e.code === 'EEXIST') { await new Promise((r) => setTimeout(r, 200)); retries--; }
            else { throw e; }
        }
    }
    if (retries === 0) throw new Error(`Could not acquire lock for container ${containerName}. It might be stuck.`);

    try {
        if (fs.existsSync(portFilePath)) {
            const cachedPort = fs.readFileSync(portFilePath, 'utf8').trim();
            if (cachedPort) {
                try {
                    const runningContainer = execSync(`${containerRuntime} ps --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
                    if (runningContainer === containerName) {
                        return { containerName, hostPort: cachedPort };
                    }
                } catch (_) {}
            }
        }

        const existingContainer = execSync(`${containerRuntime} ps -a --filter name=^/${containerName}$ --format "{{.Names}}"`).toString().trim();
        if (existingContainer === containerName) {
            const portMapping = execSync(`${containerRuntime} port ${containerName} 8080/tcp`).toString().trim();
            const hostPort = parseHostPort(portMapping);
            if (!hostPort) throw new Error(`Could not determine host port for running container ${containerName}`);
            fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
            fs.writeFileSync(portFilePath, hostPort);
            const agents = loadAgentsMap();
            if (!agents[containerName]) {
                agents[containerName] = {
                    agentName: manifest.name,
                    repoName: path.basename(path.dirname(agentPath)),
                    containerImage: manifest.container || manifest.image || 'node:18-alpine',
                    createdAt: new Date().toISOString(),
                    projectPath: process.cwd(),
                    type: 'agentCore',
                    config: { binds: [{ source: agentPath, target: '/agent' }], env: [{ name: 'PORT', value: '8080' }], ports: [{ containerPort: 8080, hostPort }] }
                };
                saveAgentsMap(agents);
            }
            return { containerName, hostPort };
        }

        const image = manifest.container || manifest.image || 'node:18-alpine';
        const agentCorePath = path.resolve(__dirname, '../../../agentCore');
        const args = ['run', '-d', '-p', '8080', '--name', containerName,
            '-v', `${agentPath}:/agent:z`, '-v', `${agentCorePath}:/agentCore:z`];
        if (manifest.runTask) {
            args.push('-e', `RUN_TASK=${manifest.runTask}`, '-e', 'CODE_DIR=/agent');
        }
        args.push('-e', 'PORT=8080', image, 'node', '/agentCore/server.js');
        execSync(`${containerRuntime} ${args.join(' ')}`, { stdio: 'inherit' });
        await new Promise((r) => setTimeout(r, 2000));
        const portMapping = execSync(`${containerRuntime} port ${containerName} 8080/tcp`).toString().trim();
        const hostPort = parseHostPort(portMapping);
        if (!hostPort) throw new Error(`Could not determine host port for new container ${containerName}`);
        fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
        fs.writeFileSync(portFilePath, hostPort);
        const agents = loadAgentsMap();
        agents[containerName] = {
            agentName: manifest.name,
            repoName: path.basename(path.dirname(agentPath)),
            containerImage: image,
            createdAt: new Date().toISOString(),
            projectPath: process.cwd(),
            type: 'agentCore',
            config: {
                binds: [
                    { source: agentPath, target: '/agent' },
                    { source: path.resolve(__dirname, '../../../agentCore'), target: '/agentCore' }
                ],
                env: [
                    ...(manifest.runTask ? [{ name: 'RUN_TASK', value: String(manifest.runTask) }, { name: 'CODE_DIR', value: '/agent' }] : []),
                    { name: 'PORT', value: '8080' }
                ],
                ports: [{ containerPort: 8080, hostPort }]
            }
        };
        saveAgentsMap(agents);
        return { containerName, hostPort };
    } finally {
        try { fs.rmdirSync(lockFile); } catch (_) {}
    }
}

function startAgentContainer(agentName, manifest, agentPath, options = {}) {
    const containerName = getServiceContainerName(agentName);
    try { execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
    try { execSync(`${containerRuntime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) {}

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    const cwd = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)));
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const envHash = computeEnvHash(manifest);
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`,
        '-v', `${agentLibPath}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        '-v', `${path.resolve(agentPath)}:/code${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        '-v', `${nodeModulesPath}:/node_modules${runtime === 'podman' ? ':ro,z' : ':ro'}`
    ];

    if (manifest.volumes && typeof manifest.volumes === 'object') {
        const workspaceRoot = getConfiguredProjectPath('.', '');
        for (const [hostPath, containerPath] of Object.entries(manifest.volumes)) {
            const resolvedHostPath = path.isAbsolute(hostPath)
                ? hostPath
                : path.resolve(workspaceRoot, hostPath);
            if (!fs.existsSync(resolvedHostPath)) {
                fs.mkdirSync(resolvedHostPath, { recursive: true });
            }
            args.push('-v', `${resolvedHostPath}:${containerPath}${runtime === 'podman' ? ':z' : ''}`);
        }
    }

    const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
    const runtimePorts = (options && Array.isArray(options.publish)) ? options.publish : [];
    const pubs = [...manifestPorts, ...runtimePorts];
    for (const p of pubs) {
        if (!p) continue;
        args.splice(1, 0, '-p', String(p));
    }
    const envStrings = [...buildEnvFlags(manifest), `-e PLOINKY_MCP_CONFIG_PATH=${CONTAINER_CONFIG_PATH}`];
    const envFlags = flagsToArgs(envStrings);
    if (envFlags.length) args.push(...envFlags);
    args.push('-e', 'NODE_PATH=/node_modules');

    args.push(image);
    if (agentCmd) {
        const needsShell = /[;&|$`\n(){}]/.test(agentCmd);
        if (needsShell) {
            args.push('/bin/sh', '-lc', agentCmd);
        } else {
            const cmdParts = agentCmd.split(/\s+/).filter(Boolean);
            args.push(...cmdParts);
        }
    } else {
        args.push('/bin/sh', '-lc', 'sh /Agent/server/AgentServer.sh');
    }

    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) { throw new Error(`${runtime} run failed with code ${res.status}`); }
    const agents = loadAgentsMap();
    const declaredEnvNames2 = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
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
                { source: agentLibPath, target: '/Agent' },
                { source: agentPath, target: '/code' }
            ],
            env: Array.from(new Set(declaredEnvNames2)).map((name) => ({ name })),
            ports: portMappings
        }
    };
    saveAgentsMap(agents);
    syncAgentMcpConfig(containerName, path.resolve(agentPath));
    return containerName;
}

function stopAndRemove(name) {
    const agents = loadAgents();
    const rec = agents ? agents[name] : null;
    const candidates = getContainerCandidates(name, rec);
    const existing = candidates.filter((candidate) => candidate && containerExists(candidate));
    if (!existing.length) return;

    existing.forEach((candidate) => gracefulStopContainer(candidate, { prefix: '[destroy]' }));
    const remaining = waitForContainers(existing, 5);
    if (remaining.length) {
        forceStopContainers(remaining, { prefix: '[destroy]' });
        waitForContainers(remaining, 2);
    }

    for (const candidate of existing) {
        try {
            console.log(`[destroy] Removing container: ${candidate}`);
            execSync(`${containerRuntime} rm ${candidate}`, { stdio: 'ignore' });
            console.log(`[destroy] ✓ removed ${candidate}`);
        } catch (e) {
            console.log(`[destroy] rm failed for ${candidate}: ${e.message}. Trying force removal...`);
            try {
                execSync(`${containerRuntime} rm -f ${candidate}`, { stdio: 'ignore' });
                console.log(`[destroy] ✓ force removed ${candidate}`);
            } catch (e2) {
                console.log(`[destroy] force remove failed for ${candidate}: ${e2.message}`);
            }
        }
    }
}

function stopAndRemoveMany(names) {
    if (!Array.isArray(names)) return;
    for (const n of names) {
        try { stopAndRemove(n); } catch (e) { debugLog(`stopAndRemoveMany ${n} error: ${e?.message || e}`); }
    }
}

function listAllContainerNames() {
    try {
        const out = execSync(`${containerRuntime} ps -a --format "{{.Names}}"`, { stdio: 'pipe' }).toString().trim();
        return out ? out.split(/\n+/).filter(Boolean) : [];
    } catch (e) {
        debugLog(`listAllContainerNames error: ${e?.message || e}`);
        return [];
    }
}

function destroyAllPloinky() {
    const names = listAllContainerNames().filter((n) => n.startsWith('ploinky_'));
    stopAndRemoveMany(names);
    return names.length;
}

function destroyWorkspaceContainers() {
    const agents = loadAgentsMap();
    const removedList = [];
    for (const [name, rec] of Object.entries(agents || {})) {
        if (!rec || typeof name !== 'string' || name.startsWith('_')) continue;
        if (rec.type === 'agent' || rec.type === 'agentCore') {
            try {
                stopAndRemove(name);
                delete agents[name];
                removedList.push(name);
            } catch (e) {
                console.log(`[destroy] ${name} error: ${e?.message || e}`);
            }
        }
    }
    saveAgentsMap(agents);
    return removedList;
}

function getAgentsRegistry() {
    return loadAgentsMap();
}

function applyAgentStartupConfig(agentName, manifest, agentPath, containerName) {
    try {
        if (!manifest || typeof manifest !== 'object') return;
        const webchatSetupCmd = (typeof manifest.webchat === 'string' && manifest.webchat.trim()) ? manifest.webchat.trim() : '';
        if (webchatSetupCmd) {
            console.log('Executing webchat config...');
            console.log(`[webchat] configuring for '${agentName}'...`);
            const out = execSync(`sh -lc "${webchatSetupCmd.replace(/"/g, '\\"')}"`, { stdio: ['ignore','pipe','inherit'] }).toString();
            try { if (out && out.trim()) process.stdout.write(out); } catch (_) {}
            try {
                const agents = loadAgentsMap();
                const key = containerName || getServiceContainerName(agentName);
                const repoName = path.basename(path.dirname(agentPath));
                const image = manifest.container || manifest.image || 'node:18-alpine';
                const projPath = getConfiguredProjectPath(agentName, repoName);
                const record = agents[key] || (agents[key] = {
                    agentName,
                    repoName,
                    containerImage: image,
                    createdAt: new Date().toISOString(),
                    projectPath: projPath,
                    type: 'agent',
                    config: { binds: [], env: [], ports: [] }
                });
                record.webchatSetupOutput = (out || '').split(/\n/).slice(-5).join('\n');
                record.webchatSetupAt = new Date().toISOString();
                saveAgentsMap(agents);
            } catch (_) {}
        }
    } catch (e) {
        console.log(`[setup] ${agentName}: ${e?.message || e}`);
    }
}

function ensureAgentService(agentName, manifest, agentPath, preferredHostPort) {
    const repoName = path.basename(path.dirname(agentPath));
    const containerName = getServiceContainerName(agentName);
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const webchatSetupCmd = (manifest && typeof manifest.webchat === 'string' && manifest.webchat.trim()) ? manifest.webchat.trim() : '';

    let createdNew = false;
    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
        }
    }
    if (containerExists(containerName)) {
        if (!isContainerRunning(containerName)) {
            applyAgentStartupConfig(agentName, manifest, agentPath, containerName);
            try { execSync(`${containerRuntime} start ${containerName}`, { stdio: 'inherit' }); } catch (e) { debugLog(`start ${containerName} error: ${e.message}`); }
        }
        try {
            const portMap = execSync(`${containerRuntime} port ${containerName} 7000/tcp`, { stdio: 'pipe' }).toString().trim();
            const hostPort = parseHostPort(portMap);
            if (hostPort) {
                syncAgentMcpConfig(containerName, agentPath);
                return { containerName, hostPort };
            }
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
        } catch (_) {}
    }

    applyAgentStartupConfig(agentName, manifest, agentPath, containerName);

    const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
    let additionalPorts = [];
    let allPortMappings = [...portMappings];

    if (manifestPorts.length === 0) {
        const hostPort = preferredHostPort || (10000 + Math.floor(Math.random() * 50000));
        additionalPorts = [`${hostPort}:7000`];
        allPortMappings = [{ containerPort: 7000, hostPort }];
    }

    startAgentContainer(agentName, manifest, agentPath, { publish: additionalPorts });
    createdNew = true;

    const agents = loadAgentsMap();
    const declaredEnvNames3 = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
    const projPath = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)));
    agents[containerName] = {
        agentName,
        repoName,
        containerImage: image,
        createdAt: new Date().toISOString(),
        projectPath: projPath,
        type: 'agent',
        config: {
            binds: [
                { source: projPath, target: projPath },
                { source: path.resolve(__dirname, '../../../Agent'), target: '/agent', ro: true },
                { source: agentPath, target: '/code', ro: true }
            ],
            env: Array.from(new Set(declaredEnvNames3)).map((name) => ({ name })),
            ports: allPortMappings
        }
    };
    saveAgentsMap(agents);

    try {
        if (createdNew && manifest.install && String(manifest.install).trim()) {
            console.log(`[install] running for '${agentName}'...`);
            const cwd = projPath;
            const installCmd = `${containerRuntime} exec ${containerName} sh -lc "cd '${cwd}' && ${manifest.install}"`;
            debugLog(`Executing install (service): ${installCmd}`);
            execSync(installCmd, { stdio: 'inherit' });
        }
    } catch (e) {
        console.log(`[install] ${agentName}: ${e?.message || e}`);
    }
    syncAgentMcpConfig(containerName, agentPath);
    const returnPort = allPortMappings.find((p) => p.containerPort === 7000)?.hostPort || allPortMappings[0]?.hostPort || 0;
    return { containerName, hostPort: returnPort };
}

const SESSION = new Set();

function addSessionContainer(name) {
    if (name) {
        try { SESSION.add(name); } catch (_) {}
    }
}

function cleanupSessionSet() {
    const list = Array.from(SESSION);
    stopAndRemoveMany(list);
    SESSION.clear();
    return list.length;
}

export {
    addSessionContainer,
    applyAgentStartupConfig,
    cleanupSessionSet,
    destroyAllPloinky,
    destroyWorkspaceContainers,
    ensureAgentCore,
    ensureAgentService,
    getAgentsRegistry,
    getRuntime,
    listAllContainerNames,
    startAgentContainer,
    startConfiguredAgents,
    stopAndRemove,
    stopAndRemoveMany,
    stopConfiguredAgents
};
