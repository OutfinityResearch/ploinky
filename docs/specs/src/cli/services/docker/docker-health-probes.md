# cli/services/docker/healthProbes.js - Health Probes

## Overview

Implements Kubernetes-style health probes (liveness and readiness) for agent containers. Supports probe scripts with configurable intervals, timeouts, thresholds, and exponential backoff on failure.

## Source File

`cli/services/docker/healthProbes.js`

## Dependencies

```javascript
import { spawnSync } from 'child_process';
import { parentPort } from 'worker_threads';
import {
    containerRuntime,
    waitForContainerRunning,
    sleepMs
} from './common.js';
```

## Constants

```javascript
const DEFAULT_INTERVAL_SECONDS = 1;
const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_SUCCESS_THRESHOLD = 1;
const BACKOFF_BASE_DELAY_MS = 10_000;      // 10 seconds
const BACKOFF_MAX_DELAY_MS = 300_000;       // 5 minutes
const BACKOFF_RESET_MS = 600_000;           // 10 minutes
const LIVENESS_BACKOFF_STATE = new Map();
```

## Internal Functions

### postProbeLog(level, message)

**Purpose**: Posts log messages to parent thread (if running in worker)

**Parameters**:
- `level` (string): Log level ('info', 'warn', 'error')
- `message` (string): Log message

### normalizeProbeConfig(type, manifestProbeConfig)

**Purpose**: Normalizes and validates probe configuration

**Parameters**:
- `type` (string): 'liveness' or 'readiness'
- `manifestProbeConfig` (Object): Raw probe config from manifest

**Returns**: (Object|null) Normalized config or null if invalid

**Normalized Config**:
```javascript
{
    script: string,           // Script filename
    interval: number,         // Seconds between probes
    timeout: number,          // Max seconds per probe
    failureThreshold: number, // Failures before unhealthy
    successThreshold: number  // Successes before healthy
}
```

### validateScriptName(type, script)

**Purpose**: Validates probe script name (no path traversal)

