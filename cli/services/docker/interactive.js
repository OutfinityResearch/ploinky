import fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getExposedNames, getManifestEnvNames, formatEnvFlag } from '../secretVars.js';
import { debugLog } from '../utils.js';
import { getActiveProfile, getProfileConfig } from '../profileService.js';
import {
    CONTAINER_CONFIG_PATH,
    containerRuntime,
    containerExists,
    getAgentContainerName,
    getConfiguredProjectPath,
    getSecretsForAgent,
    isContainerRunning,
    loadAgentsMap,
    parseManifestPorts,
    saveAgentsMap,
    syncAgentMcpConfig,
    computeEnvHash,
    getContainerLabel,
    REPOS_DIR,
    waitForContainerRunning
} from './common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureSharedHostDir() {
    const dir = path.resolve(process.cwd(), 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}

function runCommandInContainer(agentName, repoName, manifest, command, interactive = false) {
    const containerName = getAgentContainerName(agentName, repoName);
    let agents = loadAgentsMap();
    const projectDir = getConfiguredProjectPath(agentName, repoName);

    const sharedDir = ensureSharedHostDir();

    let firstRun = false;
    debugLog(`Checking if container '${containerName}' exists...`);
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVarParts = [
            ...getSecretsForAgent(manifest),
            formatEnvFlag('PLOINKY_MCP_CONFIG_PATH', CONTAINER_CONFIG_PATH),
            // Set NODE_PATH to project directory node_modules (in the passthrough mount)
            formatEnvFlag('NODE_PATH', `${projectDir}/node_modules`)
        ];
        const envVars = envVarParts.join(' ');
        const mountOptions = containerRuntime === 'podman'
            ? [
                `--mount type=bind,source="${projectDir}",destination="${projectDir}",relabel=shared`,
                `--mount type=bind,source="${sharedDir}",destination="/shared",relabel=shared`
            ]
            : [
                `-v "${projectDir}:${projectDir}"`,
                `-v "${sharedDir}:/shared"`
            ];
        const mountOption = mountOptions.join(' ');

        const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
        const portOptions = manifestPorts.map(p => `-p ${p}`).join(' ');

        let containerImage = manifest.container;
        let createOutput;
        let containerId;

        try {
            const createCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${portOptions} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
            debugLog(`Executing create command: ${createCommand}`);
            createOutput = execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] }).toString().trim();
            containerId = createOutput;
        } catch (error) {
            if (containerRuntime === 'podman' && error.message.includes('short-name')) {
                debugLog(`Short-name resolution failed, trying with docker.io prefix...`);

                if (!containerImage.includes('/')) {
                    containerImage = `docker.io/library/${containerImage}`;
                } else if (!containerImage.startsWith('docker.io/') && !containerImage.includes('.')) {
                    containerImage = `docker.io/${containerImage}`;
                }

                console.log(`Retrying with full registry name: ${containerImage}`);
                const retryCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${portOptions} ${envVars} ${containerImage} /bin/sh -lc \"while :; do sleep 3600; done\"`;
                debugLog(`Executing retry command: ${retryCommand}`);

                try {
                    createOutput = execSync(retryCommand, { stdio: ['pipe', 'pipe', 'inherit'] }).toString().trim();
                    containerId = createOutput;
                    manifest.container = containerImage;
                } catch (retryError) {
                    console.error(`Failed to create container even with full registry name.`);
                    throw retryError;
                }
            } else {
                throw error;
            }
        }

        const declaredEnvNames = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
        agents[containerName] = {
            agentName,
            repoName,
            containerId,
            containerImage,
            createdAt: new Date().toISOString(),
            projectPath: projectDir,
            type: 'interactive',
            config: {
                binds: [
                    { source: projectDir, target: projectDir },
                    { source: sharedDir, target: '/shared' }
                ],
                env: Array.from(new Set(declaredEnvNames)).map(name => ({ name })),
                ports: portMappings
            }
        };
        saveAgentsMap(agents);
        debugLog(`Updated agents file with container ID: ${containerId}`);
        firstRun = true;
    }

    if (!isContainerRunning(containerName)) {
        try {
            const stateCommand = `${containerRuntime} ps -a --format "{{.Names}}\t{{.Status}}" | grep "^${containerName}"`;
            const stateResult = execSync(stateCommand, { stdio: 'pipe' }).toString().trim();
            debugLog(`Container state: ${stateResult}`);

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
        const ready = waitForContainerRunning(containerName);
        if (!ready) {
            console.warn(`[install] ${agentName}: container not running after creation; skipping install.`);
        } else {
            console.log(`[install] ${agentName}: cd '${projectDir}' && ${manifest.install}`);
            const installCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} sh -lc "cd '${projectDir}' && ${manifest.install}"`;
            debugLog(`Executing install command: ${installCommand}`);
            execSync(installCommand, { stdio: 'inherit' });
        }
    }

    console.log(`Running command in '${agentName}': ${command}`);
    let bashCommand;
    let envVars = '';

    if (interactive && command === '/bin/sh') {
        bashCommand = `cd '${projectDir}' && exec sh`;
    } else {
        bashCommand = `cd '${projectDir}' && ${command}`;
    }

    const execCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${envVars} ${containerName} sh -lc "${bashCommand}"`;
    debugLog(`Executing run command: ${execCommand}`);

    if (interactive) {
        console.log(`[Ploinky] Attaching to container '${containerName}' (interactive TTY).`);
        console.log(`[Ploinky] Working directory in container: ${projectDir}`);
        console.log(`[Ploinky] Exit the program or shell to return to the Ploinky prompt.`);
        const args = ['exec'];
        if (interactive) args.push('-it');
        if (envVars) args.push(...envVars.split(' '));
        args.push(containerName, 'sh', '-lc', bashCommand);

        debugLog(`Running interactive session with args: ${args.join(' ')}`);

        const result = spawnSync(containerRuntime, args, {
            stdio: 'inherit',
            shell: false
        });

        debugLog(`Container session ended with code ${result.status}`);
        console.log(`[Ploinky] Detached from container '${containerName}'. Exit code: ${result.status ?? 'unknown'}`);
    } else {
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
}

function ensureAgentContainer(agentName, repoName, manifest) {
    const containerName = getAgentContainerName(agentName, repoName);
    const projectDir = getConfiguredProjectPath(agentName, repoName);
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const agentPath = path.join(REPOS_DIR, repoName, agentName);
    const absAgentPath = path.resolve(agentPath);
    const sharedDir = ensureSharedHostDir();
    let agents = loadAgentsMap();

    // Resolve profile config for env hash computation
    const activeProfile = getActiveProfile();
    const hasProfileConfig = Boolean(manifest?.profiles && Object.keys(manifest.profiles).length > 0);
    const profileConfig = hasProfileConfig
        ? getProfileConfig(`${repoName}/${agentName}`, activeProfile)
        : null;

    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest, profileConfig);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
        }
    }
    let createdNew = false;
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVarParts = [
            ...getSecretsForAgent(manifest),
            // Set NODE_PATH to project directory node_modules (in the passthrough mount)
            formatEnvFlag('NODE_PATH', `${projectDir}/node_modules`)
        ];
        const envVars = envVarParts.join(' ');
        const volZ = (containerRuntime === 'podman') ? ':z' : '';
        const roOpt = (containerRuntime === 'podman') ? ':ro,z' : ':ro';
        let containerImage = manifest.container;
        const envHash = computeEnvHash(manifest, profileConfig);
        const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
        const portOptions = manifestPorts.map(p => `-p ${p}`).join(' ');
        try {
            const createCommand = `${containerRuntime} create -it --name ${containerName} --label ploinky.envhash=${envHash} \
              -v "${projectDir}:${projectDir}${volZ}" \
              -v "${agentLibPath}:/Agent${roOpt}" \
              -v "${absAgentPath}:/code${roOpt}" \
              -v "${sharedDir}:/shared${volZ}" \
              ${portOptions} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
            debugLog(`Executing create command: ${createCommand}`);
            execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
            createdNew = true;
        } catch (error) {
            if (containerRuntime === 'podman' && String(error.message || '').includes('short-name')) {
                if (!containerImage.includes('/')) containerImage = `docker.io/library/${containerImage}`;
                else if (!containerImage.startsWith('docker.io/') && !containerImage.includes('.')) containerImage = `docker.io/${containerImage}`;
                console.log(`Retrying with full registry name: ${containerImage}`);
                const retryCommand = `${containerRuntime} create -it --name ${containerName} --label ploinky.envhash=${envHash} \
                  -v "${projectDir}:${projectDir}${volZ}" \
                  -v "${agentLibPath}:/Agent${roOpt}" \
                  -v "${absAgentPath}:/code${roOpt}" \
                  -v "${sharedDir}:/shared${volZ}" \
                  ${portOptions} ${envVars} ${containerImage} /bin/sh -lc \"while :; do sleep 3600; done\"`;
                debugLog(`Executing retry command: ${retryCommand}`);
                execSync(retryCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
                manifest.container = containerImage;
                createdNew = true;
            } else {
                console.error('[docker.ensureAgentContainer] create failed:', error.message || error);
                throw error;
            }
        }
        const declaredEnvNamesX = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
        agents[containerName] = {
            agentName,
            repoName,
            containerImage,
            createdAt: new Date().toISOString(),
            projectPath: projectDir,
            type: 'interactive',
            config: {
                binds: [
                    { source: projectDir, target: projectDir },
                    { source: agentLibPath, target: '/Agent', ro: true },
                    { source: absAgentPath, target: '/code', ro: true },
                    { source: sharedDir, target: '/shared' }
                ],
                env: Array.from(new Set(declaredEnvNamesX)).map(name => ({ name })),
                ports: portMappings
            }
        };
        saveAgentsMap(agents);
    }
    if (!isContainerRunning(containerName)) {
        const startCommand = `${containerRuntime} start ${containerName}`;
        debugLog(`Executing start command: ${startCommand}`);
        try { execSync(startCommand, { stdio: 'inherit' }); }
        catch (e) { console.error('[docker.ensureAgentContainer] start failed:', e.message || e); throw e; }
    }
    syncAgentMcpConfig(containerName, absAgentPath);
    try {
        if (createdNew && manifest.install && String(manifest.install).trim()) {
            const ready = waitForContainerRunning(containerName);
            if (!ready) {
                console.warn(`[install] ${agentName}: container not running after creation; skipping install.`);
            } else {
                console.log(`[install] ${agentName}: cd '${projectDir}' && ${manifest.install}`);
                const installCommand = `${containerRuntime} exec ${containerName} sh -lc "cd '${projectDir}' && ${manifest.install}"`;
                debugLog(`Executing install command: ${installCommand}`);
                execSync(installCommand, { stdio: 'inherit' });
            }
        }
    } catch (e) {
        console.log(`[install] ${agentName}: ${e?.message || e}`);
    }
    return containerName;
}

function buildExecArgs(containerName, workdir, entryCommand, interactive = true, allocateTty = true) {
    const wd = workdir || process.cwd();
    const cmd = entryCommand && String(entryCommand).trim()
        ? entryCommand
        : 'exec /bin/bash || exec /bin/sh';
    const args = ['exec'];
    if (interactive && allocateTty) {
        args.push('-it');  // Full interactive with TTY (for direct terminal use)
    } else if (interactive) {
        args.push('-i');   // Interactive stdin only, no TTY (for webchat - ensures stdin EOF propagates)
    }
    args.push(containerName, 'sh', '-lc', `cd '${wd}' && ${cmd}`);
    return args;
}

function attachInteractive(containerName, workdir, entryCommand) {
    // PLOINKY_NO_TTY=1 disables TTY allocation (used by webchat to ensure stdin EOF propagates)
    const allocateTty = process.env.PLOINKY_NO_TTY !== '1';
    const execArgs = buildExecArgs(containerName, workdir, entryCommand, true, allocateTty);
    const result = spawnSync(containerRuntime, execArgs, { stdio: 'inherit' });
    return result.status ?? 0;
}

export {
    attachInteractive,
    buildExecArgs,
    ensureAgentContainer,
    runCommandInContainer
};
