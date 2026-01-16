# cli/server/containerMonitor.js - Container Monitor

## Overview

Monitors Docker/Podman containers for agent processes, synchronizes with workspace agents.json, and manages container health with automatic restart capabilities. Implements per-container backoff and circuit breaker patterns.

## Source File

`cli/server/containerMonitor.js`

## Dependencies

```javascript
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { appendLog } from './utils/logger.js';
import { containerRuntime } from '../services/docker/common.js';
```

## Constants

```javascript
// Monitoring intervals
const SYNC_INTERVAL_MS = 10000;           // 10 seconds
const HEALTH_CHECK_INTERVAL_MS = 15000;   // 15 seconds
const EVENT_POLL_INTERVAL_MS = 2000;      // 2 seconds

// Backoff configuration
const INITIAL_BACKOFF_MS = 2000;          // 2 seconds
const MAX_BACKOFF_MS = 60000;             // 60 seconds
const BACKOFF_MULTIPLIER = 2;

// Circuit breaker
const CIRCUIT_THRESHOLD = 3;              // 3 failures
const CIRCUIT_COOLDOWN_MS = 120000;       // 2 minutes

// Container states
const ContainerState = {
    UNKNOWN: 'unknown',
    CREATED: 'created',
    RUNNING: 'running',
    PAUSED: 'paused',
    RESTARTING: 'restarting',
    EXITED: 'exited',
    DEAD: 'dead'
};
```

## Data Structures

```javascript
/**
 * @typedef {Object} ContainerInfo
 * @property {string} name - Container name
 * @property {string} id - Container ID
 * @property {string} agentName - Associated agent name
 * @property {string} state - Container state
 * @property {number} hostPort - Mapped host port
 * @property {boolean} healthy - Health status
 * @property {number} restartCount - Restart attempts
 * @property {number} lastStartTime - Last start timestamp
 * @property {number} backoffMs - Current backoff delay
 * @property {CircuitState} circuit - Circuit breaker state
 */

/**
 * @typedef {Object} CircuitState
 * @property {boolean} isOpen - Circuit is open
 * @property {number[]} failures - Failure timestamps
 * @property {number} openedAt - When circuit opened
 */

/**
 * @typedef {Object} ProbeWorker
 * @property {string} containerName - Target container
 * @property {number} intervalId - Probe interval ID
 * @property {number} consecutiveFailures - Failure count
 */

/**
 * @typedef {Object} AgentEntry
 * @property {string} name - Agent name
 * @property {string} containerName - Container name
 * @property {number} hostPort - Host port
 * @property {string} status - Agent status
 */
```

## Class: ContainerMonitor

### Constructor

**Purpose**: Creates container monitor instance

**Parameters**:
- `agentsJsonPath` (string): Path to agents.json file
- `callbacks` (Object): Event callbacks

**Implementation**:
```javascript
export class ContainerMonitor extends EventEmitter {
    constructor(agentsJsonPath, callbacks = {}) {
        super();

        this.agentsJsonPath = agentsJsonPath;
        this.callbacks = callbacks;

        this.containers = new Map();      // containerName -> ContainerInfo
        this.probeWorkers = new Map();    // containerName -> ProbeWorker
        this.eventStream = null;          // Docker/Podman event stream

        this.syncIntervalId = null;
        this.isRunning = false;
    }
```

### start()

**Purpose**: Starts the container monitoring system

**Implementation**:
```javascript
    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        appendLog('[container-monitor] Starting');

        // Initial sync
        this._syncWithAgentsJson();

        // Start periodic sync
        this.syncIntervalId = setInterval(() => {
            this._syncWithAgentsJson();
        }, SYNC_INTERVAL_MS);

        // Start container event stream
        this._startEventStream();

        this.emit('started');
    }
```

### stop()

**Purpose**: Stops container monitoring

**Implementation**:
```javascript
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        appendLog('[container-monitor] Stopping');

        // Stop sync interval
        if (this.syncIntervalId) {
            clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }

        // Stop all probe workers
        for (const [containerName, worker] of this.probeWorkers) {
            clearInterval(worker.intervalId);
        }
        this.probeWorkers.clear();

        // Stop event stream
        if (this.eventStream) {
            this.eventStream.kill();
            this.eventStream = null;
        }

        this.emit('stopped');
    }
```

