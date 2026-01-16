# cli/services/docker/agentServiceManager.js - Agent Service Manager

## Overview

Manages agent container lifecycle with profile-aware mount modes. Creates, starts, and configures agent containers with proper volume mounts, environment variables, and port bindings. Supports the profile system (dev/qa/prod) for controlling mount permissions, injecting profile env/secrets, and running profile lifecycle hooks when profiles are defined. Prepares `/agent/node_modules` before container start by running dependency installation in a temporary container.

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
import { runPreContainerLifecycle, runProfileLifecycle } from '../lifecycleHooks.js';
import { formatMissingSecretsError, getSecrets, validateSecrets } from '../secretInjector.js';
import { getActiveProfile, getDefaultMountModes, getProfileConfig, getProfileEnvVars } from '../profileService.js';
import {
    getAgentWorkDir,
    getAgentCodePath,
    getAgentSkillsPath,
    createAgentWorkDir
} from '../workspaceStructure.js';
import { runPersistentInstall } from '../dependencyInstaller.js';
```

## Constants

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');
```

## Internal Functions

### getProfileMountModes(profile, runtime, profileConfig)

**Purpose**: Gets mount modes based on active profile

**Parameters**:
- `profile` (string): Active profile
- `runtime` (string): Container runtime
- `profileConfig` (Object): Profile configuration (optional)

**Returns**: `{codeMountMode: string, skillsMountMode: string, codeReadOnly: boolean, skillsReadOnly: boolean}`

**Behavior**:
- dev: Read-write mounts
- qa/prod: Read-only mounts
- profile `mounts.code` / `mounts.skills` override defaults when provided

**Implementation**:
```javascript
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
    try { execSync(`${containerRuntime} rm -f ${containerName}`, { stdio: 'ignore' }); } catch (_) { }
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
    const agentNodeModulesPath = path.join(agentWorkDir, 'node_modules');
    if (!fs.existsSync(agentNodeModulesPath)) {
        fs.mkdirSync(agentNodeModulesPath, { recursive: true });
    }
    const nodeModulesMountMode = runtime === 'podman' ? ':ro,z' : ':ro';

    // Ensure agent work directory exists
    createAgentWorkDir(agentName);

    // Run install hook
    runInstallHook(agentName, manifest, agentPath, cwd);

    // Dependencies are installed in the running container via installDependencies
    // (called from lifecycleHooks after container starts)
    // Just ensure the agent work directory exists on host
    createAgentWorkDir(agentName);

    // Build volume mount arguments
    const args = ['run', '-d', '--name', containerName, '--label', `ploinky.envhash=${envHash}`, '-w', '/code',
        // Agent library (always ro)
        '-v', `${AGENT_LIB_PATH}:/Agent${runtime === 'podman' ? ':ro,z' : ':ro'}`,
        // Code directory - profile dependent
        '-v', `${agentCodePath}:/code${codeMountMode}`,
        // Node modules mounted for ESM resolution
        '-v', `${agentNodeModulesPath}:/code/node_modules${nodeModulesMountMode}`,
        // Shared directory
        '-v', `${sharedDir}:/shared${runtime === 'podman' ? ':z' : ''}`,
        // CWD passthrough - provides access to agents/<name>/ for runtime data
        '-v', `${cwd}:${cwd}${runtime === 'podman' ? ':z' : ''}`
    ];

    // Mount skills directory if it exists
    if (fs.existsSync(agentSkillsPath)) {
        args.push('-v', `${agentSkillsPath}:/code/.AchillesSkills${skillsMountMode}`);
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

    const profileEnv = normalizeProfileEnv(profileConfig?.env);
    appendEnvFlagsFromMap(envStrings, profileEnv);

    const profileEnvVars = getProfileEnvVars(agentName, repoName, activeProfile, {
        containerName,
        containerId: containerName
    });
    appendEnvFlagsFromMap(envStrings, profileEnvVars);

    if (profileConfig?.secrets && profileConfig.secrets.length > 0) {
        const secretValidation = validateSecrets(profileConfig.secrets);
        if (!secretValidation.valid) {
            throw new Error(formatMissingSecretsError(secretValidation.missing, activeProfile));
        }
        const profileSecrets = getSecrets(profileConfig.secrets);
        appendEnvFlagsFromMap(envStrings, profileSecrets);
    }

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

    // Additional environment - node_modules mounted directly at /code/node_modules
    // NODE_PATH not needed since modules resolve from /code/node_modules via ESM

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
| `/Agent` | Agent library | ro (always) |
| `/code` | Agent code | Profile dependent (rw/ro, override via profiles.mounts) |
| `/code/node_modules` | Agent work directory node_modules | ro (always) |
| `/shared` | Shared directory | rw |
| `/code/.AchillesSkills` | Skills directory | Profile dependent (rw/ro, override via profiles.mounts) |
| `$CWD` | Host CWD | rw (passthrough for runtime data access) |

## Environment Variables Set

| Variable | Description |
|----------|-------------|
| `PLOINKY_MCP_CONFIG_PATH` | Path to MCP config |
| `AGENT_NAME` | Agent name |
| `WORKSPACE_PATH` | Agent working directory path (`$CWD/agents/<agent>/`) |
| `PLOINKY_ROUTER_PORT` | Router port |
| `PLOINKY_AGENT_CLIENT_ID` | Agent OAuth client ID |
| `PLOINKY_AGENT_CLIENT_SECRET` | Agent OAuth client secret |
| `NODE_PATH` | Node modules path |
| `PLOINKY_PROFILE` | Active profile |
| `PLOINKY_PROFILE_ENV` | Profile environment label |
| `PLOINKY_AGENT_NAME` | Agent name |
| `PLOINKY_REPO_NAME` | Agent repository name |
| `PLOINKY_CWD` | Host working directory |
| `PLOINKY_CONTAINER_NAME` | Container name |
| `PLOINKY_CONTAINER_ID` | Container identifier |
| (Profile env/secrets) | `profiles.<name>.env` and `profiles.<name>.secrets` values |

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
