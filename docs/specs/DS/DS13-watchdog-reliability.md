# DS13 - Watchdog & Process Reliability

## Summary

Ploinky uses a multi-layer reliability system to keep the Router Server and agent containers running. The Watchdog process manager supervises the RoutingServer, while the Container Monitor tracks individual agent containers. Both use exponential backoff, circuit breaker patterns, and health checks to provide automatic recovery without restart storms.

## Background / Problem Statement

Long-running services need resilience:
- The RoutingServer may crash due to uncaught exceptions, OOM, or external signals
- Agent containers may exit unexpectedly (OOM-killed, process crash, dependency failure)
- Naive restart loops can cause "restart storms" consuming resources
- Health checks must detect unresponsive processes (alive but not serving)
- Container liveness/readiness probes need CrashLoopBackOff semantics

## Goals

1. **Automatic Recovery**: Restart crashed RoutingServer and agent containers without manual intervention
2. **Backoff & Circuit Breaker**: Prevent restart storms with exponential backoff and circuit breaker
3. **Health Monitoring**: Detect unresponsive processes via HTTP health checks and container probes
4. **Graceful Shutdown**: Forward signals cleanly through the process tree
5. **Observability**: Structured JSON logging for all reliability events

## Non-Goals

- High-availability clustering (single-host only)
- External monitoring integration (Prometheus, Datadog)
- Custom health check protocols beyond HTTP and shell scripts

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        WATCHDOG                              │
│  ┌─────────────────────────────────┐                        │
│  │      Process Manager            │                        │
│  │  - Spawns RoutingServer         │                        │
│  │  - Exponential backoff          │                        │
│  │  - Circuit breaker              │                        │
│  │  - Health check polling         │                        │
│  └────────────┬────────────────────┘                        │
│               │ spawn                                        │
│               ▼                                              │
│  ┌─────────────────────────────────┐                        │
│  │      RoutingServer.js           │                        │
│  │  - HTTP server (port 8080)      │                        │
│  │  - /health endpoint             │                        │
│  └─────────────────────────────────┘                        │
│                                                              │
│  ┌─────────────────────────────────┐                        │
│  │    Container Monitor            │                        │
│  │  - Polls container status       │                        │
│  │  - Per-container backoff        │                        │
│  │  - Per-container circuit breaker│                        │
│  │  - Probe worker threads         │                        │
│  └────────────┬────────────────────┘                        │
│               │ worker_threads                               │
│               ▼                                              │
│  ┌─────────────────────────────────┐                        │
│  │      Probe Workers              │                        │
│  │  - Liveness probes              │                        │
│  │  - Readiness probes             │                        │
│  │  - CrashLoopBackOff             │                        │
│  └─────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Data Models

### Watchdog Configuration

```javascript
const CONFIG = {
  SERVER_SCRIPT: 'cli/server/RoutingServer.js',
  LOG_DIR: '$CWD/logs',
  PROCESS_LOG: '$CWD/logs/watchdog.log',

  // Restart limits
  MAX_RESTARTS_IN_WINDOW: 5,     // Max restarts in time window
  RESTART_WINDOW_MS: 60000,      // 60-second window
  INITIAL_BACKOFF_MS: 1000,      // Start at 1 second
  MAX_BACKOFF_MS: 30000,         // Cap at 30 seconds
  BACKOFF_MULTIPLIER: 2,         // Double each time

  // Health checks
  HEALTH_CHECK_ENABLED: true,    // Env: HEALTH_CHECK_ENABLED
  HEALTH_CHECK_INTERVAL_MS: 30000,
  HEALTH_CHECK_TIMEOUT_MS: 5000,
  HEALTH_CHECK_FAILURES_THRESHOLD: 3,

  // Container monitoring
  CONTAINER_CHECK_INTERVAL_MS: 5000,

  // Server
  PORT: 8080                     // Env: PORT
};
```

### Watchdog State

```javascript
const state = {
  childProcess: null,          // Current RoutingServer process
  restartHistory: [],          // Timestamps of recent restarts
  consecutiveFailures: 0,      // Sequential crash count
  currentBackoff: 1000,        // Current backoff delay (ms)
  isShuttingDown: false,       // Graceful shutdown in progress
  healthCheckFailures: 0,      // Sequential health check failures
  healthCheckTimer: null,      // Health check interval handle
  totalRestarts: 0,            // Lifetime restart count
  lastStartTime: null,         // Last spawn timestamp
  circuitBreakerTripped: false,// Circuit breaker state
  containerMonitor: null,      // Container monitor instance
  pendingHealthCheckRestart: false // Health-check-initiated kill
};
```

### Container Monitor Target

