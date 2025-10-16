import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getExposedNames, getManifestEnvNames, buildEnvFlags, formatEnvFlag } from '../secretVars.js';
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

function parseAgentInfoFromMounts(mounts = []) {
    let repoName = '-';
    let agentName = '-';
    for (const mount of mounts) {
        if (mount.Destination === '/code' && mount.Source) {
            const parts = mount.Source.split(path.sep).filter(Boolean);
            const reposIdx = parts.lastIndexOf('repos');
            if (reposIdx !== -1 && reposIdx + 2 < parts.length) {
                repoName = parts[reposIdx + 1];
                agentName = parts[reposIdx + 2];
                break;
            }
        }
    }
    return { repoName, agentName };
}

function formatPortBindings(bindings = {}, defaultContainerPort = '') {
    const results = [];
    for (const [containerSpec, hostEntries] of Object.entries(bindings || {})) {
        const containerPort = parseInt(containerSpec, 10) || parseInt(containerSpec.split('/')[0], 10) || defaultContainerPort;
        if (Array.isArray(hostEntries)) {
            for (const entry of hostEntries) {
                if (!entry) continue;
                results.push({
                    hostIp: entry.HostIp || '127.0.0.1',
                    hostPort: entry.HostPort || '',
                    containerPort
                });
            }
        }
    }
    return results;
}

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

function chunkArray(list, size = 8) {
    const chunks = [];
    if (!Array.isArray(list) || size <= 0) return chunks;
    for (let i = 0; i < list.length; i += size) {
        chunks.push(list.slice(i, i + size));
    }
    return chunks;
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
        try { execSync('sleep 1', { stdio: 'ignore' }); } catch (_) { }
    }
    return names.filter((name) => isContainerRunning(name));
}

function forceStopContainers(names, { prefix } = {}) {
    if (!Array.isArray(names) || !names.length) return;
    for (const chunk of chunkArray(names)) {
        try {
            console.log(`${prefix} Forcing kill for ${chunk.join(', ')}...`);
            execSync(`${containerRuntime} kill ${chunk.join(' ')}`, { stdio: 'ignore' });
        } catch (e) {
            debugLog(`forceStopContainers kill ${chunk.join(', ')}: ${e?.message || e}`);
            for (const name of chunk) {
                try {
                    console.log(`${prefix} Forcing kill for ${name}...`);
                    execSync(`${containerRuntime} kill ${name}`, { stdio: 'ignore' });
                } catch (err) {
                    debugLog(`forceStopContainers (single) kill ${name}: ${err?.message || err}`);
                }
            }
        }
    }
}

function getContainerCandidates(name, rec) {
    const candidates = new Set();
    if (name) candidates.add(name);
    if (rec && rec.agentName) {
        try { candidates.add(getServiceContainerName(rec.agentName)); } catch (_) { }
        try {
            const repoName = rec.repoName || '';
            candidates.add(getAgentContainerName(rec.agentName, repoName));
        } catch (_) { }
    }
    return Array.from(candidates);
}

function stopConfiguredAgents({ fast = false } = {}) {
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
                } catch (_) { }
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
        if (containerRuntime === 'podman') {
            args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
        }
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
        try { fs.rmdirSync(lockFile); } catch (_) { }
    }
}

function runInstallHook(agentName, manifest, agentPath, cwd) {
    const installCmd = String(manifest.install || '').trim();
    if (!installCmd) return;

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = projectRoot ? path.join(projectRoot, 'node_modules') : null;
    const volZ = runtime === 'podman' ? ':z' : '';
    const roZ = runtime === 'podman' ? ':ro,z' : ':ro';

    const args = ['run', '--rm', '-w', cwd,
        '-v', `${cwd}:${cwd}${volZ}`,
        '-v', `${agentLibPath}:/Agent${roZ}`,
        '-v', `${path.resolve(agentPath)}:/code${roZ}`
    ];
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }
    if (nodeModulesPath) {
        args.push('-v', `${nodeModulesPath}:/node_modules${roZ}`);
    }
    const envFlags = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags.length) args.push(...envFlags);
    console.log(`[install] ${agentName}: cd '${cwd}' && ${installCmd}`);
    args.push(image, '/bin/sh', '-lc', `cd '${cwd}' && ${installCmd}`);
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error(`[install] ${agentName}: command exited with ${res.status}`);
    }
}

