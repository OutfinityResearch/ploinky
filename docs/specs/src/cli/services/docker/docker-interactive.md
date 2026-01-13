# cli/services/docker/interactive.js - Interactive Container Operations

## Overview

Provides interactive container operations including running commands in containers with TTY support, creating containers on-demand, and attaching to running containers interactively.

## Source File

`cli/services/docker/interactive.js`

## Dependencies

```javascript
import fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getExposedNames, getManifestEnvNames, formatEnvFlag } from '../secretVars.js';
import { debugLog } from '../utils.js';
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
```

## Constants

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

## Internal Functions

### ensureSharedHostDir()

**Purpose**: Ensures the shared host directory exists

**Returns**: (string) Path to shared directory

**Implementation**:
```javascript
function ensureSharedHostDir() {
    const dir = path.resolve(process.cwd(), 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}
```

## Public API

### runCommandInContainer(agentName, repoName, manifest, command, interactive)

**Purpose**: Runs a command in an agent's container, creating it if necessary

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `manifest` (Object): Agent manifest
- `command` (string): Command to run
- `interactive` (boolean): Whether to attach TTY

**Behavior**:
1. Creates container if it doesn't exist
2. Starts container if not running
3. Runs install command on first run
4. Executes the specified command

**Implementation**:
```javascript
export function runCommandInContainer(agentName, repoName, manifest, command, interactive = false) {
    const containerName = getAgentContainerName(agentName, repoName);
    let agents = loadAgentsMap();
    const projectDir = getConfiguredProjectPath(agentName, repoName);
    const sharedDir = ensureSharedHostDir();

    let firstRun = false;
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVarParts = [
            ...getSecretsForAgent(manifest),
            formatEnvFlag('PLOINKY_MCP_CONFIG_PATH', CONTAINER_CONFIG_PATH)
        ];
        const envVars = envVarParts.join(' ');

        // Build mount options
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

        // Parse ports
        const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
        const portOptions = manifestPorts.map(p => `-p ${p}`).join(' ');

        let containerImage = manifest.container;
        const createCommand = `${containerRuntime} create -it --name ${containerName} ${mountOption} ${portOptions} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
        execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] });

        // Update agents map
        const declaredEnvNames = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
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
                    { source: sharedDir, target: '/shared' }
                ],
                env: Array.from(new Set(declaredEnvNames)).map(name => ({ name })),
                ports: portMappings
            }
        };
        saveAgentsMap(agents);
        firstRun = true;
    }

    // Start if not running
    if (!isContainerRunning(containerName)) {
        execSync(`${containerRuntime} start ${containerName}`, { stdio: 'inherit' });
    }

    // Run install on first run
    if (firstRun && manifest.install) {
        const ready = waitForContainerRunning(containerName);
        if (ready) {
            console.log(`[install] ${agentName}: cd '${projectDir}' && ${manifest.install}`);
            const installCommand = `${containerRuntime} exec ${interactive ? '-it' : ''} ${containerName} sh -lc "cd '${projectDir}' && ${manifest.install}"`;
            execSync(installCommand, { stdio: 'inherit' });
        }
    }

    // Execute command
    console.log(`Running command in '${agentName}': ${command}`);
    let bashCommand;
    if (interactive && command === '/bin/sh') {
        bashCommand = `cd '${projectDir}' && exec sh`;
    } else {
        bashCommand = `cd '${projectDir}' && ${command}`;
    }

    if (interactive) {
        console.log(`[Ploinky] Attaching to container '${containerName}' (interactive TTY).`);
        const args = ['exec', '-it', containerName, 'sh', '-lc', bashCommand];
        const result = spawnSync(containerRuntime, args, { stdio: 'inherit' });
        console.log(`[Ploinky] Detached from container. Exit code: ${result.status ?? 'unknown'}`);
    } else {
        const execCommand = `${containerRuntime} exec ${containerName} sh -lc "${bashCommand}"`;
        execSync(execCommand, { stdio: 'inherit' });
    }
}
```

### ensureAgentContainer(agentName, repoName, manifest)

**Purpose**: Ensures an agent container exists and is running

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `manifest` (Object): Agent manifest

**Returns**: (string) Container name

**Behavior**:
1. Recreates container if env hash changed
2. Creates container with proper mounts
3. Starts container if not running
4. Syncs MCP config
5. Runs install hook

**Implementation**:
```javascript
export function ensureAgentContainer(agentName, repoName, manifest) {
    const containerName = getAgentContainerName(agentName, repoName);
    const projectDir = getConfiguredProjectPath(agentName, repoName);
    const agentLibPath = path.resolve(__dirname, '../../../Agent');
    const agentPath = path.join(REPOS_DIR, repoName, agentName);
    const absAgentPath = path.resolve(agentPath);
    const sharedDir = ensureSharedHostDir();
    let agents = loadAgentsMap();

    // Check if env changed - recreate if so
    if (containerExists(containerName)) {
        const desired = computeEnvHash(manifest);
        const current = getContainerLabel(containerName, 'ploinky.envhash');
        if (desired && desired !== current) {
            try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) {}
        }
    }

    let createdNew = false;
    if (!containerExists(containerName)) {
        console.log(`Creating container '${containerName}' for agent '${agentName}'...`);
        const envVars = getSecretsForAgent(manifest).join(' ');
        const volZ = (containerRuntime === 'podman') ? ':z' : '';
        const roOpt = (containerRuntime === 'podman') ? ':ro,z' : ':ro';
        const containerImage = manifest.container;
        const envHash = computeEnvHash(manifest);
        const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
        const portOptions = manifestPorts.map(p => `-p ${p}`).join(' ');

        const createCommand = `${containerRuntime} create -it --name ${containerName} --label ploinky.envhash=${envHash} \
          -v "${projectDir}:${projectDir}${volZ}" \
          -v "${agentLibPath}:/Agent${roOpt}" \
          -v "${absAgentPath}:/code${roOpt}" \
          -v "${sharedDir}:/shared${volZ}" \
          ${portOptions} ${envVars} ${containerImage} /bin/sh -lc "while :; do sleep 3600; done"`;
        execSync(createCommand, { stdio: ['pipe', 'pipe', 'inherit'] });
        createdNew = true;

        // Update agents map
        const declaredEnvNames = [...getManifestEnvNames(manifest), ...getExposedNames(manifest)];
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
                env: Array.from(new Set(declaredEnvNames)).map(name => ({ name })),
                ports: portMappings
            }
        };
        saveAgentsMap(agents);
    }

    // Start if not running
    if (!isContainerRunning(containerName)) {
        execSync(`${containerRuntime} start ${containerName}`, { stdio: 'inherit' });
    }

    // Sync MCP config
    syncAgentMcpConfig(containerName, absAgentPath);

    // Run install on first run
    if (createdNew && manifest.install && String(manifest.install).trim()) {
        const ready = waitForContainerRunning(containerName);
        if (ready) {
            console.log(`[install] ${agentName}: cd '${projectDir}' && ${manifest.install}`);
            execSync(`${containerRuntime} exec ${containerName} sh -lc "cd '${projectDir}' && ${manifest.install}"`, { stdio: 'inherit' });
        }
    }

    return containerName;
}
```

### buildExecArgs(containerName, workdir, entryCommand, interactive, allocateTty)

**Purpose**: Builds docker/podman exec argument array

**Parameters**:
- `containerName` (string): Container name
- `workdir` (string): Working directory
- `entryCommand` (string): Command to run
- `interactive` (boolean): Interactive mode
- `allocateTty` (boolean): Allocate TTY

**Returns**: (string[]) Exec arguments

**Implementation**:
```javascript
export function buildExecArgs(containerName, workdir, entryCommand, interactive = true, allocateTty = true) {
    const wd = workdir || process.cwd();
    const cmd = entryCommand && String(entryCommand).trim()
        ? entryCommand
        : 'exec /bin/bash || exec /bin/sh';
    const args = ['exec'];
    if (interactive && allocateTty) {
        args.push('-it');  // Full interactive with TTY
    } else if (interactive) {
        args.push('-i');   // Interactive stdin only, no TTY (for webchat)
    }
    args.push(containerName, 'sh', '-lc', `cd '${wd}' && ${cmd}`);
    return args;
}
```

### attachInteractive(containerName, workdir, entryCommand)

**Purpose**: Attaches to a container interactively

**Parameters**:
- `containerName` (string): Container name
- `workdir` (string): Working directory
- `entryCommand` (string): Entry command

**Returns**: (number) Exit code

**Implementation**:
```javascript
export function attachInteractive(containerName, workdir, entryCommand) {
    // PLOINKY_NO_TTY=1 disables TTY allocation (used by webchat)
    const allocateTty = process.env.PLOINKY_NO_TTY !== '1';
    const execArgs = buildExecArgs(containerName, workdir, entryCommand, true, allocateTty);
    const result = spawnSync(containerRuntime, execArgs, { stdio: 'inherit' });
    return result.status ?? 0;
}
```

## Exports

```javascript
export {
    attachInteractive,
    buildExecArgs,
    ensureAgentContainer,
    runCommandInContainer
};
```

## Usage Example

```javascript
import {
    runCommandInContainer,
    ensureAgentContainer,
    attachInteractive
} from './interactive.js';

// Run a command in container
runCommandInContainer('node-dev', 'basic', manifest, 'npm test', false);

// Ensure container exists
const containerName = ensureAgentContainer('node-dev', 'basic', manifest);

// Attach interactively
attachInteractive(containerName, '/project', '/bin/bash');
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container utilities
- [service-secret-vars.md](../utils/service-secret-vars.md) - Environment variables
- [service-workspace.md](../workspace/service-workspace.md) - Agent config