**Throws**: Error if script contains `/`, `\`, or `..`

### runProbeOnce(agentName, containerName, probe)

**Purpose**: Executes a single probe check

**Returns**:
```javascript
{
    success: boolean,
    exitCode: number,
    timedOut: boolean,
    stdout: string,
    stderr: string
}
```

### ensureScriptExists(agentName, containerName, probe)

**Purpose**: Verifies probe script exists in container

**Throws**: Error if script not found

### runProbeLoop(agentName, containerName, type, probe)

**Purpose**: Runs probe checks in a loop until threshold met

**Returns**: `{ status: 'success'|'failed', reason?: string, detail?: string }`

### computeBackoffDelay(state)

**Purpose**: Calculates exponential backoff delay

**Formula**: `min(BASE * 2^retryCount, MAX)`

### restartContainer(agentName, containerName)

**Purpose**: Restarts a container and waits for running state

## Public API

### runHealthProbes(agentName, containerName, manifest)

**Purpose**: Runs health probes defined in manifest

**Parameters**:
- `agentName` (string): Agent name for logging
- `containerName` (string): Container to probe
- `manifest` (Object): Manifest with health config

**Behavior**:
1. Waits for container to be running
2. Normalizes liveness and readiness probe configs
3. Runs liveness probe first (restarts on failure)
4. Runs readiness probe second (warns on failure)

**Implementation**:
```javascript
export function runHealthProbes(agentName, containerName, manifest = {}) {
    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[probe] ${agentName}: failed to start; container is not running.`);
    }

    const healthConfig = manifest?.health || {};
    const livenessProbe = normalizeProbeConfig('liveness', healthConfig.liveness);
    const readinessProbe = normalizeProbeConfig('readiness', healthConfig.readiness);

    if (livenessProbe) {
        noteContainerStarted(containerName);
    } else {
        clearLivenessState(containerName);
    }

    if (!livenessProbe && !readinessProbe) {
        postProbeLog('info', `[probe] ${agentName}: no health probes defined. Assuming live & ready.`);
        return;
    }

    ensureLiveness(agentName, containerName, livenessProbe);
    ensureReadiness(agentName, containerName, readinessProbe);
}
```

### clearLivenessState(containerName)

**Purpose**: Clears backoff state for a container

**Parameters**:
- `containerName` (string): Container name

## Probe Behavior

### Liveness Probe

**Purpose**: Checks if agent is alive; restarts on failure

**Behavior**:
- Runs script in `/code` directory
- On failure: Restarts container with exponential backoff
- Backoff resets after 10 minutes of stable runtime

**Implementation**:
```javascript
function ensureLiveness(agentName, containerName, probe) {
    if (!probe) {
        postProbeLog('info', `[probe] ${agentName}: no liveness probe declared. Assuming live.`);
        clearLivenessState(containerName);
        return;
    }

    const state = getLivenessState(containerName);
    if (!state.startedAt) {
        state.startedAt = Date.now();
    }

    while (true) {
        const result = runProbeLoop(agentName, containerName, 'liveness', probe);
        if (result.status === 'success') {
            postProbeLog('info', `[probe] ${agentName}: liveness confirmed.`);
            clearLivenessState(containerName);
            return;
        }

        postProbeLog('warn', `[probe] ${agentName}: liveness probe failed (${result.reason}${result.detail ? `, output='${result.detail}'` : ''}).`);
        maybeResetBackoff(agentName, state);

        restartContainer(agentName, containerName);
        state.retryCount += 1;
        noteContainerStarted(containerName);

        const backoffDelayMs = computeBackoffDelay(state);
        postProbeLog('warn', `[probe] ${agentName}: CrashLoopBackOff waiting ${Math.round(backoffDelayMs / 1000)}s before next liveness probe (retry ${state.retryCount}).`);
        sleepMs(backoffDelayMs);
    }
}
```

### Readiness Probe

**Purpose**: Checks if agent is ready for traffic

**Behavior**:
- Runs script in `/code` directory
- On failure: Warns but does not restart (non-fatal)

## Exports

```javascript
export { runHealthProbes, clearLivenessState };

export const __testHooks = {
    coercePositiveNumber,
    coercePositiveInteger,
    validateScriptName,
    normalizeProbeConfig,
    computeBackoffDelay,
    maybeResetBackoff,
    getLivenessState,
    noteContainerStarted,
    LIVENESS_BACKOFF_STATE
};

export const __testConstants = {
    DEFAULT_INTERVAL_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_FAILURE_THRESHOLD,
    DEFAULT_SUCCESS_THRESHOLD,
    BACKOFF_BASE_DELAY_MS,
    BACKOFF_MAX_DELAY_MS,
    BACKOFF_RESET_MS
};
```

## Manifest Configuration

```json
{
    "health": {
        "liveness": {
            "script": "health-check.sh",
            "interval": 5,
            "timeout": 10,
            "failureThreshold": 3,
            "successThreshold": 1
        },
        "readiness": {
            "script": "ready-check.sh",
            "interval": 2,
            "timeout": 5,
            "failureThreshold": 5,
            "successThreshold": 1
        }
    }
}
```

## Probe Script Requirements

1. Script must be in agent root (`/code/`)
2. No path separators allowed in script name
3. Script must be executable
4. Exit code 0 = healthy
5. Non-zero exit code = unhealthy
6. Script runs in shell: `sh -lc "cd /code && sh ./script.sh"`

## Backoff Behavior

```
Retry 0: Wait 10 seconds
Retry 1: Wait 20 seconds
Retry 2: Wait 40 seconds
Retry 3: Wait 80 seconds
Retry 4: Wait 160 seconds
Retry 5+: Wait 300 seconds (max)

Reset to 0 after 10 minutes of stable runtime
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container utilities
- [docker-agent-service-manager.md](./docker-agent-service-manager.md) - Agent lifecycle
