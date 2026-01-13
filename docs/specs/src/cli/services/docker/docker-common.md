# cli/services/docker/common.js - Docker Common Utilities

## Overview

Provides core utilities for container runtime operations including runtime detection, container naming, status checking, port parsing, and environment variable handling.

## Source File

`cli/services/docker/common.js`

## Dependencies

```javascript
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { REPOS_DIR, PLOINKY_DIR } from '../config.js';
import { buildEnvFlags, buildEnvMap } from '../secretVars.js';
import { loadAgents, saveAgents } from '../workspace.js';
import { debugLog } from '../utils.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Container configuration paths (inside container)
const CONTAINER_CONFIG_DIR = '/code';
const CONTAINER_CONFIG_PATH = `${CONTAINER_CONFIG_DIR}/mcp-config.json`;

// Shared buffer for synchronous sleep
const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

// Container runtime (detected at module load)
const containerRuntime = getContainerRuntime();
```

## Runtime Detection

### isRuntimeInstalled(runtime)

**Purpose**: Checks if a container runtime is installed

**Parameters**:
- `runtime` (string): Runtime name ('docker' or 'podman')

**Returns**: (boolean)

**Implementation**:
```javascript
function isRuntimeInstalled(runtime) {
    try {
        execSync(`command -v ${runtime}`, { stdio: 'ignore' });
        return true;
    } catch (_) {
        return false;
    }
}
```

### getContainerRuntime()

**Purpose**: Detects available container runtime (prefers podman)

**Returns**: (string) 'podman' or 'docker'

**Implementation**:
```javascript
function getContainerRuntime() {
    const preferredRuntimes = ['podman', 'docker'];
    for (const runtime of preferredRuntimes) {
        if (isRuntimeInstalled(runtime)) {
            debugLog(`Using ${runtime} as container runtime.`);
            return runtime;
        }
    }
    console.error('Neither podman nor docker found in PATH. Please install one of them.');
    process.exit(1);
}
```

### getRuntime()

**Purpose**: Returns the detected container runtime

**Returns**: (string) 'podman' or 'docker'

**Implementation**:
```javascript
function getRuntime() {
    return containerRuntime;
}
```

## Container Naming

### getAgentContainerName(agentName, repoName)

**Purpose**: Generates a unique container name for an agent based on agent name, repo, and workspace path

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name

**Returns**: (string) Container name like `ploinky_basic_node-dev_myproject_a1b2c3d4`

**Implementation**:
```javascript
function getAgentContainerName(agentName, repoName) {
    const safeAgentName = String(agentName || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeRepoName = String(repoName || '').replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Create hash of current working directory for uniqueness
    const cwdHash = crypto.createHash('sha256')
        .update(process.cwd())
        .digest('hex')
        .substring(0, 8);

    const projectDir = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const containerName = `ploinky_${safeRepoName}_${safeAgentName}_${projectDir}_${cwdHash}`;

    debugLog(`Calculated container name: ${containerName} (for path: ${process.cwd()})`);
    return containerName;
}
```

## Container Status

### isContainerRunning(containerName)

**Purpose**: Checks if a container is currently running

**Parameters**:
- `containerName` (string): Container name

**Returns**: (boolean)

**Implementation**:
```javascript
function isContainerRunning(containerName) {
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
```

### containerExists(containerName)

**Purpose**: Checks if a container exists (running or stopped)

**Parameters**:
- `containerName` (string): Container name

**Returns**: (boolean)

**Implementation**:
```javascript
function containerExists(containerName) {
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
```

### waitForContainerRunning(containerName, maxAttempts, delayMs)

**Purpose**: Waits for a container to reach 'running' state

**Parameters**:
- `containerName` (string): Container name
- `maxAttempts` (number): Maximum attempts (default: 20)
- `delayMs` (number): Delay between attempts in ms (default: 250)

**Returns**: (boolean) True if container is running

**Implementation**:
```javascript
function waitForContainerRunning(containerName, maxAttempts = 20, delayMs = 250) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const status = execSync(
                `${containerRuntime} inspect ${containerName} --format '{{ .State.Status }}'`,
                { stdio: 'pipe' }
            ).toString().trim().toLowerCase();

            if (status === 'running') {
                return true;
            }
        } catch (_) {}
        sleepMs(delayMs);
    }
    return false;
}
```

## Port Handling

### parseManifestPorts(manifest)

**Purpose**: Parses port configuration from agent manifest

**Parameters**:
- `manifest` (Object): Agent manifest object

**Returns**: `{publishArgs: string[], portMappings: Array<{hostPort, containerPort, hostIp}>}`

**Port Formats Supported**:
- `"7000"` - Single port (host=container)
- `"8080:7000"` - Host:Container
- `"0.0.0.0:8080:7000"` - IP:Host:Container