### _syncWithAgentsJson()

**Purpose**: Synchronizes monitored containers with agents.json file

**Implementation**:
```javascript
    _syncWithAgentsJson() {
        try {
            if (!fs.existsSync(this.agentsJsonPath)) {
                return;
            }

            const agentsData = JSON.parse(fs.readFileSync(this.agentsJsonPath, 'utf8'));
            const agents = agentsData.agents || [];

            const currentContainers = new Set();

            for (const agent of agents) {
                if (!agent.containerName) continue;

                currentContainers.add(agent.containerName);

                if (!this.containers.has(agent.containerName)) {
                    // New container to monitor
                    this._addContainer(agent);
                } else {
                    // Update existing container info
                    const container = this.containers.get(agent.containerName);
                    container.hostPort = agent.hostPort;
                    container.agentName = agent.name;
                }
            }

            // Remove containers no longer in agents.json
            for (const [containerName] of this.containers) {
                if (!currentContainers.has(containerName)) {
                    this._removeContainer(containerName);
                }
            }
        } catch (err) {
            appendLog(`[container-monitor] Sync error: ${err.message}`);
        }
    }
```

### _addContainer(agent)

**Purpose**: Adds container to monitoring

**Parameters**:
- `agent` (AgentEntry): Agent entry from agents.json

**Implementation**:
```javascript
    _addContainer(agent) {
        const containerInfo = {
            name: agent.containerName,
            id: null,
            agentName: agent.name,
            state: ContainerState.UNKNOWN,
            hostPort: agent.hostPort,
            healthy: false,
            restartCount: 0,
            lastStartTime: 0,
            backoffMs: INITIAL_BACKOFF_MS,
            circuit: {
                isOpen: false,
                failures: [],
                openedAt: 0
            }
        };

        // Get current container state
        this._updateContainerState(containerInfo);

        this.containers.set(agent.containerName, containerInfo);

        // Start health probe worker
        this._startProbeWorker(agent.containerName);

        appendLog(`[container-monitor] Added container: ${agent.containerName}`);
        this.emit('container_added', { containerName: agent.containerName, agentName: agent.name });
    }
```

### _removeContainer(containerName)

**Purpose**: Removes container from monitoring

**Parameters**:
- `containerName` (string): Container to remove

**Implementation**:
```javascript
    _removeContainer(containerName) {
        // Stop probe worker
        const worker = this.probeWorkers.get(containerName);
        if (worker) {
            clearInterval(worker.intervalId);
            this.probeWorkers.delete(containerName);
        }

        this.containers.delete(containerName);

        appendLog(`[container-monitor] Removed container: ${containerName}`);
        this.emit('container_removed', { containerName });
    }
```

### _updateContainerState(containerInfo)

**Purpose**: Updates container state from runtime

**Parameters**:
- `containerInfo` (ContainerInfo): Container to update

**Implementation**:
```javascript
    _updateContainerState(containerInfo) {
        try {
            const output = execSync(
                `${containerRuntime} inspect --format '{{.Id}} {{.State.Status}}' ${containerInfo.name}`,
                { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();

            const [id, state] = output.split(' ');
            containerInfo.id = id;
            containerInfo.state = state || ContainerState.UNKNOWN;

            if (containerInfo.state === ContainerState.RUNNING) {
                containerInfo.lastStartTime = Date.now();
            }
        } catch (err) {
            containerInfo.state = ContainerState.UNKNOWN;
        }
    }
```

### _startEventStream()

**Purpose**: Starts Docker/Podman event stream listener

