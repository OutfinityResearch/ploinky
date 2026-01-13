# cli/server/Watchdog.js - Process Manager

## Overview

Manages long-running processes with health checks, automatic restart, exponential backoff, and circuit breaker protection. Provides comprehensive process lifecycle management for Ploinky servers and services.

## Source File

`cli/server/Watchdog.js`

## Dependencies

```javascript
import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { appendLog } from './utils/logger.js';
import { ContainerMonitor } from './containerMonitor.js';
```

## Constants

```javascript
// Backoff configuration
const INITIAL_BACKOFF_MS = 1000;          // 1 second initial delay
const MAX_BACKOFF_MS = 30000;             // 30 seconds maximum delay
const BACKOFF_MULTIPLIER = 2;             // Double delay each failure

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5;      // Max restarts before tripping
const CIRCUIT_BREAKER_WINDOW_MS = 60000;  // 60 second window

// Health check configuration
const HEALTH_CHECK_INTERVAL_MS = 30000;   // Check every 30 seconds
const HEALTH_CHECK_TIMEOUT_MS = 5000;     // 5 second timeout
const HEALTH_FAILURE_THRESHOLD = 3;       // 3 failures before restart

// Process states
const ProcessState = {
    STOPPED: 'stopped',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPING: 'stopping',
    FAILED: 'failed',
    CIRCUIT_OPEN: 'circuit_open'
};
```

## Data Structures

```javascript
/**
 * @typedef {Object} ProcessConfig
 * @property {string} name - Process identifier
 * @property {string} command - Command to execute
 * @property {string[]} args - Command arguments
 * @property {string} cwd - Working directory
 * @property {Object} env - Environment variables
 * @property {Function} healthCheck - Health check function
 * @property {boolean} autoRestart - Enable auto-restart
 * @property {number} restartDelay - Initial restart delay
 * @property {number} maxRestarts - Maximum restart attempts
 */

/**
 * @typedef {Object} ProcessInfo
 * @property {string} name - Process name
 * @property {string} state - Current state
 * @property {number|null} pid - Process ID
 * @property {number} startCount - Total start count
 * @property {number} restartCount - Restarts since last success
 * @property {number} lastStartTime - Last start timestamp
 * @property {number} uptime - Current uptime in ms
 * @property {number} healthFailures - Consecutive health failures
 * @property {string|null} lastError - Last error message
 */

/**
 * @typedef {Object} CircuitBreakerState
 * @property {boolean} isOpen - Circuit is open (blocking restarts)
 * @property {number[]} failures - Failure timestamps
 * @property {number} openedAt - When circuit opened
 * @property {number} cooldownMs - Cooldown period
 */
```

## Class: Watchdog

### Constructor

**Purpose**: Creates watchdog process manager

**Parameters**:
- `options` (Object): Configuration options

**Implementation**:
```javascript
export class Watchdog extends EventEmitter {
    constructor(options = {}) {
        super();

        this.processes = new Map();          // name -> ProcessEntry
        this.circuitBreakers = new Map();    // name -> CircuitBreakerState
        this.healthCheckers = new Map();     // name -> interval ID
        this.containerMonitor = null;

        this.options = {
            enableContainerMonitoring: options.enableContainerMonitoring ?? true,
            healthCheckInterval: options.healthCheckInterval ?? HEALTH_CHECK_INTERVAL_MS,
            maxBackoff: options.maxBackoff ?? MAX_BACKOFF_MS,
            ...options
        };

        this._setupSignalHandlers();
    }
```

### _setupSignalHandlers()

**Purpose**: Sets up process signal handlers for graceful shutdown

**Implementation**:
```javascript
    _setupSignalHandlers() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

        for (const signal of signals) {
            process.on(signal, async () => {
                appendLog(`[watchdog] Received ${signal}, initiating shutdown`);
                await this.shutdown();
                process.exit(0);
            });
        }

        process.on('uncaughtException', (err) => {
            appendLog(`[watchdog] Uncaught exception: ${err.message}`);
            this.emit('error', err);
        });

        process.on('unhandledRejection', (reason) => {
            appendLog(`[watchdog] Unhandled rejection: ${reason}`);
        });
    }
```

