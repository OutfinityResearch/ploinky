# cli/services/docker/containerFleet.js - Container Fleet Management

## Overview

Manages container lifecycle operations including stopping, removing, and cleanup of containers. Provides graceful shutdown with SIGTERM followed by force kill, batch operations for efficiency, and session tracking.

## Source File

`cli/services/docker/containerFleet.js`

## Dependencies

```javascript
import { execSync } from 'child_process';
import { debugLog } from '../utils.js';
import { loadAgents } from '../workspace.js';
import {
    containerRuntime,
    containerExists,
    getAgentContainerName,
    isContainerRunning,
    loadAgentsMap
} from './common.js';
import { clearLivenessState } from './healthProbes.js';
```

## Internal Functions

### chunkArray(list, size)

**Purpose**: Splits array into chunks for batch processing

**Parameters**:
- `list` (Array): Array to chunk
- `size` (number): Chunk size (default: 8)

**Returns**: (Array[]) Array of chunks

## Public API

### gracefulStopContainer(name, options)

**Purpose**: Gracefully stops a container with SIGTERM

**Parameters**:
- `name` (string): Container name
- `options.prefix` (string): Log prefix (default: '[destroy]')

**Returns**: (boolean) Whether container was found

**Implementation**:
```javascript
export function gracefulStopContainer(name, { prefix = '[destroy]' } = {}) {
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
```

### waitForContainers(names, timeoutSec)

**Purpose**: Waits for containers to stop

**Parameters**:
- `names` (string[]): Container names
- `timeoutSec` (number): Timeout in seconds (default: 5)

**Returns**: (string[]) Names of containers still running

### forceStopContainers(names, options)

**Purpose**: Force kills containers

**Parameters**:
- `names` (string[]): Container names
- `options.prefix` (string): Log prefix

**Implementation**:
```javascript
export function forceStopContainers(names, { prefix } = {}) {
    if (!Array.isArray(names) || !names.length) return;
    for (const chunk of chunkArray(names)) {
        try {
            console.log(`${prefix} Forcing kill for ${chunk.join(', ')}...`);
            execSync(`${containerRuntime} kill ${chunk.join(' ')}`, { stdio: 'ignore' });
        } catch (e) {
            // Fall back to individual kills
            for (const name of chunk) {
                try {
                    execSync(`${containerRuntime} kill ${name}`, { stdio: 'ignore' });
                } catch (err) { }
            }
        }
    }
}
```

### getContainerCandidates(name, rec)

**Purpose**: Gets possible container names for an agent

**Parameters**:
- `name` (string): Agent name
- `rec` (Object): Agent record

**Returns**: (string[]) Candidate container names

### stopConfiguredAgents(options)

**Purpose**: Stops all configured agent containers

**Parameters**:
- `options.fast` (boolean): Fast shutdown (shorter wait)

**Returns**: (string[]) Names of stopped containers

**Implementation**:
```javascript
export function stopConfiguredAgents({ fast = false } = {}) {
    const agents = loadAgents();
    const entries = Object.entries(agents || {})
        .filter(([name, rec]) => rec &&
            (rec.type === 'agent' || rec.type === 'agentCore') &&
            typeof name === 'string' && !name.startsWith('_'));

    const candidateSet = new Set();
    for (const [name, rec] of entries) {
        const candidates = getContainerCandidates(name, rec)
            .filter((candidate) => candidate && containerExists(candidate));
        for (const candidate of candidates) candidateSet.add(candidate);
    }

    const allCandidates = Array.from(candidateSet);
    if (!allCandidates.length) return [];

    // Graceful stop
    allCandidates.forEach((name) => gracefulStopContainer(name, { prefix: '[stop]' }));

    // Wait for stop
    const remaining = waitForContainers(allCandidates, 5);
    if (remaining.length) {
        forceStopContainers(remaining, { prefix: '[stop]' });
        waitForContainers(remaining, 2);
    }

    // Report and cleanup
    const stopped = allCandidates.filter((name) => !isContainerRunning(name));
    stopped.forEach((name) => {
        console.log(`[stop] Stopped ${name}`);
        clearLivenessState(name);
    });
    return stopped;
}
```

### stopAndRemoveMany(names, options)