```javascript
{
  containerName: string,       // Docker container name
  agentName: string,           // Agent identifier
  repoName: string,            // Repository name
  type: 'agent',               // Only 'agent' type monitored
  manifestPath: string,        // Path to manifest.json
  restartHistory: [],          // Per-container restart timestamps
  totalRestarts: 0,
  currentBackoff: 1000,
  isRestarting: false,
  pendingRestartTimer: null,
  lastStartTime: null,
  lastSeenRunningAt: null,
  circuitBreakerTripped: false,
  lastError: null,
  probeState: 'pending',       // 'pending' | 'running' | 'success' | 'failed'
  probeWorker: null             // Worker thread reference
}
```

### Health Probe Configuration (from manifest.json)

```javascript
// manifest.json health section
{
  "health": {
    "liveness": {
      "script": "liveness.sh",        // Script in agent /code/ directory
      "interval": 1,                  // Seconds between checks (default: 1)
      "timeout": 5,                   // Max seconds per check (default: 5)
      "failureThreshold": 5,          // Failures before restart (default: 5)
      "successThreshold": 1           // Successes before healthy (default: 1)
    },
    "readiness": {
      "script": "readiness.sh",
      "interval": 1,
      "timeout": 5,
      "failureThreshold": 5,
      "successThreshold": 1
    }
  }
}
```

## API Contracts

### Watchdog (cli/server/Watchdog.js)

| Export | Description |
|--------|-------------|
| `CONFIG` | Watchdog configuration constants |
| `state` | Current watchdog state (for testing) |
| `resetManagerState()` | Reset all state to initial values |
| `determineShouldRestart(code, signal)` | Decide if process should restart based on exit conditions |
| `calculateBackoff()` | Get next backoff delay, advance to next level |
| `resetBackoff()` | Reset backoff to initial value |
| `cleanRestartHistory()` | Remove expired entries from restart history |
| `checkCircuitBreaker()` | Check if circuit breaker should trip |

### Container Monitor (cli/server/containerMonitor.js)

| Export | Description |
|--------|-------------|
| `createContainerMonitor({config, log, isShuttingDown})` | Create monitor instance |
| `startContainerMonitor(monitor)` | Begin polling containers |
| `stopContainerMonitor(monitor)` | Stop polling and cleanup |
| `clearContainerTargets(monitor)` | Stop and clear all tracked containers |

### Health Probes (cli/services/docker/healthProbes.js)

| Export | Description |
|--------|-------------|
| `runHealthProbes(agentName, containerName, manifest)` | Run liveness then readiness probes |
| `clearLivenessState(containerName)` | Clear CrashLoopBackOff state |

### Probe Worker (cli/server/probeWorker.js)

Runs in a worker thread. Receives `workerData` with `{agentName, containerName, manifest}` and posts `{status: 'success'}` or `{status: 'error', error: string}` back to the parent.

## Behavioral Specification

### Watchdog Restart Decision Tree

```
Process exits with (code, signal)
│
├─ pendingHealthCheckRestart = true?
│   └─ YES → Always restart (Watchdog killed it)
│
├─ code === 0 (clean exit)?
│   └─ NO restart
│
├─ code === 2 (port conflict / permission)?
│   └─ NO restart (configuration error)
│
├─ code >= 100 (fatal)?
│   └─ NO restart (manual intervention)
│
├─ signal === SIGTERM or SIGINT?
│   └─ NO restart (intentional shutdown)
│
└─ All other exits → RESTART
    │
    ├─ Record restart timestamp
    ├─ Increment consecutiveFailures
    ├─ Check circuit breaker (5 restarts in 60s)
    │   └─ Tripped → exit(100), manual intervention
    │
    ├─ Calculate backoff: min(current * 2, 30000ms)
    └─ Schedule restart after backoff delay
```

### Backoff Reset Logic

- If the RoutingServer runs for > 60 seconds before crashing, backoff and failure counters are reset
- This prevents a single transient crash from permanently escalating the backoff

### Health Check Flow

```
Every 30 seconds:
│
├─ GET http://127.0.0.1:PORT/health
│   ├─ Response 200 + {"status":"healthy"}
│   │   └─ Reset healthCheckFailures to 0
│   │
│   └─ Timeout (5s) or non-200 or non-healthy
│       ├─ Increment healthCheckFailures
│       └─ If failures >= 3:
│           ├─ Set pendingHealthCheckRestart = true
│           └─ Kill child with SIGTERM
│               └─ handleProcessExit will restart
```

### Container Monitor Tick

```
Every 5 seconds:
│
├─ syncManagedContainers():
│   ├─ Load agents.json
│   ├─ For each agent record with type='agent':
│   │   ├─ Verify manifest.json exists
│   │   └─ Add/update target in targets Map
│   └─ Remove targets not in agents.json
│
└─ For each target:
    ├─ Skip if circuitBreakerTripped or isRestarting
    │
    ├─ Check: isContainerRunning(containerName)?
    │   ├─ YES:
    │   │   ├─ Update lastSeenRunningAt
    │   │   ├─ If running > 60s, reset backoff
    │   │   └─ Start probe worker if not already running
    │   │
    │   └─ NO:
    │       └─ scheduleContainerRestart(target, 'not_running')
    │           ├─ Check circuit breaker (5 in 60s)
    │           ├─ Calculate per-container backoff
    │           └─ After backoff: ensureAgentService() to recreate
```