### register(config)

**Purpose**: Registers a process for management

**Parameters**:
- `config` (ProcessConfig): Process configuration

**Returns**: (Watchdog) this for chaining

**Implementation**:
```javascript
    register(config) {
        const { name, command, args = [], cwd = process.cwd(), env = {}, healthCheck, autoRestart = true, maxRestarts = -1 } = config;

        if (!name || !command) {
            throw new Error('Process name and command are required');
        }

        if (this.processes.has(name)) {
            throw new Error(`Process '${name}' already registered`);
        }

        const entry = {
            config: {
                name,
                command,
                args,
                cwd,
                env: { ...process.env, ...env },
                healthCheck,
                autoRestart,
                maxRestarts
            },
            process: null,
            state: ProcessState.STOPPED,
            pid: null,
            startCount: 0,
            restartCount: 0,
            lastStartTime: 0,
            healthFailures: 0,
            lastError: null,
            backoffMs: INITIAL_BACKOFF_MS
        };

        this.processes.set(name, entry);
        this.circuitBreakers.set(name, {
            isOpen: false,
            failures: [],
            openedAt: 0,
            cooldownMs: CIRCUIT_BREAKER_WINDOW_MS
        });

        appendLog(`[watchdog] Registered process: ${name}`);
        this.emit('registered', { name });

        return this;
    }
```

### start(name)

**Purpose**: Starts a registered process

**Parameters**:
- `name` (string): Process name

**Returns**: (Promise<boolean>) Success status

**Implementation**:
```javascript
    async start(name) {
        const entry = this.processes.get(name);
        if (!entry) {
            throw new Error(`Process '${name}' not registered`);
        }

        if (entry.state === ProcessState.RUNNING) {
            appendLog(`[watchdog] Process ${name} already running`);
            return true;
        }

        // Check circuit breaker
        const circuit = this.circuitBreakers.get(name);
        if (circuit.isOpen) {
            const elapsed = Date.now() - circuit.openedAt;
            if (elapsed < circuit.cooldownMs) {
                appendLog(`[watchdog] Circuit open for ${name}, cooldown remaining: ${circuit.cooldownMs - elapsed}ms`);
                entry.state = ProcessState.CIRCUIT_OPEN;
                return false;
            }
            // Reset circuit breaker
            circuit.isOpen = false;
            circuit.failures = [];
            appendLog(`[watchdog] Circuit breaker reset for ${name}`);
        }

        entry.state = ProcessState.STARTING;
        this.emit('starting', { name });

        try {
            const { config } = entry;

            const child = spawn(config.command, config.args, {
                cwd: config.cwd,
                env: config.env,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false
            });

            entry.process = child;
            entry.pid = child.pid;
            entry.state = ProcessState.RUNNING;
            entry.startCount++;
            entry.lastStartTime = Date.now();
            entry.backoffMs = INITIAL_BACKOFF_MS;

            appendLog(`[watchdog] Started ${name} (PID: ${child.pid})`);
            this.emit('started', { name, pid: child.pid });

            // Setup process event handlers
            child.stdout.on('data', (data) => {
                this.emit('stdout', { name, data: data.toString() });
            });

            child.stderr.on('data', (data) => {
                this.emit('stderr', { name, data: data.toString() });
            });

            child.on('error', (err) => {
                appendLog(`[watchdog] Process ${name} error: ${err.message}`);
                entry.lastError = err.message;
                this.emit('error', { name, error: err });
            });

            child.on('exit', (code, signal) => {
                this._handleProcessExit(name, code, signal);
            });

            // Start health checks if configured
            if (config.healthCheck) {
                this._startHealthCheck(name);
            }

            return true;
        } catch (err) {
            entry.state = ProcessState.FAILED;
            entry.lastError = err.message;
            appendLog(`[watchdog] Failed to start ${name}: ${err.message}`);
            this.emit('error', { name, error: err });
            return false;
        }
    }
```

### _handleProcessExit(name, code, signal)

**Purpose**: Handles process exit and manages restart logic

**Parameters**:
- `name` (string): Process name
- `code` (number|null): Exit code
- `signal` (string|null): Exit signal