**Purpose**: Stops and removes multiple containers

**Parameters**:
- `names` (string[]): Container/agent names
- `options.fast` (boolean): Fast shutdown

**Returns**: (string[]) Names of removed containers

**Implementation**:
```javascript
export function stopAndRemoveMany(names, { fast = false } = {}) {
    if (!Array.isArray(names) || !names.length) return [];

    const agents = loadAgents();
    const removalSet = new Set();
    const runningSet = new Set();

    // Collect all containers
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

    // Stop running containers
    const prefix = fast ? '[destroy-fast]' : '[destroy]';
    const runningList = Array.from(runningSet);
    if (runningList.length) {
        console.log(`${prefix} Sending SIGTERM to ${runningList.length} container(s)...`);
        for (const chunk of chunkArray(runningList)) {
            try {
                execSync(`${containerRuntime} kill --signal SIGTERM ${chunk.join(' ')}`, { stdio: 'ignore' });
            } catch (e) {
                for (const name of chunk) {
                    gracefulStopContainer(name, { prefix });
                }
            }
        }
    }

    // Wait and force kill if needed
    const waitSeconds = fast ? 0.1 : 5;
    const stillRunning = runningList.length ? waitForContainers(runningList, waitSeconds) : [];
    if (stillRunning.length) {
        forceStopContainers(stillRunning, { prefix });
    }

    // Remove containers
    const removalList = Array.from(removalSet);
    const removed = [];
    for (const chunk of chunkArray(removalList)) {
        try {
            execSync(`${containerRuntime} rm -f ${chunk.join(' ')}`, { stdio: 'ignore' });
            chunk.forEach((name) => {
                clearLivenessState(name);
                removed.push(name);
            });
        } catch (e) {
            // Fall back to individual removes
            for (const name of chunk) {
                try {
                    execSync(`${containerRuntime} rm -f ${name}`, { stdio: 'ignore' });
                    clearLivenessState(name);
                    removed.push(name);
                } catch (err) { }
            }
        }
    }

    return removed;
}
```

### stopAndRemove(name, fast)

**Purpose**: Stops and removes a single container

**Parameters**:
- `name` (string): Container name
- `fast` (boolean): Fast shutdown

**Returns**: (string[]) Removed container names

### listAllContainerNames()

**Purpose**: Lists all container names

**Returns**: (string[]) All container names

### destroyAllPloinky(options)

**Purpose**: Destroys all Ploinky containers globally

**Parameters**:
- `options.fast` (boolean): Fast shutdown

**Returns**: (number) Number of containers destroyed

### destroyWorkspaceContainers(options)

**Purpose**: Destroys all containers for current workspace

**Parameters**:
- `options.fast` (boolean): Fast shutdown

**Returns**: (string[]) Removed container names

### addSessionContainer(name)

**Purpose**: Adds a container to session tracking

**Parameters**:
- `name` (string): Container name

### cleanupSessionSet()

**Purpose**: Cleans up all session-tracked containers

**Returns**: (number) Number of containers cleaned

## Session Tracking

```javascript
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
```

## Exports

```javascript
export {
    addSessionContainer,
    cleanupSessionSet,
    destroyAllPloinky,
    destroyWorkspaceContainers,
    forceStopContainers,
    getContainerCandidates,
    gracefulStopContainer,
    listAllContainerNames,
    stopAndRemove,
    stopAndRemoveMany,
    stopConfiguredAgents,
    waitForContainers
};
```

## Usage Example

```javascript
import {
    stopConfiguredAgents,
    stopAndRemoveMany,
    destroyWorkspaceContainers,
    addSessionContainer
} from './containerFleet.js';

// Stop all configured agents
const stopped = stopConfiguredAgents();
console.log(`Stopped ${stopped.length} containers`);

// Remove specific containers
stopAndRemoveMany(['agent1', 'agent2'], { fast: true });

// Destroy all workspace containers
const removed = destroyWorkspaceContainers();

// Track session containers
addSessionContainer('ploinky_basic_node-dev_project_abc123');
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container utilities
- [docker-health-probes.md](./docker-health-probes.md) - Health state
- [service-workspace.md](../workspace/service-workspace.md) - Agent config
