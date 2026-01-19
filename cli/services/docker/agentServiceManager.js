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
import { WORKSPACE_ROOT } from '../config.js';
import { ensureSharedHostDir, runPostinstallHook } from './agentHooks.js';
import { detectShellForImage, SHELL_FALLBACK_DIRECT } from './shellDetection.js';
import {
    runPreContainerLifecycle,
    runProfileLifecycle
} from '../lifecycleHooks.js';
import {
    formatMissingSecretsError,
    getSecrets,
    validateSecrets
} from '../secretInjector.js';
import {
    getActiveProfile,
    getDefaultMountModes,
    getProfileConfig,
    getProfileEnvVars,
    mergeProfiles
} from '../profileService.js';
import {
    getAgentWorkDir,
    getAgentCodePath,
    getAgentSkillsPath,
    createAgentWorkDir
} from '../workspaceStructure.js';
import { runPersistentInstall } from '../dependencyInstaller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');

/**
 * Resolve a symlink path to its actual target.
 * If the path is not a symlink or doesn't exist, returns the original path.
 * @param {string} symlinkPath - The path that might be a symlink
 * @returns {string} The resolved real path, or original if not a symlink
 */
function resolveSymlinkPath(symlinkPath) {
    try {
        if (fs.existsSync(symlinkPath)) {
            const stat = fs.lstatSync(symlinkPath);
            if (stat.isSymbolicLink()) {
                return fs.realpathSync(symlinkPath);
            }
        }
    } catch (err) {
        debugLog(`Warning: could not resolve symlink ${symlinkPath}: ${err.message}`);
    }
    return symlinkPath;
}

/**
 * Get mount mode based on active profile.
 * In dev profile, mounts are rw. In qa/prod, mounts are ro.
 * @param {string} profile - The active profile
 * @param {string} runtime - Container runtime (docker/podman)
 * @param {object} profileConfig - Profile configuration
 * @returns {{ codeMountMode: string, skillsMountMode: string, codeReadOnly: boolean, skillsReadOnly: boolean }}
 */
function getProfileMountModes(profile, runtime, profileConfig = {}) {
    const defaultMounts = getDefaultMountModes(profile);
    const mounts = profileConfig?.mounts || {};
    const codeMode = normalizeMountMode(mounts.code, defaultMounts.code);
    const skillsMode = normalizeMountMode(mounts.skills, defaultMounts.skills);
    const roSuffix = runtime === 'podman' ? ':ro,z' : ':ro';
    const rwSuffix = runtime === 'podman' ? ':z' : '';

    return {
        codeMountMode: codeMode === 'ro' ? roSuffix : rwSuffix,
        skillsMountMode: skillsMode === 'ro' ? roSuffix : rwSuffix,
        codeReadOnly: codeMode === 'ro',
        skillsReadOnly: skillsMode === 'ro'
    };
}

function normalizeMountMode(mode, fallback) {
    if (mode === 'ro' || mode === 'rw') {
        return mode;
    }
    return fallback;
}

function normalizeProfileEnv(env) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(env)) {
        if (!key) continue;
        normalized[String(key)] = value === undefined ? '' : String(value);
    }
    return normalized;
}

function appendEnvFlagsFromMap(envFlags, envMap) {
    if (!envMap || typeof envMap !== 'object' || Array.isArray(envMap)) {
        return;
    }
    for (const [name, value] of Object.entries(envMap)) {
        if (!name) continue;
        envFlags.push(formatEnvFlag(String(name), value ?? ''));
    }
}