**Implementation**:
```javascript
    _handleProcessExit(name, code, signal) {
        const entry = this.processes.get(name);
        if (!entry) return;

        const exitReason = signal ? `signal ${signal}` : `code ${code}`;
        appendLog(`[watchdog] Process ${name} exited with ${exitReason}`);

        entry.process = null;
        entry.pid = null;

        // Stop health checks
        this._stopHealthCheck(name);

        // Record failure for circuit breaker
        const circuit = this.circuitBreakers.get(name);
        const now = Date.now();

        // Clean old failures outside window
        circuit.failures = circuit.failures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);
        circuit.failures.push(now);

        // Check if circuit should open
        if (circuit.failures.length >= CIRCUIT_BREAKER_THRESHOLD) {
            circuit.isOpen = true;
            circuit.openedAt = now;
            entry.state = ProcessState.CIRCUIT_OPEN;
            appendLog(`[watchdog] Circuit breaker opened for ${name} after ${circuit.failures.length} failures`);
            this.emit('circuit_open', { name, failures: circuit.failures.length });
            return;
        }

        entry.state = ProcessState.STOPPED;
        this.emit('exited', { name, code, signal });

        // Auto-restart if enabled
        if (entry.config.autoRestart && entry.state !== ProcessState.STOPPING) {
            const { maxRestarts } = entry.config;

            if (maxRestarts === -1 || entry.restartCount < maxRestarts) {
                entry.restartCount++;
                const delay = entry.backoffMs;

                appendLog(`[watchdog] Scheduling restart for ${name} in ${delay}ms (attempt ${entry.restartCount})`);

                setTimeout(() => {
                    this.start(name).catch(err => {
                        appendLog(`[watchdog] Restart failed for ${name}: ${err.message}`);
                    });
                }, delay);

                // Increase backoff for next failure
                entry.backoffMs = Math.min(entry.backoffMs * BACKOFF_MULTIPLIER, this.options.maxBackoff);
            } else {
                entry.state = ProcessState.FAILED;
                appendLog(`[watchdog] Max restarts reached for ${name}`);
                this.emit('max_restarts', { name, restartCount: entry.restartCount });
            }
        }
    }
```

### _startHealthCheck(name)

**Purpose**: Starts periodic health checks for a process

**Parameters**:
- `name` (string): Process name

**Implementation**:
```javascript
    _startHealthCheck(name) {
        const entry = this.processes.get(name);
        if (!entry || !entry.config.healthCheck) return;

        // Clear existing interval
        this._stopHealthCheck(name);

        const intervalId = setInterval(async () => {
            if (entry.state !== ProcessState.RUNNING) {
                return;
            }

            try {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
                });

                const checkPromise = entry.config.healthCheck(entry);

                const healthy = await Promise.race([checkPromise, timeoutPromise]);

                if (healthy) {
                    entry.healthFailures = 0;
                    entry.restartCount = 0; // Reset restart count on healthy check
                    this.emit('health_ok', { name });
                } else {
                    throw new Error('Health check returned false');
                }
            } catch (err) {
                entry.healthFailures++;
                appendLog(`[watchdog] Health check failed for ${name}: ${err.message} (${entry.healthFailures}/${HEALTH_FAILURE_THRESHOLD})`);
                this.emit('health_failed', { name, failures: entry.healthFailures, error: err.message });

                if (entry.healthFailures >= HEALTH_FAILURE_THRESHOLD) {
                    appendLog(`[watchdog] Health threshold reached for ${name}, restarting`);
                    await this.restart(name);
                }
            }
        }, this.options.healthCheckInterval);

        this.healthCheckers.set(name, intervalId);
    }
```

### _stopHealthCheck(name)

**Purpose**: Stops health checks for a process

**Parameters**:
- `name` (string): Process name

**Implementation**:
```javascript
    _stopHealthCheck(name) {
        const intervalId = this.healthCheckers.get(name);
        if (intervalId) {
            clearInterval(intervalId);
            this.healthCheckers.delete(name);
        }
    }
```

### stop(name, signal = 'SIGTERM')

**Purpose**: Stops a running process

**Parameters**:
- `name` (string): Process name
- `signal` (string): Signal to send (default: SIGTERM)

