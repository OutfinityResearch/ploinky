# cli/commands/sessionControl.js - Session Control Commands

## Overview

Provides session lifecycle management including container cleanup, router shutdown, and workspace destruction. Handles graceful shutdown and cleanup of Ploinky resources.

## Source File

`cli/commands/sessionControl.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { appendLog } from '../server/utils/logger.js';
import {
    addSessionContainer,
    cleanupSessionSet,
    destroyWorkspaceContainers
} from '../services/docker/index.js';
import { debugLog } from '../services/utils.js';
```

## Public API

### registerSessionContainer(name)

**Purpose**: Registers a container for session tracking

**Parameters**:
- `name` (string): Container name

**Implementation**:
```javascript
export function registerSessionContainer(name) {
    try { addSessionContainer(name); } catch (_) { }
}
```

### cleanupSessionContainers()

**Purpose**: Cleans up all containers registered to the current session

**Implementation**:
```javascript
export function cleanupSessionContainers() {
    try { cleanupSessionSet(); } catch (_) { }
}
```

### killRouterIfRunning()

**Purpose**: Stops the router server process if it's running

**Behavior**:
1. Reads port from `.ploinky/routing.json`
2. Tries to kill using PID from `.ploinky/running/router.pid`
3. Falls back to finding process by port using `lsof` or `ss`
4. Uses SIGTERM first, then SIGKILL if needed

**Implementation**:
```javascript
export function killRouterIfRunning() {
    try {
        const pidFile = path.resolve('.ploinky/running/router.pid');
        let stopped = false;
        let port = 8080;

        // Read port from routing config
        try {
            const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
            if (routing.port) port = parseInt(routing.port, 10) || port;
        } catch (_) { }

        const logRouterStop = (pid, signal, source) => {
            try {
                appendLog('server_stop', { pid, signal, source, port });
            } catch (_) { }
        };

        // Try PID file first
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
            if (pid && !Number.isNaN(pid)) {
                try {
                    process.kill(pid, 'SIGTERM');
                    logRouterStop(pid, 'SIGTERM', 'pid_file');
                    console.log(`Stopped Router (pid ${pid}).`);
                    stopped = true;
                } catch (_) { }
            }
            try { fs.unlinkSync(pidFile); } catch (_) { }
        }

        // Fall back to port scanning
        if (!stopped) {
            const tryKill = (pid) => {
                if (!pid) return false;
                try {
                    process.kill(pid, 'SIGTERM');
                    logRouterStop(pid, 'SIGTERM', 'port_scan');
                    console.log(`Stopped Router (port ${port}, pid ${pid}).`);
                    return true;
                } catch (_) { return false; }
            };

            const findPids = () => {
                const pids = new Set();
                // Try lsof first
                try {
                    const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN`, { stdio: 'pipe' }).toString();
                    out.split(/\s+/).filter(Boolean).forEach(x => {
                        const n = parseInt(x, 10);
                        if (!Number.isNaN(n)) pids.add(n);
                    });
                } catch (_) { }

                // Fall back to ss
                if (!pids.size) {
                    try {
                        const out = execSync('ss -ltnp', { stdio: 'pipe' }).toString();
                        out.split(/\n+/).forEach(line => {
                            if (line.includes(`:${port}`) && line.includes('pid=')) {
                                const m = line.match(/pid=(\d+)/);
                                if (m) {
                                    const n = parseInt(m[1], 10);
                                    if (!Number.isNaN(n)) pids.add(n);
                                }
                            }
                        });
                    } catch (_) { }
                }
                return Array.from(pids);
            };

            const pids = findPids();
            for (const pid of pids) {
                if (tryKill(pid)) { stopped = true; }
            }

            // Force kill if SIGTERM failed
            if (!stopped && pids.length) {
                for (const pid of pids) {
                    try {
                        process.kill(pid, 'SIGKILL');
                        logRouterStop(pid, 'SIGKILL', 'port_scan');
                        console.log(`Killed Router (pid ${pid}).`);
                        stopped = true;
                    } catch (_) { }
                }
            }
        }
    } catch (_) { }
}
```

### destroyAll()

**Purpose**: Destroys all containers in the current workspace

**Async**: Yes

**Implementation**:
```javascript
export async function destroyAll() {
    try {
        const list = destroyWorkspaceContainers({ fast: true });
        if (list.length) {
            console.log('Removed containers:');
            list.forEach(n => console.log(` - ${n}`));
        }
        console.log(`Destroyed ${list.length} containers from this workspace.`);
    }
    catch (e) { console.error('Destroy failed:', e.message); }
}
```

### shutdownSession()

**Purpose**: Performs graceful shutdown of session containers

**Async**: Yes

**Implementation**:
```javascript
export async function shutdownSession() {
    try { cleanupSessionContainers(); } catch (e) { debugLog('shutdown error:', e.message); }
    console.log('Shutdown completed for current session containers.');
}
```

## Exports

```javascript
export {
    registerSessionContainer,
    cleanupSessionContainers,
    killRouterIfRunning,
    destroyAll,
    shutdownSession,
};
```

## File Locations

| File | Purpose |
|------|---------|
| `.ploinky/running/router.pid` | Router process ID |
| `.ploinky/routing.json` | Router configuration including port |

## Usage Example

```javascript
import {
    registerSessionContainer,
    killRouterIfRunning,
    destroyAll,
    shutdownSession
} from './sessionControl.js';

// Register a container for tracking
registerSessionContainer('ploinky_basic_node-dev_myproject_abc123');

// Stop the router
killRouterIfRunning();

// Destroy all workspace containers
await destroyAll();

// Graceful session shutdown
await shutdownSession();
```

## Related Modules

- [docker-container-fleet.md](../services/docker/docker-container-fleet.md) - Container operations
- [server-utils-logger.md](../server/utils/server-utils-logger.md) - Logging
- [service-utils.md](../services/utils/service-utils.md) - Debug logging