**Implementation**:
```javascript
    _startEventStream() {
        const args = ['events', '--format', '{{json .}}', '--filter', 'type=container'];

        this.eventStream = spawn(containerRuntime, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let buffer = '';

        this.eventStream.stdout.on('data', (data) => {
            buffer += data.toString();

            // Process complete JSON lines
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    this._handleContainerEvent(event);
                } catch (err) {
                    appendLog(`[container-monitor] Event parse error: ${err.message}`);
                }
            }
        });

        this.eventStream.on('error', (err) => {
            appendLog(`[container-monitor] Event stream error: ${err.message}`);
        });

        this.eventStream.on('exit', (code) => {
            appendLog(`[container-monitor] Event stream exited with code ${code}`);

            // Restart event stream if still running
            if (this.isRunning) {
                setTimeout(() => this._startEventStream(), 5000);
            }
        });
    }
```

### _handleContainerEvent(event)

**Purpose**: Processes container lifecycle events

**Parameters**:
- `event` (Object): Docker/Podman event object

**Implementation**:
```javascript
    _handleContainerEvent(event) {
        const containerName = event.Actor?.Attributes?.name;
        if (!containerName || !this.containers.has(containerName)) return;

        const container = this.containers.get(containerName);
        const action = event.Action;

        appendLog(`[container-monitor] Event: ${containerName} ${action}`);

        switch (action) {
            case 'start':
                container.state = ContainerState.RUNNING;
                container.lastStartTime = Date.now();
                container.healthy = false;
                this.emit('container_started', { containerName, agentName: container.agentName });
                break;

            case 'stop':
            case 'kill':
                container.state = ContainerState.EXITED;
                this._handleContainerExit(containerName, event.Actor?.Attributes?.exitCode);
                break;

            case 'die':
                container.state = ContainerState.EXITED;
                const exitCode = parseInt(event.Actor?.Attributes?.exitCode || '1', 10);
                this._handleContainerExit(containerName, exitCode);
                break;

            case 'pause':
                container.state = ContainerState.PAUSED;
                break;

            case 'unpause':
                container.state = ContainerState.RUNNING;
                break;

            case 'health_status: healthy':
                container.healthy = true;
                this.emit('container_healthy', { containerName });
                break;

            case 'health_status: unhealthy':
                container.healthy = false;
                this._handleHealthFailure(containerName);
                break;
        }
    }
```

### _handleContainerExit(containerName, exitCode)

**Purpose**: Handles container exit with backoff and circuit breaker

**Parameters**:
- `containerName` (string): Container that exited
- `exitCode` (number): Exit code

**Implementation**:
```javascript
    _handleContainerExit(containerName, exitCode) {
        const container = this.containers.get(containerName);
        if (!container) return;

        appendLog(`[container-monitor] Container ${containerName} exited with code ${exitCode}`);

        // Invoke callback
        if (this.callbacks.onContainerExit) {
            this.callbacks.onContainerExit(containerName, exitCode);
        }

        this.emit('container_exited', { containerName, exitCode, agentName: container.agentName });

        // Record failure for circuit breaker
        const now = Date.now();
        container.circuit.failures = container.circuit.failures.filter(t => now - t < CIRCUIT_COOLDOWN_MS);
        container.circuit.failures.push(now);

        // Check circuit breaker
        if (container.circuit.failures.length >= CIRCUIT_THRESHOLD) {
            container.circuit.isOpen = true;
            container.circuit.openedAt = now;
            appendLog(`[container-monitor] Circuit breaker opened for ${containerName}`);
            this.emit('circuit_open', { containerName });
            return;
        }

        // Schedule restart with backoff
        this._scheduleRestart(containerName);
    }
```

### _scheduleRestart(containerName)

**Purpose**: Schedules container restart with exponential backoff

**Parameters**:
- `containerName` (string): Container to restart

**Implementation**:
```javascript
    _scheduleRestart(containerName) {
        const container = this.containers.get(containerName);
        if (!container) return;

        // Check circuit breaker
        if (container.circuit.isOpen) {
            const elapsed = Date.now() - container.circuit.openedAt;
            if (elapsed < CIRCUIT_COOLDOWN_MS) {
                appendLog(`[container-monitor] Circuit open for ${containerName}, cooldown: ${CIRCUIT_COOLDOWN_MS - elapsed}ms`);
                return;
            }
            // Reset circuit breaker
            container.circuit.isOpen = false;
            container.circuit.failures = [];
            appendLog(`[container-monitor] Circuit breaker reset for ${containerName}`);
        }

        const delay = container.backoffMs;
        container.restartCount++;

        appendLog(`[container-monitor] Scheduling restart for ${containerName} in ${delay}ms (attempt ${container.restartCount})`);

        setTimeout(() => {
            this._restartContainer(containerName);
        }, delay);

        // Increase backoff for next failure
        container.backoffMs = Math.min(container.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    }
```

