# cli/services/docker/agentServiceManager.js - Agent Service Manager

## Overview

Manages agent container lifecycle with profile-aware mount modes. Creates, starts, and configures agent containers with proper volume mounts, environment variables, and port bindings. Supports the profile system (dev/qa/prod) for controlling mount permissions.

## Source File

`cli/services/docker/agentServiceManager.js`

## Dependencies

```javascript
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
import {
    getAgentWorkDir,
    getAgentCodePath,
    getAgentSkillsPath,
    createAgentWorkDir
} from '../workspaceStructure.js';
import { PROFILE_FILE } from '../config.js';
```

## Constants

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');
```

## Internal Functions

### getActiveProfile()

**Purpose**: Gets the current active profile

**Returns**: (string) Profile name (default: 'dev')

**Implementation**:
```javascript
function getActiveProfile() {
    try {
        if (fs.existsSync(PROFILE_FILE)) {
            const profile = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
            if (profile) return profile;
        }
    } catch (_) {}
    return 'dev';
}
```

### getProfileMountModes(profile, runtime)

**Purpose**: Gets mount modes based on active profile

**Parameters**:
- `profile` (string): Active profile
- `runtime` (string): Container runtime

**Returns**: `{codeMountMode: string, skillsMountMode: string}`

**Behavior**:
- dev: Read-write mounts
- qa/prod: Read-only mounts

**Implementation**:
```javascript
function getProfileMountModes(profile, runtime) {
    const isDev = profile === 'dev';
    const roSuffix = runtime === 'podman' ? ':ro,z' : ':ro';
    const rwSuffix = runtime === 'podman' ? ':z' : '';

    return {
        codeMountMode: isDev ? rwSuffix : roSuffix,
        skillsMountMode: isDev ? rwSuffix : roSuffix
    };
}
```

## Public API

### startAgentContainer(agentName, manifest, agentPath, options)

**Purpose**: Starts an agent container with full configuration

**Parameters**:
- `agentName` (string): Agent name
- `manifest` (Object): Agent manifest
- `agentPath` (string): Path to agent directory
- `options.containerName` (string): Custom container name
- `options.alias` (string): Agent alias
- `options.publish` (string[]): Additional port bindings

**Returns**: Container start result

**Implementation**:
```javascript
export function startAgentContainer(agentName, manifest, agentPath, options = {}) {
    const repoName = path.basename(path.dirname(agentPath));
    const containerName = options.containerName || getAgentContainerName(agentName, repoName);

    // Remove existing container
    try { execSync(`${containerRuntime} stop ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    try { execSync(`${containerRuntime} rm ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
    clearLivenessState(containerName);

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const { raw: explicitAgentCmd, resolved: resolvedAgentCmd } = readManifestAgentCommand(manifest);
    const startCmd = readManifestStartCommand(manifest);
    const useStartEntry = Boolean(startCmd);
    const cwd = getConfiguredProjectPath(agentName, repoName, options.alias);
    const envHash = computeEnvHash(manifest);
    const sharedDir = ensureSharedHostDir();

    // Get active profile and determine mount modes
    const activeProfile = getActiveProfile();
    const { codeMountMode, skillsMountMode } = getProfileMountModes(activeProfile, runtime);

    // New workspace structure paths
    const agentWorkDir = getAgentWorkDir(agentName);
    const agentCodePath = getAgentCodePath(agentName);
    const agentSkillsPath = getAgentSkillsPath(agentName);

    // Ensure agent work directory exists
    createAgentWorkDir(agentName);

    // Run install hook
    runInstallHook(agentName, manifest, agentPath, cwd);

    // Build volume mount arguments
    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', '/code',
        // Agent working directory (always rw)
        '-v', `${agentWorkDir}:/agent${runtime === 'podman' ? ':z' : ''}`,
        // Agent library (always ro)
        '-v', `${AGENT_LIB_PATH}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        // Code directory - profile dependent
        '-v', `${agentCodePath}:/code${codeMountMode}`,
        // Shared directory
        '-v', `${sharedDir}:/shared${runtime === 'podman' ? ':z' : ''}`,
        // Legacy project path mount
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`
    ];

    // Mount skills directory if it exists
    if (fs.existsSync(agentSkillsPath)) {
        args.push('-v', `${agentSkillsPath}:/.AchillesSkills${skillsMountMode}`);
    }

    // Podman network configuration
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }

    // Handle custom volumes from manifest
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

    // Port bindings
    const { publishArgs: manifestPorts, portMappings } = parseManifestPorts(manifest);
    const runtimePorts = (options && Array.isArray(options.publish)) ? options.publish : [];
    const pubs = [...manifestPorts, ...runtimePorts];
    for (const p of pubs) {
        if (!p) continue;
        args.splice(1, 0, '-p', String(p));
    }

    // Environment variables
    const envStrings = [
        ...buildEnvFlags(manifest),
        formatEnvFlag('PLOINKY_MCP_CONFIG_PATH', CONTAINER_CONFIG_PATH),
        formatEnvFlag('AGENT_NAME', agentName)
    ];

    // Router port
    let routerPort = '8080';
    try {
        const routingFile = path.resolve('.ploinky/routing.json');
        if (fs.existsSync(routingFile)) {
            const routing = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {};
            if (routing.port) routerPort = String(routing.port);
        }
    } catch (_) {}
    envStrings.push(formatEnvFlag('PLOINKY_ROUTER_PORT', routerPort));

    // Agent authentication
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

    // Additional environment
    args.push('-e', 'NODE_PATH=/agent/node_modules');
    args.push('-e', `PLOINKY_PROFILE=${activeProfile}`);
    args.push('-e', `PLOINKY_AGENT_NAME=${agentName}`);

    // Image and entry command
    args.push(image);
    if (useStartEntry) {
        const startArgs = splitCommandArgs(startCmd);
        if (!startArgs.length) {
            throw new Error(`[start] ${agentName}: manifest.start is defined but empty.`);
        }
        args.push(...startArgs);
    } else {
        args.push(...splitCommandArgs(DEFAULT_AGENT_ENTRY));
    }

    // Run container
    execSync(`${containerRuntime} ${args.join(' ')}`, { stdio: 'inherit' });

    // Run postinstall hook
    runPostinstallHook(agentName, manifest, agentPath, cwd, containerName);

    return { containerName, portMappings };
}
```

### resolveHostPort(containerName, containerPort)

**Purpose**: Resolves the host port for a container port

**Parameters**:
- `containerName` (string): Container name
- `containerPort` (number): Container port

**Returns**: (number) Host port or 0

### resolveHostPortFromRecord(record, containerPort)

**Purpose**: Resolves host port from agent record

**Parameters**:
- `record` (Object): Agent record
- `containerPort` (number): Container port

**Returns**: (number) Host port or 0

### resolveHostPortFromRuntime(containerName, containerPort)

**Purpose**: Resolves host port from running container

**Parameters**:
- `containerName` (string): Container name
- `containerPort` (number): Container port

**Returns**: (number) Host port or 0

### ensureAgentService(agentName, manifest, agentPath, options)

**Purpose**: Ensures an agent service is running

**Parameters**:
- `agentName` (string): Agent name
- `manifest` (Object): Agent manifest
- `agentPath` (string): Path to agent
- `options` (Object): Start options

**Returns**: Service status

## Exports

```javascript
export {
    ensureAgentService,
    resolveHostPort,
    resolveHostPortFromRecord,
    resolveHostPortFromRuntime,
    startAgentContainer
};
```

## Volume Mounts

| Mount Point | Source | Mode |
|-------------|--------|------|
| `/agent` | Agent work directory | rw (always) |
| `/Agent` | Agent library | ro (always) |
| `/code` | Agent code | rw (dev) / ro (qa/prod) |
| `/shared` | Shared directory | rw |
| `/.AchillesSkills` | Skills directory | Profile dependent |

## Environment Variables Set

| Variable | Description |
|----------|-------------|
| `PLOINKY_MCP_CONFIG_PATH` | Path to MCP config |
| `AGENT_NAME` | Agent name |
| `PLOINKY_ROUTER_PORT` | Router port |
| `PLOINKY_AGENT_CLIENT_ID` | Agent OAuth client ID |
| `PLOINKY_AGENT_CLIENT_SECRET` | Agent OAuth client secret |
| `NODE_PATH` | Node modules path |
| `PLOINKY_PROFILE` | Active profile |
| `PLOINKY_AGENT_NAME` | Agent name |

## Usage Example

```javascript
import { startAgentContainer, ensureAgentService } from './agentServiceManager.js';

// Start an agent container
const result = startAgentContainer('node-dev', manifest, '/path/to/agent', {
    publish: ['8080:7000']
});

// Ensure service is running
await ensureAgentService('node-dev', manifest, '/path/to/agent');
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container utilities
- [docker-agent-commands.md](./docker-agent-commands.md) - Agent commands
- [docker-agent-hooks.md](./docker-agent-hooks.md) - Lifecycle hooks
- [service-workspace-structure.md](../workspace/service-workspace-structure.md) - Workspace paths
