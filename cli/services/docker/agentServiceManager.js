import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    buildEnvFlags,
    formatEnvFlag,
    getExposedNames,
    getManifestEnvNames,
    resolveVarValue
} from '../secretVars.js';
import { debugLog } from '../utils.js';
import {
    CONTAINER_CONFIG_PATH,
    containerExists,
    containerRuntime,
    computeEnvHash,
    flagsToArgs,
    getAgentContainerName,
    getConfiguredProjectPath,
    getContainerLabel,
    isContainerRunning,
    loadAgentsMap,
    parseHostPort,
    parseManifestPorts,
    saveAgentsMap,
    syncAgentMcpConfig
} from './common.js';
import { clearLivenessState } from './healthProbes.js';
import { stopAndRemove } from './containerFleet.js';
import {
    DEFAULT_AGENT_ENTRY,
    launchAgentSidecar,
    readManifestAgentCommand,
    readManifestStartCommand,
    splitCommandArgs
} from './agentCommands.js';
import { ensureSharedHostDir, runInstallHook, runPostinstallHook } from './agentHooks.js';
import { detectShellForImage, SHELL_FALLBACK_DIRECT } from './shellDetection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');

function startAgentContainer(agentName, manifest, agentPath, options = {}) {
    const repoName = path.basename(path.dirname(agentPath));
    const containerName = options.containerName || getAgentContainerName(agentName, repoName);
    try { execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    try { execSync(`${containerRuntime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    clearLivenessState(containerName);

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const { raw: explicitAgentCmd, resolved: resolvedAgentCmd } = readManifestAgentCommand(manifest);
    const startCmd = readManifestStartCommand(manifest);
    const useStartEntry = Boolean(startCmd);
    const cwd = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)), options.alias);
    const envHash = computeEnvHash(manifest);
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = projectRoot ? path.join(projectRoot, 'node_modules') : null;
    const sharedDir = ensureSharedHostDir();

    runInstallHook(agentName, manifest, agentPath, cwd);

    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', cwd,
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`,
        '-v', `${AGENT_LIB_PATH}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        '-v', `${path.resolve(agentPath)}:/code${resolveVarValue('PLOINKY_CODE_WRITABLE') === '1' ? (runtime === 'podman' ? ':z' : '') : (runtime === 'podman' ? ':ro,z' : ':ro')}`,
        ...(nodeModulesPath ? ['-v', `${nodeModulesPath}:/node_modules${runtime === 'podman' ? ':ro,z' : ':ro'}`] : []),
        '-v', `${sharedDir}:/shared${runtime === 'podman' ? ':z' : ''}`
    ];
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }

    if (manifest.volumes && typeof manifest.volumes === 'object') {
        const workspaceRoot = getConfiguredProjectPath('.', '', undefined);
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

    let routerPort = '8080';
    try {
        const routingFile = path.resolve('.ploinky/routing.json');
        if (fs.existsSync(routingFile)) {
            const routing = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {};
            if (routing.port) {
                routerPort = String(routing.port);
            }
        }
    } catch (_) {
        // ignore and keep default router port
    }
    envStrings.push(formatEnvFlag('PLOINKY_ROUTER_PORT', routerPort));

    const agentClientIdVar = `PLOINKY_AGENT_${agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_ID`;
    const agentClientSecretVar = `PLOINKY_AGENT_${agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_SECRET`;
    const agentClientId = resolveVarValue(agentClientIdVar) || resolveVarValue('PLOINKY_AGENT_CLIENT_ID');
    const agentClientSecret = resolveVarValue(agentClientSecretVar) || resolveVarValue('PLOINKY_AGENT_CLIENT_SECRET');

    if (agentClientId) {
        envStrings.push(formatEnvFlag('PLOINKY_AGENT_CLIENT_ID', agentClientId));
    }
    if (agentClientSecret) {
        envStrings.push(formatEnvFlag('PLOINKY_AGENT_CLIENT_SECRET', agentClientSecret));
    }

    const envFlags = flagsToArgs(envStrings);
    if (envFlags.length) args.push(...envFlags);
    args.push('-e', 'NODE_PATH=/node_modules');

    args.push(image);
    let entrySummary = DEFAULT_AGENT_ENTRY;
    if (useStartEntry) {
        const startArgs = splitCommandArgs(startCmd);
        if (!startArgs.length) {
            throw new Error(`[start] ${agentName}: manifest.start is defined but empty.`);
        }
        args.push(...startArgs);
        entrySummary = startArgs.join(' ');
    } else if (explicitAgentCmd) {
        const shellPath = detectShellForImage(agentName, image);
        if (shellPath === SHELL_FALLBACK_DIRECT) {
            throw new Error(`[start] ${agentName}: no supported shell found to execute agent command.`);
        }
        args.push(shellPath, '-lc', explicitAgentCmd);
        entrySummary = `${shellPath} -lc ${explicitAgentCmd}`;
    } else {
        args.push('sh', '/Agent/server/AgentServer.sh');
    }

    console.log(`[start] ${agentName}: ${runtime} run (cwd='${cwd}') -> ${entrySummary}`);
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) { throw new Error(`${runtime} run failed with code ${res.status}`); }
    const agents = loadAgentsMap();
    const declaredEnvNames2 = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
    const existingRecord = agents[containerName] || {};
    agents[containerName] = {
        agentName,
        repoName,
        containerImage: image,
        createdAt: existingRecord.createdAt || new Date().toISOString(),
        projectPath: cwd,
        runMode: existingRecord.runMode,
        develRepo: existingRecord.develRepo,
        type: 'agent',
        config: {
            binds: [
                { source: cwd, target: cwd },
                { source: AGENT_LIB_PATH, target: '/Agent', ro: true },
                { source: agentPath, target: '/code', ro: process.env.PLOINKY_CODE_WRITABLE !== '1' },
                { source: sharedDir, target: '/shared' }
            ],
            env: Array.from(new Set(declaredEnvNames2)).map((name) => ({ name })),
            ports: portMappings
        }
    };

    if (existingRecord.alias) {
        agents[containerName].alias = existingRecord.alias;
    }
    saveAgentsMap(agents);
    try {
        runPostinstallHook(agentName, containerName, manifest, cwd);
    } catch (error) {
        try { stopAndRemove(containerName); } catch (_) { }
        throw error;
    }
    if (useStartEntry) {
        try {
            launchAgentSidecar({ containerName, agentCommand: resolvedAgentCmd, agentName });
        } catch (error) {
            try { stopAndRemove(containerName); } catch (_) { }
            throw error;
        }
    }
    syncAgentMcpConfig(containerName, path.resolve(agentPath));
    return containerName;
}

function resolveHostPort(containerName, existingRecord, containerPortCandidates) {
    const fromRecord = resolveHostPortFromRecord(existingRecord, containerPortCandidates);
    if (fromRecord) return fromRecord;
    return resolveHostPortFromRuntime(containerName, containerPortCandidates);
}

function resolveHostPortFromRecord(record, containerPortCandidates) {
    const ports = record?.config?.ports;
    if (!Array.isArray(ports) || !ports.length) return 0;
    for (const containerPort of containerPortCandidates) {
        const match = ports.find((p) => p && p.containerPort === containerPort);
        if (match?.hostPort) {
            return match.hostPort;
        }
    }
    return ports[0]?.hostPort || 0;
}

function resolveHostPortFromRuntime(containerName, containerPortCandidates) {
    for (const containerPort of containerPortCandidates) {
        try {
            const portMap = execSync(`${containerRuntime} port ${containerName} ${containerPort}/tcp`, { stdio: 'pipe' }).toString().trim();
            const hostPort = parseHostPort(portMap);
            if (hostPort) {
                return hostPort;
            }
        } catch (_) {
            // ignore and try next
        }
    }
    return 0;
}

function ensureAgentService(agentName, manifest, agentPath, options = {}) {
    let preferredHostPort;
    let containerOverride;
    let aliasOverride;
    if (typeof options === 'number') {
        preferredHostPort = options;
    } else if (options && typeof options === 'object') {
        preferredHostPort = options.preferredHostPort;
        containerOverride = options.containerName;
        aliasOverride = options.alias;
    }

    const repoName = path.basename(path.dirname(agentPath));
    const containerName = containerOverride || getAgentContainerName(agentName, repoName);
    const snapshot = loadAgentsMap();
    const existingRecord = snapshot[containerName] || {};
    if (!aliasOverride && existingRecord.alias) {
        aliasOverride = existingRecord.alias;
    }
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
    const containerPortCandidates = portMappings
        .map((mapping) => mapping?.containerPort)
        .filter((port) => typeof port === 'number' && port > 0);
    if (!containerPortCandidates.length) {
        containerPortCandidates.push(7000);
    }

    const { resolved: ensuredAgentCmd } = readManifestAgentCommand(manifest);
    const startCmd = readManifestStartCommand(manifest);
    const withParallelAgent = Boolean(startCmd);

    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
        }
    }
    if (containerExists(containerName)) {
        if (!isContainerRunning(containerName)) {
            try { execSync(`${containerRuntime} start ${containerName}`, { stdio: 'inherit' }); } catch (e) { debugLog(`start ${containerName} error: ${e.message}`); }
            if (withParallelAgent) {
                try {
                    launchAgentSidecar({ containerName, agentCommand: ensuredAgentCmd, agentName });
                } catch (error) {
                    try { stopAndRemove(containerName); } catch (_) { }
                    throw error;
                }
            }
        }
        const hostPort = resolveHostPort(containerName, existingRecord, containerPortCandidates);
        syncAgentMcpConfig(containerName, agentPath);
        return { containerName, hostPort };
    }

    let additionalPorts = [];
    let allPortMappings = [...portMappings];

    if (manifestPorts.length === 0) {
        const hostPort = preferredHostPort || (10000 + Math.floor(Math.random() * 50000));
        additionalPorts = [`${hostPort}:7000`];
        allPortMappings = [{ containerPort: 7000, hostPort }];
    }

    startAgentContainer(agentName, manifest, agentPath, { publish: additionalPorts, containerName, alias: aliasOverride });

    const agents = loadAgentsMap();
    const declaredEnvNames3 = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
    let projPath = existingRecord.projectPath;
    if (!projPath) {
        projPath = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)), aliasOverride);
    }
    agents[containerName] = {
        agentName,
        repoName,
        containerImage: image,
        createdAt: existingRecord.createdAt || new Date().toISOString(),
        projectPath: projPath,
        runMode: existingRecord.runMode,
        develRepo: existingRecord.develRepo,
        type: 'agent',
        config: {
            binds: [
                { source: projPath, target: projPath },
                { source: AGENT_LIB_PATH, target: '/agent', ro: true },
                { source: agentPath, target: '/code', ro: process.env.PLOINKY_CODE_WRITABLE !== '1' }
            ],
            env: Array.from(new Set(declaredEnvNames3)).map((name) => ({ name })),
            ports: allPortMappings
        }
    };
    if (aliasOverride) {
        agents[containerName].alias = aliasOverride;
    }
    saveAgentsMap(agents);

    syncAgentMcpConfig(containerName, agentPath);
    const returnPort = allPortMappings.find((p) => p.containerPort === 7000)?.hostPort || allPortMappings[0]?.hostPort || 0;
    return { containerName, hostPort: returnPort };
}

export {
    ensureAgentService,
    resolveHostPort,
    resolveHostPortFromRecord,
    resolveHostPortFromRuntime,
    startAgentContainer
};