### _restartContainer(containerName)

**Purpose**: Restarts a container

**Parameters**:
- `containerName` (string): Container to restart

**Implementation**:
```javascript
    _restartContainer(containerName) {
        const container = this.containers.get(containerName);
        if (!container) return;

        try {
            appendLog(`[container-monitor] Restarting container: ${containerName}`);

            execSync(`${containerRuntime} start ${containerName}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });

            container.state = ContainerState.RUNNING;
            container.lastStartTime = Date.now();
            container.backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success

            if (this.callbacks.onContainerRestart) {
                this.callbacks.onContainerRestart(containerName);
            }

            this.emit('container_restarted', { containerName, agentName: container.agentName });
        } catch (err) {
            appendLog(`[container-monitor] Restart failed for ${containerName}: ${err.message}`);
            this._handleContainerExit(containerName, 1);
        }
    }
```

### _startProbeWorker(containerName)

**Purpose**: Starts health probe worker for container

**Parameters**:
- `containerName` (string): Container to probe

**Implementation**:
```javascript
    _startProbeWorker(containerName) {
        const container = this.containers.get(containerName);
        if (!container) return;

        // Stop existing worker
        this._stopProbeWorker(containerName);

        const worker = {
            containerName,
            consecutiveFailures: 0,
            intervalId: setInterval(() => {
                this._runHealthProbe(containerName);
            }, HEALTH_CHECK_INTERVAL_MS)
        };

        this.probeWorkers.set(containerName, worker);
    }
```

### _stopProbeWorker(containerName)

**Purpose**: Stops health probe worker

**Parameters**:
- `containerName` (string): Container to stop probing

**Implementation**:
```javascript
    _stopProbeWorker(containerName) {
        const worker = this.probeWorkers.get(containerName);
        if (worker) {
            clearInterval(worker.intervalId);
            this.probeWorkers.delete(containerName);
        }
    }
