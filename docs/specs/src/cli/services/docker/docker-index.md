# cli/services/docker/index.js - Docker Services Index

## Overview

Re-exports all Docker/container runtime functionality from the docker service modules. Provides a unified API for container management operations including interactive sessions, container fleet management, agent services, and health probes.

## Source File

`cli/services/docker/index.js`

## Exports

This module re-exports functions from the following submodules:

### From interactive.js

```javascript
export {
    attachInteractive,    // Attach to container interactively
    buildExecArgs,        // Build docker exec argument array
    ensureAgentContainer, // Ensure container exists and is running
    runCommandInContainer // Run command in container
} from './interactive.js';
```

### From containerFleet.js

```javascript
export {
    addSessionContainer,      // Add container to session tracking
    cleanupSessionSet,        // Clean up tracked session containers
    destroyAllPloinky,        // Destroy all Ploinky containers globally
    destroyWorkspaceContainers, // Destroy containers for current workspace
    forceStopContainers,      // Force stop multiple containers
    getContainerCandidates,   // Get containers matching pattern
    gracefulStopContainer,    // Gracefully stop a container
    listAllContainerNames,    // List all container names
    stopAndRemove,            // Stop and remove single container
    stopAndRemoveMany,        // Stop and remove multiple containers
    stopConfiguredAgents,     // Stop all configured agent containers
    waitForContainers         // Wait for containers to reach state
} from './containerFleet.js';
```

### From agentServiceManager.js

```javascript
export {
    ensureAgentService,         // Ensure agent service is running
    resolveHostPort,            // Resolve host port for agent
    resolveHostPortFromRecord,  // Resolve port from agent record
    resolveHostPortFromRuntime, // Resolve port from container runtime
    startAgentContainer         // Start agent container
} from './agentServiceManager.js';
```

### From containerRegistry.js

```javascript
export {
    collectLiveAgentContainers, // Collect all live agent containers
    getAgentsRegistry           // Get agents registry
} from './containerRegistry.js';
```

### From common.js

```javascript
export {
    containerExists,         // Check if container exists
    getAgentContainerName,   // Generate container name from agent
    getConfiguredProjectPath, // Get project path from config
    getRuntime,              // Get container runtime (docker/podman)
    isContainerRunning,      // Check if container is running
    parseManifestPorts,      // Parse ports from manifest
    waitForContainerRunning  // Wait for container to start
} from './common.js';
```

### From healthProbes.js

```javascript
export { clearLivenessState } from './healthProbes.js';
```

## Module Structure

```
cli/services/docker/
├── index.js           # This file - re-exports all
├── common.js          # Common utilities (runtime, naming, ports)
├── interactive.js     # Interactive container operations
├── containerFleet.js  # Container lifecycle management
├── agentServiceManager.js # Agent container service management
├── containerRegistry.js   # Container registry operations
├── healthProbes.js    # Container health checks
├── agentCommands.js   # Agent-specific commands
├── agentHooks.js      # Lifecycle hooks
└── shellDetection.js  # Shell detection utilities
```

## API Summary

### Container Lifecycle

| Function | Description |
|----------|-------------|
| `ensureAgentContainer` | Creates/starts container if needed |
| `startAgentContainer` | Starts a specific agent container |
| `stopAndRemove` | Stops and removes a container |
| `stopAndRemoveMany` | Stops and removes multiple containers |
| `gracefulStopContainer` | Gracefully stops with timeout |
| `forceStopContainers` | Force stops containers |
| `destroyWorkspaceContainers` | Destroys all workspace containers |
| `destroyAllPloinky` | Destroys all Ploinky containers |

### Container Status

| Function | Description |
|----------|-------------|
| `containerExists` | Checks if container exists |
| `isContainerRunning` | Checks if container is running |
| `waitForContainerRunning` | Waits for container to start |
| `collectLiveAgentContainers` | Lists all live containers |
| `listAllContainerNames` | Lists all container names |

### Interactive Operations

| Function | Description |
|----------|-------------|
| `attachInteractive` | Attaches to container with TTY |
| `runCommandInContainer` | Runs command in container |
| `buildExecArgs` | Builds exec argument array |

### Service Management

| Function | Description |
|----------|-------------|
| `ensureAgentService` | Ensures agent service is running |
| `resolveHostPort` | Resolves port for agent |
| `resolveHostPortFromRecord` | Gets port from agent record |
| `resolveHostPortFromRuntime` | Gets port from running container |

### Configuration

| Function | Description |
|----------|-------------|
| `getRuntime` | Returns 'docker' or 'podman' |
| `getAgentContainerName` | Generates container name |
| `parseManifestPorts` | Parses manifest port config |
| `getConfiguredProjectPath` | Gets project path |

### Session Tracking

| Function | Description |
|----------|-------------|
| `addSessionContainer` | Adds to session tracking |
| `cleanupSessionSet` | Cleans up session containers |
| `stopConfiguredAgents` | Stops configured agents |

## Usage Example

```javascript
import {
    getRuntime,
    getAgentContainerName,
    ensureAgentContainer,
    isContainerRunning,
    collectLiveAgentContainers,
    stopAndRemove,
    attachInteractive
} from './services/docker/index.js';

// Get container runtime
const runtime = getRuntime(); // 'docker' or 'podman'

// Generate container name
const name = getAgentContainerName('node-dev', 'basic');
// Returns: 'ploinky-basic-node-dev'

// Ensure container is running
await ensureAgentContainer('node-dev', agentRecord);

// Check status
if (isContainerRunning(name)) {
    console.log('Container is running');
}

// List all live containers
const containers = collectLiveAgentContainers();
containers.forEach(c => console.log(c.containerName));

// Attach interactively
await attachInteractive(name, '/bin/bash');

// Stop and remove
await stopAndRemove(name);
```

## Runtime Detection

The docker services automatically detect and use the appropriate container runtime:

1. Checks for `CONTAINER_RUNTIME` environment variable
2. Falls back to `docker` if available
3. Falls back to `podman` if docker not available

## Container Naming Convention

Container names follow the pattern: `ploinky-<repo>-<agent>`

Examples:
- `ploinky-basic-node-dev`
- `ploinky-cloud-aws-cli`
- `ploinky-custom-my-agent`

## Related Modules

- [docker-common.md](./docker-common.md) - Common utilities
- [docker-interactive.md](./docker-interactive.md) - Interactive operations
- [docker-container-fleet.md](./docker-container-fleet.md) - Fleet management
- [docker-agent-service-manager.md](./docker-agent-service-manager.md) - Service management