function startAgentContainer(agentName, manifest, agentPath, options = {}) {
    const repoName = path.basename(path.dirname(agentPath));
    const containerName = options.containerName || getAgentContainerName(agentName, repoName);
    try { execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    clearLivenessState(containerName);

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const { raw: explicitAgentCmd, resolved: resolvedAgentCmd } = readManifestAgentCommand(manifest);
    const startCmd = readManifestStartCommand(manifest);
    const useStartEntry = Boolean(startCmd);
    const cwd = getConfiguredProjectPath(agentName, path.basename(path.dirname(agentPath)), options.alias);
    const envHash = computeEnvHash(manifest);
    const sharedDir = ensureSharedHostDir();

    // Get active profile and configuration
    const activeProfile = getActiveProfile();
    const hasProfileConfig = Boolean(manifest?.profiles && Object.keys(manifest.profiles).length > 0);
    const profileConfig = hasProfileConfig
        ? getProfileConfig(`${repoName}/${agentName}`, activeProfile)
        : null;
    if (hasProfileConfig && !profileConfig) {
        const availableProfiles = Object.keys(manifest.profiles || {});
        throw new Error(`[profile] ${agentName}: profile '${activeProfile}' not found. Available: ${availableProfiles.join(', ')}`);
    }
    const useProfileLifecycle = Boolean(profileConfig);

    // Get profile mount modes (profile overrides default if provided)
    const {
        codeMountMode,
        skillsMountMode,
        codeReadOnly,
        skillsReadOnly
    } = getProfileMountModes(activeProfile, runtime, profileConfig || {});

    // New workspace structure paths
    const agentWorkDir = getAgentWorkDir(agentName);
    const agentCodePathSymlink = getAgentCodePath(agentName);
    const agentSkillsPathSymlink = getAgentSkillsPath(agentName);

    // Resolve symlinks to get actual paths - ensures container mounts work correctly
    // The paths might be symlinks like $CWD/code/agent -> .ploinky/repos/repo/agent
    const agentCodePath = resolveSymlinkPath(agentCodePathSymlink);
    const agentSkillsPath = resolveSymlinkPath(agentSkillsPathSymlink);

    // Ensure workspace structure exists before container creation
    const preLifecycle = runPreContainerLifecycle(agentName, repoName, agentPath);
    if (!preLifecycle.success) {
        console.error(`[profile] ${agentName}: workspace init warnings: ${preLifecycle.errors.join('; ')}`);
    }

    // Ensure agent work directory exists
    createAgentWorkDir(agentName);
    // Ensure MCP config is staged in the agent work dir before container start
    syncAgentMcpConfig(containerName, path.resolve(agentPath), agentName);

    // Run install hook with persistent changes (git clone, etc)
    // Install command comes from profile config (merged default + active profile)
    const profileInstallCmd = String(profileConfig?.install || '').trim();
    if (profileInstallCmd) {
        const installResult = runPersistentInstall(agentName, image, profileInstallCmd, {
            agentPath,
            cwd,
            verbose: true
        });
        if (!installResult.success) {
            console.warn(`[install] ${agentName}: ${installResult.message}`);
        }
    }

    // Ensure the agent work directory exists on host
    createAgentWorkDir(agentName);

    // Get lifecycle hook commands (for non-profile manifests)
    // These will run inside the main container entrypoint
    const preinstallCmd = !useProfileLifecycle ? String(manifest.preinstall || '').trim() : '';
    const installCmd = !useProfileLifecycle ? String(manifest.install || '').trim() : '';

    // Log hooks that will run in the container entrypoint
    if (preinstallCmd) console.log(`[preinstall] ${agentName}: cd '${cwd}' && ${preinstallCmd}`);
    if (installCmd) console.log(`[install] ${agentName}: cd '${cwd}' && ${installCmd}`);

    // Build hook chain for entrypoint: preinstall -> install -> agent
    let hookChain = '';
    if (preinstallCmd) hookChain += `cd '${cwd}' && ${preinstallCmd} && `;
    if (installCmd) hookChain += `cd '${cwd}' && ${installCmd} && `;

    // Build volume mount arguments using new workspace structure
    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', '/code',
        // Agent library (always ro)
        '-v', `${AGENT_LIB_PATH}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        // Code directory - profile dependent (rw in dev, ro in qa/prod)
        '-v', `${agentCodePath}:/code${codeMountMode}`,
        // Shared directory
        '-v', `${sharedDir}:/shared${runtime === 'podman' ? ':z' : ''}`,
        // CWD passthrough - provides access to agents/<name>/ for runtime data and node_modules
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`
    ];

    // Mount skills directory if it exists
    if (fs.existsSync(agentSkillsPath)) {
        args.push('-v', `${agentSkillsPath}:/code/.AchillesSkills${skillsMountMode}`);
    }
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
        args.splice(1, 0, '--replace');
    }

    if (manifest.volumes && typeof manifest.volumes === 'object') {
        const workspaceRoot = WORKSPACE_ROOT;
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
    const envStrings = [...buildEnvFlags(manifest, profileConfig), formatEnvFlag('PLOINKY_MCP_CONFIG_PATH', CONTAINER_CONFIG_PATH)];
    envStrings.push(formatEnvFlag('AGENT_NAME', agentName));
    envStrings.push(formatEnvFlag('WORKSPACE_PATH', agentWorkDir));

    const profileEnv = normalizeProfileEnv(profileConfig?.env);
    appendEnvFlagsFromMap(envStrings, profileEnv);

    const profileEnvVars = getProfileEnvVars(agentName, repoName, activeProfile, {
        containerName,
        containerId: containerName
    });
    appendEnvFlagsFromMap(envStrings, profileEnvVars);

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

    if (profileConfig?.secrets && profileConfig.secrets.length > 0) {
        const secretValidation = validateSecrets(profileConfig.secrets);
        if (!secretValidation.valid) {
            throw new Error(formatMissingSecretsError(secretValidation.missing, activeProfile));
        }
        const profileSecrets = getSecrets(profileConfig.secrets);
        appendEnvFlagsFromMap(envStrings, profileSecrets);
    }

    const envFlags = flagsToArgs(envStrings);
    if (envFlags.length) args.push(...envFlags);
    // Set NODE_PATH to agent working directory node_modules (in the passthrough mount)
    args.push('-e', `NODE_PATH=${cwd}/node_modules`);
    // Profile metadata is already included via getProfileEnvVars

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
        // Chain lifecycle hooks before agent command
        const fullCmd = hookChain + `cd /code && ${explicitAgentCmd}`;
        args.push(shellPath, '-lc', fullCmd);
        entrySummary = `${shellPath} -lc ${fullCmd}`;
    } else {
        // Chain lifecycle hooks before default agent server
        if (hookChain) {
            const fullCmd = hookChain + 'cd /code && sh /Agent/server/AgentServer.sh';
            args.push('sh', '-lc', fullCmd);
            entrySummary = `sh -lc ${fullCmd}`;
        } else {
            args.push('sh', '/Agent/server/AgentServer.sh');
        }
    }

    console.log(`[start] ${agentName}: ${runtime} run (cwd='${cwd}') -> ${entrySummary}`);
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) { throw new Error(`${runtime} run failed with code ${res.status}`); }
    const agents = loadAgentsMap();
    const declaredEnvNames2 = [
        ...getManifestEnvNames(manifest, profileConfig),
        ...getExposedNames(manifest, profileConfig),
        ...Object.keys(profileEnv)
    ];
    const existingRecord = agents[containerName] || {};
    agents[containerName] = {
        agentName,
        repoName,
        containerImage: image,
        createdAt: existingRecord.createdAt || new Date().toISOString(),
        projectPath: cwd,
        runMode: existingRecord.runMode,
        develRepo: existingRecord.develRepo,
        profile: activeProfile,
        type: 'agent',
        config: {
            binds: [
                { source: AGENT_LIB_PATH, target: '/Agent', ro: true },
                { source: agentCodePath, target: '/code', ro: codeReadOnly },
                { source: sharedDir, target: '/shared' },
                ...(fs.existsSync(agentSkillsPath) ? [{ source: agentSkillsPath, target: '/.AchillesSkills', ro: skillsReadOnly }] : []),
                { source: cwd, target: cwd }
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
        if (useProfileLifecycle) {
            const lifecycleResult = runProfileLifecycle(agentName, activeProfile, {
                containerName,
                agentPath,
                repoName,
                manifest
            });
            if (!lifecycleResult.success) {
                const details = lifecycleResult.errors.join('; ');
                throw new Error(`[profile] ${agentName}: lifecycle failed (${details})`);
            }
        } else {
            // Preinstall already ran before container start (installs deps to $cwd/node_modules)
            // Run postinstall after container is running
            runPostinstallHook(agentName, containerName, manifest, cwd);
        }
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
    syncAgentMcpConfig(containerName, path.resolve(agentPath), agentName);
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
    let forceRecreate = false;
    if (typeof options === 'number') {
        preferredHostPort = options;
    } else if (options && typeof options === 'object') {
        preferredHostPort = options.preferredHostPort;
        containerOverride = options.containerName;
        aliasOverride = options.alias;
        forceRecreate = options.forceRecreate === true;
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

    if (forceRecreate && containerExists(containerName)) {
        try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
        clearLivenessState(containerName);
    }

    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            // Only recreate if hash actually changed (not just empty vs non-empty)
            if (current && desired) {
                debugLog(`[ensureAgentService] ${agentName}: env hash changed, recreating container`);
                try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
            }
        }
    }
    if (containerExists(containerName)) {
        if (!isContainerRunning(containerName)) {
            syncAgentMcpConfig(containerName, agentPath, agentName);
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
        syncAgentMcpConfig(containerName, agentPath, agentName);
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

    // Get paths for the new workspace structure
    const agentWorkDir = getAgentWorkDir(agentName);
    const agentCodePath = getAgentCodePath(agentName);
    const agentSkillsPath = getAgentSkillsPath(agentName);
    const runtime = containerRuntime;
    const activeProfile = getActiveProfile();
    const hasProfileConfig = Boolean(manifest?.profiles && Object.keys(manifest.profiles).length > 0);
    const profileConfig = hasProfileConfig
        ? getProfileConfig(`${repoName}/${agentName}`, activeProfile)
        : null;
    if (hasProfileConfig && !profileConfig) {
        const availableProfiles = Object.keys(manifest.profiles || {});
        throw new Error(`[profile] ${agentName}: profile '${activeProfile}' not found. Available: ${availableProfiles.join(', ')}`);
    }
    const profileEnv = normalizeProfileEnv(profileConfig?.env);
    const { codeReadOnly, skillsReadOnly } = getProfileMountModes(activeProfile, runtime, profileConfig || {});

    const agents = loadAgentsMap();
    const declaredEnvNames3 = [
        ...getManifestEnvNames(manifest, profileConfig),
        ...getExposedNames(manifest, profileConfig),
        ...Object.keys(profileEnv)
    ];
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
        profile: activeProfile,
        type: 'agent',
        config: {
            binds: [
                { source: AGENT_LIB_PATH, target: '/Agent', ro: true },
                { source: agentCodePath, target: '/code', ro: codeReadOnly },
                ...(fs.existsSync(agentSkillsPath) ? [{ source: agentSkillsPath, target: '/.AchillesSkills', ro: skillsReadOnly }] : []),
                { source: projPath, target: projPath }
            ],
            env: Array.from(new Set(declaredEnvNames3)).map((name) => ({ name })),
            ports: allPortMappings
        }
    };
    if (aliasOverride) {
        agents[containerName].alias = aliasOverride;
    }
    saveAgentsMap(agents);

    syncAgentMcpConfig(containerName, agentPath, agentName);
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