function startAgentContainer(agentName, manifest, agentPath, options = {}) {
    const containerName = getServiceContainerName(agentName);
    try { execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    try { execSync(`${containerRuntime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) { }

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const agentCmd = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    const cwd = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)));
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const envHash = computeEnvHash(manifest);
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = path.join(projectRoot, 'node_modules');

    runInstallHook(agentName, manifest, agentPath, cwd);

    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`,
        '-v', `${agentLibPath}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        '-v', `${path.resolve(agentPath)}:/code${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        '-v', `${nodeModulesPath}:/node_modules${runtime === 'podman' ? ':ro,z' : ':ro'}`
    ];
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }

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
    const envStrings = [...buildEnvFlags(manifest), formatEnvFlag('PLOINKY_MCP_CONFIG_PATH', CONTAINER_CONFIG_PATH)];
    envStrings.push(formatEnvFlag('AGENT_NAME', agentName));
    const envFlags = flagsToArgs(envStrings);
    if (envFlags.length) args.push(...envFlags);
    args.push('-e', 'NODE_PATH=/node_modules');

    args.push(image);
    let entrySummary = 'sh /Agent/server/AgentServer.sh';
    if (agentCmd) {
        const needsShell = /[;&|$`\n(){}]/.test(agentCmd);
        if (needsShell) {
            args.push('/bin/sh', '-lc', agentCmd);
            entrySummary = agentCmd;
        } else {
            const cmdParts = agentCmd.split(/\s+/).filter(Boolean);
            args.push(...cmdParts);
            entrySummary = cmdParts.join(' ');
        }
    } else {
        args.push('/bin/sh', '-lc', 'sh /Agent/server/AgentServer.sh');
    }

    console.log(`[start] ${agentName}: ${runtime} run (cwd='${cwd}') -> ${entrySummary}`);
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

function stopAndRemoveMany(names, { fast = false } = {}) {
    if (!Array.isArray(names) || !names.length) return [];

    const agents = loadAgents();
    const removalSet = new Set();
    const runningSet = new Set();

    for (const agentName of names) {
        if (!agentName) continue;
        const rec = agents ? agents[agentName] : null;
        const candidates = getContainerCandidates(agentName, rec);
        for (const candidate of candidates) {
            if (!candidate || !containerExists(candidate)) continue;
            removalSet.add(candidate);
            if (isContainerRunning(candidate)) {
                runningSet.add(candidate);
            }
        }
    }

    if (!removalSet.size) return [];

    const prefix = fast ? '[destroy-fast]' : '[destroy]';
    const runningList = Array.from(runningSet);
    if (runningList.length) {
        console.log(`${prefix} Sending SIGTERM to ${runningList.length} container(s)...`);
        for (const chunk of chunkArray(runningList)) {
            try {
                execSync(`${containerRuntime} kill --signal SIGTERM ${chunk.join(' ')}`, { stdio: 'ignore' });
            } catch (e) {
                debugLog(`batch SIGTERM failed for ${chunk.join(', ')}: ${e?.message || e}`);
                for (const name of chunk) {
                    gracefulStopContainer(name, { prefix });
                }
            }
        }
    }

    const waitSeconds = fast ? 0.1 : 5;
    const stillRunning = runningList.length ? waitForContainers(runningList, waitSeconds) : [];
    if (stillRunning.length) {
        forceStopContainers(stillRunning, { prefix });
    }

    const removalList = Array.from(removalSet);
    const removed = [];
    for (const chunk of chunkArray(removalList)) {
        try {
            console.log(`${prefix} Removing containers: ${chunk.join(', ')}`);
            execSync(`${containerRuntime} rm -f ${chunk.join(' ')}`, { stdio: 'ignore' });
            chunk.forEach((name) => {
                console.log(`${prefix} ✓ removed ${name}`);
                removed.push(name);
            });
        } catch (e) {
            debugLog(`batch rm failed for ${chunk.join(', ')}: ${e?.message || e}`);
            for (const name of chunk) {
                try {
                    console.log(`${prefix} Removing container: ${name}`);
                    execSync(`${containerRuntime} rm -f ${name}`, { stdio: 'ignore' });
                    console.log(`${prefix} ✓ removed ${name}`);
                    removed.push(name);
                } catch (err) {
                    console.log(`${prefix} rm failed for ${name}: ${err?.message || err}`);
                }
            }
        }
    }

    return removed;
}

function stopAndRemove(name, fast = false) {
    if (!name) return [];
    return stopAndRemoveMany([name], { fast }) || [];
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

function destroyAllPloinky({ fast = false } = {}) {
    const names = listAllContainerNames().filter((n) => n.startsWith('ploinky_'));
    stopAndRemoveMany(names, { fast });
    return names.length;
}

function destroyWorkspaceContainers({ fast = false } = {}) {
    const agents = loadAgentsMap();
    const names = [];
    for (const [name, rec] of Object.entries(agents || {})) {
        if (!rec || typeof name !== 'string' || name.startsWith('_')) continue;
        if (rec.type === 'agent' || rec.type === 'agentCore') {
            names.push(name);
        }
    }
    return stopAndRemoveMany(names, { fast });
}

function getAgentsRegistry() {
    return loadAgentsMap();
}

function collectLiveAgentContainers() {
    const runtime = containerRuntime;
    let names = [];
    try {
        const raw = execSync(`${runtime} ps --format "{{.Names}}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (raw) {
            names = raw.split(/\n+/).map((n) => n.trim()).filter((n) => n.startsWith('ploinky_'));
        }
    } catch (_) {
        return [];
    }
    const results = [];
    for (const name of names) {
        try {
            const inspectRaw = execSync(`${runtime} inspect ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            const parsed = JSON.parse(inspectRaw);
            if (!Array.isArray(parsed) || !parsed.length) continue;
            const data = parsed[0];
            const mounts = data.Mounts || [];
            const envPairs = Array.isArray(data.Config?.Env) ? data.Config.Env : [];
            const env = envPairs.map((entry) => {
                const idx = entry.indexOf('=');
                const key = idx === -1 ? entry : entry.slice(0, idx);
                return { name: key, value: idx === -1 ? '' : entry.slice(idx + 1) };
            });
            let agentName = env.find((e) => e.name === 'AGENT_NAME')?.value || '-';
            const { repoName, agentName: mountAgent } = parseAgentInfoFromMounts(mounts);
            if (agentName === '-' && mountAgent && mountAgent !== '-') {
                agentName = mountAgent;
            }
            const ports = formatPortBindings(data.NetworkSettings?.Ports || {});
            results.push({
                containerName: name,
                agentName,
                repoName,
                containerImage: data.Config?.Image || '-',
                createdAt: data.Created || '-',
                projectPath: data.Config?.WorkingDir || '-',
                state: {
                    status: data.State?.Status || '-',
                    running: Boolean(data.State?.Running),
                    pid: data.State?.Pid || 0
                },
                config: {
                    binds: mounts.map((m) => ({ source: m.Source, target: m.Destination })),
                    env,
                    ports
                }
            });
        } catch (error) {
            debugLog(`collectLiveAgentContainers: ${name} ${error?.message || error}`);
        }
    }
    return results;
}

function applyAgentStartupConfig(agentName, manifest, agentPath, containerName) {
    try {
        if (!manifest || typeof manifest !== 'object') return;
        const webchatSetupCmd = (typeof manifest.webchat === 'string' && manifest.webchat.trim()) ? manifest.webchat.trim() : '';
        if (webchatSetupCmd) {
            console.log('Executing webchat config...');
            console.log(`[webchat] configuring for '${agentName}'...`);
            const out = execSync(`sh -lc "${webchatSetupCmd.replace(/"/g, '\\"')}"`, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
            try { if (out && out.trim()) process.stdout.write(out); } catch (_) { }
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
            } catch (_) { }
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
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
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
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
        } catch (_) { }
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

    syncAgentMcpConfig(containerName, agentPath);
    const returnPort = allPortMappings.find((p) => p.containerPort === 7000)?.hostPort || allPortMappings[0]?.hostPort || 0;
    return { containerName, hostPort: returnPort };
}

const SESSION = new Set();

function addSessionContainer(name) {
    if (name) {
        try { SESSION.add(name); } catch (_) { }
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
    collectLiveAgentContainers,
    listAllContainerNames,
    startAgentContainer,
    startConfiguredAgents,
    stopAndRemove,
    stopAndRemoveMany,
    stopConfiguredAgents
};