**Returns**: (Promise<boolean>) Success status

**Implementation**:
```javascript
    async stop(name, signal = 'SIGTERM') {
        const entry = this.processes.get(name);
        if (!entry) {
            throw new Error(`Process '${name}' not registered`);
        }

        if (entry.state !== ProcessState.RUNNING || !entry.process) {
            appendLog(`[watchdog] Process ${name} not running`);
            return true;
        }

        entry.state = ProcessState.STOPPING;
        this._stopHealthCheck(name);

        return new Promise((resolve) => {
            const killTimeout = setTimeout(() => {
                // Force kill if graceful shutdown fails
                if (entry.process) {
                    appendLog(`[watchdog] Force killing ${name}`);
                    entry.process.kill('SIGKILL');
                }
            }, 10000);

            entry.process.once('exit', () => {
                clearTimeout(killTimeout);
                entry.state = ProcessState.STOPPED;
                appendLog(`[watchdog] Stopped ${name}`);
                this.emit('stopped', { name });
                resolve(true);
            });

            appendLog(`[watchdog] Sending ${signal} to ${name} (PID: ${entry.pid})`);
            entry.process.kill(signal);
        });
    }
```

### restart(name)

**Purpose**: Restarts a process

**Parameters**:
- `name` (string): Process name

**Returns**: (Promise<boolean>) Success status

**Implementation**:
```javascript
    async restart(name) {
        appendLog(`[watchdog] Restarting ${name}`);
        this.emit('restarting', { name });

        await this.stop(name);

        // Brief delay before restart
        await new Promise(r => setTimeout(r, 500));

        return this.start(name);
    }
```

### getStatus(name)

**Purpose**: Gets process status information

**Parameters**:
- `name` (string): Process name (optional, returns all if omitted)

**Returns**: (ProcessInfo|Object) Process info or map of all

**Implementation**:
```javascript
    getStatus(name) {
        if (name) {
            const entry = this.processes.get(name);
            if (!entry) return null;

            return {
                name: entry.config.name,
                state: entry.state,
                pid: entry.pid,
                startCount: entry.startCount,
                restartCount: entry.restartCount,
                lastStartTime: entry.lastStartTime,
                uptime: entry.state === ProcessState.RUNNING ? Date.now() - entry.lastStartTime : 0,
                healthFailures: entry.healthFailures,
                lastError: entry.lastError
            };
        }

        const statuses = {};
        for (const [processName, entry] of this.processes) {
            statuses[processName] = this.getStatus(processName);
        }
        return statuses;
    }
```

### resetCircuitBreaker(name)

**Purpose**: Manually resets circuit breaker

**Parameters**:
- `name` (string): Process name

**Implementation**:
```javascript
    resetCircuitBreaker(name) {
        const circuit = this.circuitBreakers.get(name);
        if (circuit) {
            circuit.isOpen = false;
            circuit.failures = [];
            circuit.openedAt = 0;
            appendLog(`[watchdog] Circuit breaker manually reset for ${name}`);
            this.emit('circuit_reset', { name });
        }

        const entry = this.processes.get(name);
        if (entry && entry.state === ProcessState.CIRCUIT_OPEN) {
            entry.state = ProcessState.STOPPED;
            entry.restartCount = 0;
            entry.backoffMs = INITIAL_BACKOFF_MS;
        }
    }
```

### startContainerMonitoring(agentsJsonPath)

**Purpose**: Starts container monitoring integration

**Parameters**:
- `agentsJsonPath` (string): Path to agents.json file

**Implementation**:
```javascript
    startContainerMonitoring(agentsJsonPath) {
        if (!this.options.enableContainerMonitoring) return;

        this.containerMonitor = new ContainerMonitor(agentsJsonPath, {
            onContainerExit: (containerName, exitCode) => {
                this.emit('container_exit', { containerName, exitCode });
            },
            onContainerRestart: (containerName) => {
                this.emit('container_restart', { containerName });
            },
            onContainerHealthFailed: (containerName) => {
                this.emit('container_health_failed', { containerName });
            }
        });

        this.containerMonitor.start();
        appendLog('[watchdog] Container monitoring started');
    }
```

