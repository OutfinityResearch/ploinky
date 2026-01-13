# cli/server/probeWorker.js - Probe Worker

## Overview

Worker thread module that executes health probes for agent containers. Runs in a separate thread to avoid blocking the main event loop during health check operations.

## Source File

`cli/server/probeWorker.js`

## Dependencies

```javascript
import { parentPort, workerData } from 'worker_threads';
import { runHealthProbes } from '../services/docker/healthProbes.js';
```

## Worker Data

The worker expects the following data passed via `workerData`:

```javascript
/**
 * @typedef {Object} WorkerData
 * @property {string} agentName - Agent identifier
 * @property {string} containerName - Container name
 * @property {Object} manifest - Agent manifest (optional)
 */
```

## Message Protocol

### Input Messages (from parent)

| Type | Description |
|------|-------------|
| `terminate` | Gracefully terminate the worker |

### Output Messages (to parent)

| Status | Description | Payload |
|--------|-------------|---------|
| `success` | Health probes completed successfully | `{ status: 'success' }` |
| `error` | Health probes failed | `{ status: 'error', error: string }` |

## Implementation

### Main Function

**Purpose**: Executes health probes for the specified agent container

**Implementation**:
```javascript
async function main() {
    const { agentName, containerName, manifest } = workerData || {};

    // Validate required data
    if (!agentName || !containerName) {
        parentPort?.postMessage({
            status: 'error',
            error: 'Missing agent/container data for probe worker.'
        });
        return;
    }

    try {
        // Run health probes (liveness, readiness)
        runHealthProbes(agentName, containerName, manifest || {});
        parentPort?.postMessage({ status: 'success' });
    } catch (error) {
        parentPort?.postMessage({
            status: 'error',
            error: error?.message || String(error || 'unknown error')
        });
    }
}
```

### Termination Handler

**Purpose**: Handles graceful termination requests from parent

**Implementation**:
```javascript
if (parentPort) {
    parentPort.on('message', (msg) => {
        if (msg && msg.type === 'terminate') {
            process.exit(0);
        }
    });
}

await main();
```

## Worker Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     Probe Worker Lifecycle                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Parent Thread              Worker Thread                       │
│       │                          │                              │
│       │── new Worker(data) ─────►│                              │
│       │                          │── main()                     │
│       │                          │   ├── validate workerData    │
│       │                          │   ├── runHealthProbes()      │
│       │                          │   │   ├── liveness probe     │
│       │                          │   │   └── readiness probe    │
│       │                          │   └── postMessage(result)    │
│       │◄── { status: 'success' }─│                              │
│       │                          │                              │
│       │── { type: 'terminate' } ─►│                              │
│       │                          │── process.exit(0)            │
│       │                          ▼                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { Worker } from 'worker_threads';
import path from 'path';

// Create probe worker
const worker = new Worker(path.resolve('cli/server/probeWorker.js'), {
    workerData: {
        agentName: 'node-dev',
        containerName: 'ploinky_basic_node-dev_proj_abc',
        manifest: {
            liveness: { cmd: '/health', interval: 30000 },
            readiness: { cmd: '/ready', interval: 10000 }
        }
    }
});

// Handle worker messages
worker.on('message', (msg) => {
    if (msg.status === 'success') {
        console.log('Health probes completed successfully');
    } else if (msg.status === 'error') {
        console.error('Health probe error:', msg.error);
    }
});

// Handle worker errors
worker.on('error', (err) => {
    console.error('Worker error:', err);
});

// Handle worker exit
worker.on('exit', (code) => {
    console.log(`Worker exited with code ${code}`);
});

// Terminate worker when done
setTimeout(() => {
    worker.postMessage({ type: 'terminate' });
}, 60000);
```

## Integration with Container Monitor

The probe worker is typically spawned by the container monitor or watchdog:

```javascript
import { Worker } from 'worker_threads';

class ContainerMonitor {
    startProbeWorker(agentName, containerName, manifest) {
        const worker = new Worker('./probeWorker.js', {
            workerData: { agentName, containerName, manifest }
        });

        worker.on('message', (msg) => {
            if (msg.status === 'error') {
                this.handleProbeFailure(agentName, msg.error);
            }
        });

        return worker;
    }
}
```

## Error Handling

The worker handles errors at multiple levels:

1. **Missing data**: Returns error if `agentName` or `containerName` not provided
2. **Probe execution**: Catches exceptions from `runHealthProbes` and reports via message
3. **Termination**: Gracefully exits on terminate message

## Related Modules

- [docker-health-probes.md](../services/docker/docker-health-probes.md) - Health probe implementation
- [server-container-monitor.md](./server-container-monitor.md) - Uses probe workers
- [server-watchdog.md](./server-watchdog.md) - Process management