### Liveness Probe with CrashLoopBackOff

```
runHealthProbes(agentName, containerName, manifest):
│
├─ Wait for container running (up to 10s)
│
├─ ensureLiveness(probe):
│   ├─ Run probe script in container: cd /code && sh "./liveness.sh"
│   ├─ If success >= successThreshold → liveness confirmed
│   └─ If failures >= failureThreshold:
│       ├─ Restart container: docker restart <name>
│       ├─ Wait for running state (10s)
│       ├─ Increment retryCount
│       ├─ CrashLoopBackOff delay: 10s * 2^retries (max 5 min)
│       ├─ Reset after 10 min stable runtime
│       └─ Loop back to probe
│
└─ ensureReadiness(probe):
    ├─ Run probe script in container
    ├─ If success → readiness confirmed
    └─ If failure → warn (does not restart)
```

### Graceful Shutdown

```
Signal received (SIGINT, SIGTERM, SIGQUIT):
│
├─ Set isShuttingDown = true
├─ Stop health check monitoring
├─ Stop container monitor
│
├─ If child process exists:
│   ├─ Forward signal to child
│   └─ After 15s timeout:
│       ├─ Force kill with SIGKILL
│       └─ Exit after 1s
│
└─ If no child → exit(0)
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | RoutingServer listen port |
| `HEALTH_CHECK_ENABLED` | `true` | Enable/disable health checks (set to `'false'` to disable) |
| `NODE_OPTIONS` | `''` | Node.js runtime options |
| `DEBUG` | unset | Enable debug-level console logging |
| `PLOINKY_WATCHDOG_TEST_MODE` | unset | Set to `'1'` for test mode (no console/file output) |
| `CONTAINER_RUNTIME` | auto-detect | `docker` or `podman` |

### Log Files

| File | Writer | Format |
|------|--------|--------|
| `logs/watchdog.log` | Watchdog | JSON-lines |
| `logs/router.log` | RoutingServer (via logger.js) | JSON-lines |

### Probe Backoff Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BACKOFF_BASE_DELAY_MS` | 10,000 | Base liveness probe backoff (10s) |
| `BACKOFF_MAX_DELAY_MS` | 300,000 | Maximum backoff (5 min) |
| `BACKOFF_RESET_MS` | 600,000 | Reset backoff after stable runtime (10 min) |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| RoutingServer crashes (code 1) | Restart with exponential backoff |
| RoutingServer port conflict (code 2) | No restart, log configuration error |
| RoutingServer fatal (code >= 100) | No restart, log fatal error |
| Circuit breaker tripped | Exit with code 100, require manual intervention |
| Health check timeout | Count as failure, restart after 3 consecutive failures |
| EPIPE/EIO on stdout/stderr | Catch and continue running (broken pipe is non-fatal) |
| Container not running | Schedule restart with per-container backoff |
| Probe script missing in container | Trip container circuit breaker |
| Manifest parse error | Trip container circuit breaker |

## Security Considerations

- **Signal Propagation**: Watchdog forwards SIGTERM/SIGINT to child, preventing orphan processes
- **EPIPE Resilience**: Broken pipe errors don't crash the watchdog (survives detached terminal)
- **No Escalation**: Watchdog runs with same privileges as the user; no setuid
- **Probe Script Validation**: Script names cannot contain path separators or `..` (prevents directory traversal)
- **Environment Isolation**: `PLOINKY_ROUTER_PID_FILE` is not passed to child process

## Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Health check latency | < 5s | Configurable timeout |
| Container status poll | Every 5s | Lightweight `docker inspect` |
| Backoff range | 1s - 30s | Exponential with cap |
| Probe backoff range | 10s - 5min | CrashLoopBackOff |
| Force kill timeout | 15s | After SIGTERM |

## Success Criteria

1. RoutingServer automatically recovers from unexpected crashes
2. Circuit breaker prevents restart storms (max 5 restarts in 60s)
3. Unresponsive server detected within 90s (3 failures * 30s interval)
4. Agent containers automatically restarted when not running
5. Liveness probes trigger container restart with CrashLoopBackOff

## References

- [DS02 - Architecture](./DS02-architecture.md) - System layers and startup sequence
- [DS03 - Agent Model](./DS03-agent-model.md) - Agent lifecycle and health config
- [DS04 - Manifest Schema](./DS04-manifest-schema.md) - Health probe configuration in manifest
- [DS11 - Container Runtime](./DS11-container-runtime.md) - Container lifecycle operations