### shutdown()

**Purpose**: Gracefully shuts down all managed processes

**Returns**: (Promise<void>)

**Implementation**:
```javascript
    async shutdown() {
        appendLog('[watchdog] Initiating shutdown');
        this.emit('shutdown');

        // Stop container monitoring
        if (this.containerMonitor) {
            this.containerMonitor.stop();
        }

        // Stop all health checks
        for (const name of this.healthCheckers.keys()) {
            this._stopHealthCheck(name);
        }

        // Stop all processes in parallel
        const stopPromises = [];
        for (const [name, entry] of this.processes) {
            if (entry.state === ProcessState.RUNNING) {
                // Disable auto-restart during shutdown
                entry.config.autoRestart = false;
                stopPromises.push(this.stop(name));
            }
        }

        await Promise.all(stopPromises);
        appendLog('[watchdog] All processes stopped');
    }
}
```

## Exports

```javascript
export { Watchdog, ProcessState };
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `registered` | `{ name }` | Process registered |
| `starting` | `{ name }` | Process starting |
| `started` | `{ name, pid }` | Process started |
| `exited` | `{ name, code, signal }` | Process exited |
| `stopped` | `{ name }` | Process stopped by request |
| `restarting` | `{ name }` | Process restarting |
| `error` | `{ name, error }` | Process error |
| `stdout` | `{ name, data }` | Process stdout data |
| `stderr` | `{ name, data }` | Process stderr data |
| `health_ok` | `{ name }` | Health check passed |
| `health_failed` | `{ name, failures, error }` | Health check failed |
| `circuit_open` | `{ name, failures }` | Circuit breaker opened |
| `circuit_reset` | `{ name }` | Circuit breaker reset |
| `max_restarts` | `{ name, restartCount }` | Max restarts reached |
| `shutdown` | - | Shutdown initiated |
| `container_exit` | `{ containerName, exitCode }` | Container exited |
| `container_restart` | `{ containerName }` | Container restarting |
| `container_health_failed` | `{ containerName }` | Container health failed |

## Usage Example

```javascript
import { Watchdog, ProcessState } from './Watchdog.js';

const watchdog = new Watchdog({
    enableContainerMonitoring: true,
    healthCheckInterval: 15000
});

// Register a server process
watchdog.register({
    name: 'web-server',
    command: 'node',
    args: ['server.js'],
    cwd: '/app',
    env: { PORT: '3000' },
    autoRestart: true,
    maxRestarts: 10,
    healthCheck: async (entry) => {
        try {
            const response = await fetch('http://localhost:3000/health');
            return response.ok;
        } catch {
            return false;
        }
    }
});

// Listen for events
watchdog.on('started', ({ name, pid }) => {
    console.log(`${name} started with PID ${pid}`);
});

watchdog.on('health_failed', ({ name, failures }) => {
    console.log(`${name} health check failed (${failures})`);
});

watchdog.on('circuit_open', ({ name }) => {
    console.log(`Circuit breaker opened for ${name}`);
});

// Start the process
await watchdog.start('web-server');

// Start container monitoring
watchdog.startContainerMonitoring('/workspace/.ploinky/agents.json');

// Get status
const status = watchdog.getStatus('web-server');
console.log(status);

// Graceful shutdown
process.on('SIGINT', async () => {
    await watchdog.shutdown();
    process.exit(0);
});
```

## Configuration Defaults

| Setting | Default | Description |
|---------|---------|-------------|
| Initial backoff | 1000ms | First restart delay |
| Max backoff | 30000ms | Maximum restart delay |
| Backoff multiplier | 2x | Delay increase per failure |
| Circuit threshold | 5 | Failures before circuit opens |
| Circuit window | 60000ms | Time window for failures |
| Health interval | 30000ms | Health check frequency |
| Health timeout | 5000ms | Health check timeout |
| Health threshold | 3 | Failures before restart |

## Related Modules

- [server-container-monitor.md](./server-container-monitor.md) - Container monitoring
- [docker-health-probes.md](../services/docker/docker-health-probes.md) - Health probes
- [service-utils.md](../services/utils/service-utils.md) - Utility functions