**Implementation**:
```javascript
function parseManifestPorts(manifest) {
    const ports = manifest.ports || manifest.port;
    if (!ports) return { publishArgs: [], portMappings: [] };

    const portArray = Array.isArray(ports) ? ports : [ports];
    const publishArgs = [];
    const portMappings = [];

    for (const p of portArray) {
        if (!p) continue;
        const portSpec = String(p).trim();
        if (!portSpec) continue;

        const parts = portSpec.split(':');
        let hostIp = '127.0.0.1';  // Default to localhost for security
        let hostPort;
        let containerPort;

        if (parts.length === 1) {
            hostPort = containerPort = parseInt(parts[0], 10);
        } else if (parts.length === 2) {
            hostPort = parseInt(parts[0], 10);
            containerPort = parseInt(parts[1], 10);
        } else if (parts.length === 3) {
            hostIp = parts[0];  // Respect the specified IP address
            hostPort = parseInt(parts[1], 10);
            containerPort = parseInt(parts[2], 10);
        }

        if (hostPort && containerPort) {
            const normalized = `${hostIp}:${hostPort}:${containerPort}`;
            publishArgs.push(normalized);
            portMappings.push({ hostPort, containerPort, hostIp });
        }
    }

    return { publishArgs, portMappings };
}
```

### parseHostPort(output)

**Purpose**: Extracts host port number from command output

**Parameters**:
- `output` (string): Command output

**Returns**: (number) Port number or 0

**Implementation**:
```javascript
function parseHostPort(output) {
    try {
        if (!output) return 0;
        const firstLine = String(output).split(/\n+/)[0].trim();
        const match = firstLine.match(/(\d+)\s*$/);
        return match ? parseInt(match[1], 10) : 0;
    } catch (_) {
        return 0;
    }
}
```

## Environment Variables

### getSecretsForAgent(manifest)

**Purpose**: Gets formatted environment variable flags for container run command

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string[]) Array of `-e KEY=value` flags

**Implementation**:
```javascript
function getSecretsForAgent(manifest) {
    const vars = buildEnvFlags(manifest);
    debugLog(`Formatted env vars for ${containerRuntime} command: ${vars.join(' ')}`);
    return vars;
}
```

### computeEnvHash(manifest)

**Purpose**: Computes hash of environment variables for change detection

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string) SHA256 hash of sorted env vars

**Implementation**:
```javascript
function computeEnvHash(manifest) {
    try {
        const map = buildEnvMap(manifest);
        const sorted = Object.keys(map).sort().reduce((acc, key) => {
            acc[key] = map[key];
            return acc;
        }, {});
        const data = JSON.stringify(sorted);
        return crypto.createHash('sha256').update(data).digest('hex');
    } catch (_) {
        return '';
    }
}
```

## Configuration Files

### getAgentMcpConfigPath(agentPath)

**Purpose**: Gets path to MCP config file if it exists

**Parameters**:
- `agentPath` (string): Path to agent directory

**Returns**: (string|null) Path to mcp-config.json or null

### getContainerLabel(containerName, key)

**Purpose**: Gets a label value from a container

**Parameters**:
- `containerName` (string): Container name
- `key` (string): Label key

**Returns**: (string) Label value or empty string

### getConfiguredProjectPath(agentName, repoName, alias)

**Purpose**: Gets the configured project path for an agent

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `alias` (string): Optional alias

**Returns**: (string) Project path

## Utility Functions

### sleepMs(ms)

**Purpose**: Synchronous sleep using Atomics

**Parameters**:
- `ms` (number): Milliseconds to sleep

### flagsToArgs(flags)

**Purpose**: Parses command-line flags string into array

**Parameters**:
- `flags` (string[]): Array of flag strings

**Returns**: (string[]) Parsed arguments

## Exports

```javascript
export {
    CONTAINER_CONFIG_DIR,
    CONTAINER_CONFIG_PATH,
    PLOINKY_DIR,
    REPOS_DIR,
    containerRuntime,
    containerExists,
    computeEnvHash,
    getAgentContainerName,
    getAgentMcpConfigPath,
    getConfiguredProjectPath,
    getContainerLabel,
    getRuntime,
    getSecretsForAgent,
    isContainerRunning,
    loadAgentsMap,
    parseHostPort,
    parseManifestPorts,
    saveAgentsMap,
    syncAgentMcpConfig,
    waitForContainerRunning,
    flagsToArgs,
    sleepMs
};
```

## Usage Example

```javascript
import {
    getRuntime,
    getAgentContainerName,
    isContainerRunning,
    containerExists,
    parseManifestPorts,
    waitForContainerRunning
} from './common.js';

const runtime = getRuntime(); // 'docker' or 'podman'

const name = getAgentContainerName('node-dev', 'basic');
// 'ploinky_basic_node-dev_myproject_a1b2c3d4'

if (containerExists(name)) {
    if (isContainerRunning(name)) {
        console.log('Container is running');
    } else {
        console.log('Container exists but not running');
    }
}

// Parse ports from manifest
const manifest = { ports: ['8080:7000', '9000'] };
const { publishArgs, portMappings } = parseManifestPorts(manifest);
// publishArgs: ['127.0.0.1:8080:7000', '127.0.0.1:9000:9000']

// Wait for container to start
if (waitForContainerRunning(name, 30, 500)) {
    console.log('Container started successfully');
}
```

## Related Modules

- [docker-index.md](./docker-index.md) - Docker services index
- [service-secret-vars.md](../utils/service-secret-vars.md) - Secret handling
- [service-workspace.md](../workspace/service-workspace.md) - Agent persistence