```

### _runHealthProbe(containerName)

**Purpose**: Runs health check probe against container

**Parameters**:
- `containerName` (string): Container to probe

**Implementation**:
```javascript
    async _runHealthProbe(containerName) {
        const container = this.containers.get(containerName);
        const worker = this.probeWorkers.get(containerName);
        if (!container || !worker) return;

        if (container.state !== ContainerState.RUNNING) return;

        try {
            // Try HTTP health check if port available
            if (container.hostPort) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                try {
                    const response = await fetch(`http://127.0.0.1:${container.hostPort}/health`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeout);

                    if (response.ok) {
                        container.healthy = true;
                        worker.consecutiveFailures = 0;
                        return;
                    }
                } catch (fetchErr) {
                    clearTimeout(timeout);
                    // Fall through to failure handling
                }
            }

            // Fallback: check container is still running
            const output = execSync(
                `${containerRuntime} inspect --format '{{.State.Running}}' ${containerName}`,
                { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();

            if (output === 'true') {
                container.healthy = true;
                worker.consecutiveFailures = 0;
                return;
            }

            throw new Error('Container not running');
        } catch (err) {
            container.healthy = false;
            worker.consecutiveFailures++;

            appendLog(`[container-monitor] Health probe failed for ${containerName}: ${err.message} (${worker.consecutiveFailures})`);

            if (worker.consecutiveFailures >= 3) {
                this._handleHealthFailure(containerName);
            }
        }
    }
```

### _handleHealthFailure(containerName)

**Purpose**: Handles container health check failure

**Parameters**:
- `containerName` (string): Unhealthy container

**Implementation**:
```javascript
    _handleHealthFailure(containerName) {
        const container = this.containers.get(containerName);
        if (!container) return;

        appendLog(`[container-monitor] Health failure threshold reached for ${containerName}`);

        if (this.callbacks.onContainerHealthFailed) {
            this.callbacks.onContainerHealthFailed(containerName);
        }

        this.emit('container_health_failed', { containerName, agentName: container.agentName });

        // Record failure and potentially restart
        this._handleContainerExit(containerName, 1);
    }
```

### getStatus()

**Purpose**: Gets status of all monitored containers

**Returns**: (Object[]) Array of container statuses

**Implementation**:
```javascript
    getStatus() {
        const statuses = [];

        for (const [containerName, container] of this.containers) {
            statuses.push({
                name: containerName,
                agentName: container.agentName,
                state: container.state,
                healthy: container.healthy,
                hostPort: container.hostPort,
                restartCount: container.restartCount,
                uptime: container.state === ContainerState.RUNNING
                    ? Date.now() - container.lastStartTime
                    : 0,
                circuitOpen: container.circuit.isOpen
            });
        }

        return statuses;
    }
```

### resetCircuitBreaker(containerName)

**Purpose**: Manually resets circuit breaker for container

**Parameters**:
- `containerName` (string): Container name

**Implementation**:
```javascript
    resetCircuitBreaker(containerName) {
        const container = this.containers.get(containerName);
        if (!container) return;

        container.circuit.isOpen = false;
        container.circuit.failures = [];
        container.circuit.openedAt = 0;
        container.backoffMs = INITIAL_BACKOFF_MS;
        container.restartCount = 0;

        appendLog(`[container-monitor] Circuit breaker reset for ${containerName}`);
        this.emit('circuit_reset', { containerName });
    }
}
```

## Exports

```javascript
export { ContainerMonitor, ContainerState };
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `started` | - | Monitor started |
| `stopped` | - | Monitor stopped |
| `container_added` | `{ containerName, agentName }` | Container added to monitoring |
| `container_removed` | `{ containerName }` | Container removed from monitoring |
| `container_started` | `{ containerName, agentName }` | Container started |
| `container_exited` | `{ containerName, exitCode, agentName }` | Container exited |
| `container_restarted` | `{ containerName, agentName }` | Container restarted |
| `container_healthy` | `{ containerName }` | Container became healthy |
| `container_health_failed` | `{ containerName, agentName }` | Container health check failed |
| `circuit_open` | `{ containerName }` | Circuit breaker opened |
| `circuit_reset` | `{ containerName }` | Circuit breaker reset |

## Usage Example

```javascript
import { ContainerMonitor, ContainerState } from './containerMonitor.js';

const monitor = new ContainerMonitor('.ploinky/agents.json', {
    onContainerExit: (containerName, exitCode) => {
        console.log(`Container ${containerName} exited with code ${exitCode}`);
    },
    onContainerRestart: (containerName) => {
        console.log(`Container ${containerName} restarted`);
    },
    onContainerHealthFailed: (containerName) => {
        console.log(`Container ${containerName} health failed`);
    }
});

// Listen for events
monitor.on('container_exited', ({ containerName, exitCode }) => {
    console.log(`Exit event: ${containerName} code=${exitCode}`);
});

monitor.on('circuit_open', ({ containerName }) => {
    console.log(`Circuit breaker opened for ${containerName}`);
});

// Start monitoring
monitor.start();

// Get status
const statuses = monitor.getStatus();
for (const status of statuses) {
    console.log(`${status.name}: ${status.state} healthy=${status.healthy}`);
}

// Reset circuit breaker
monitor.resetCircuitBreaker('ploinky_basic_node-dev_proj_abc');

// Stop monitoring
monitor.stop();
```

## Agents.json Format

```json
{
    "agents": [
        {
            "name": "node-dev",
            "containerName": "ploinky_basic_node-dev_proj_abc",
            "hostPort": 3001,
            "status": "running"
        },
        {
            "name": "python-dev",
            "containerName": "ploinky_basic_python-dev_proj_abc",
            "hostPort": 3002,
            "status": "running"
        }
    ]
}
```

## Related Modules

- [server-watchdog.md](./server-watchdog.md) - Process watchdog
- [docker-health-probes.md](../services/docker/docker-health-probes.md) - Health probes
- [docker-common.md](../services/docker/docker-common.md) - Container runtime
