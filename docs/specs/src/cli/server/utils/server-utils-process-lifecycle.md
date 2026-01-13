# cli/server/utils/processLifecycle.js - Process Lifecycle

## Overview

Manages server process lifecycle including PID file creation, graceful shutdown handling, signal management, and global error handling. Provides coordinated cleanup of WebChat sessions, SSE connections, and TTY processes during shutdown.

## Source File

`cli/server/utils/processLifecycle.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { appendLog, logCrash, logShutdown } from '../utils/logger.js';
```

## Constants

```javascript
const PID_FILE = process.env.PLOINKY_ROUTER_PID_FILE || null;
const GRACEFUL_SHUTDOWN_TIMEOUT = 10000; // 10 seconds
```

## Module State

```javascript
let isShuttingDown = false;
```

## Internal Functions

### ensurePidFile()

**Purpose**: Creates PID file for the server process

**Implementation**:
```javascript
function ensurePidFile() {
    if (!PID_FILE) return;
    try {
        fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
        fs.writeFileSync(PID_FILE, String(process.pid));
    } catch (_) { }
}
```

### clearPidFile()

**Purpose**: Removes PID file on shutdown

**Implementation**:
```javascript
function clearPidFile() {
    if (!PID_FILE) return;
    try {
        fs.unlinkSync(PID_FILE);
    } catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.warn(`Failed to remove router pid file: ${PID_FILE}`);
        }
    }
}
```

### resolveServerPort(server)

**Purpose**: Extracts port number from server address

**Parameters**:
- `server` (http.Server): HTTP server instance

**Returns**: (number|null) Port number or null

**Implementation**:
```javascript
function resolveServerPort(server) {
    try {
        const address = server.address();
        if (!address) return null;
        if (typeof address === 'object' && address !== null) {
            return address.port ?? null;
        }
        if (typeof address === 'string') {
            const parsed = Number.parseInt(address.split(':').pop(), 10);
            return Number.isNaN(parsed) ? null : parsed;
        }
        return null;
    } catch (_) {
        return null;
    }
}
```

### closeWebchatSessions(globalState)

**Purpose**: Closes all active WebChat sessions and their resources

**Parameters**:
- `globalState` (Object): Global state containing webchat sessions

**Implementation**:
```javascript
function closeWebchatSessions(globalState) {
    try {
        const webchat = globalState?.webchat;
        if (!webchat || !(webchat.sessions instanceof Map)) {
            return;
        }
        for (const [sid, session] of webchat.sessions.entries()) {
            if (!session || !(session.tabs instanceof Map)) {
                continue;
            }
            for (const [tabId, tab] of session.tabs.entries()) {
                if (!tab) {
                    continue;
                }
                try {
                    if (tab.sseRes) {
                        try { tab.sseRes.end(); } catch (_) { }
                        try { tab.sseRes.destroy?.(); } catch (_) { }
                    }
                } catch (_) { }
                try {
                    if (tab.tty) {
                        if (typeof tab.tty.dispose === 'function') {
                            tab.tty.dispose();
                        } else if (typeof tab.tty.kill === 'function') {
                            tab.tty.kill();
                        }
                    }
                } catch (_) { }
                session.tabs.delete(tabId);
            }
        }
    } catch (err) {
        console.error('[SHUTDOWN] Failed closing webchat sessions:', err?.message || err);
    }
}
```

### createGracefulShutdown(server, globalState, agentSessionStore)

**Purpose**: Creates graceful shutdown handler function

**Parameters**:
- `server` (http.Server): HTTP server instance
- `globalState` (Object): Global state object
- `agentSessionStore` (Map): Agent session storage

**Returns**: (Function) Shutdown handler function

**Implementation**:
```javascript
function createGracefulShutdown(server, globalState, agentSessionStore) {
    return function gracefulShutdown(signal, exitCode = 0) {
        if (isShuttingDown) {
            console.log('[SHUTDOWN] Already shutting down...');
            return;
        }
        isShuttingDown = true;

        const shutdownReason = signal ? `Signal: ${signal}` : 'Unknown';
        logShutdown(shutdownReason, exitCode, { signal });
        console.log(`[SHUTDOWN] Initiating graceful shutdown (${shutdownReason})...`);

        // Set forced exit timeout
        const forceExitTimer = setTimeout(() => {
            console.error('[SHUTDOWN] Forced exit after timeout');
            logShutdown('forced_exit_timeout', 1, { originalReason: shutdownReason });
            clearPidFile();
            process.exit(1);
        }, GRACEFUL_SHUTDOWN_TIMEOUT);

        // Attempt graceful shutdown
        closeWebchatSessions(globalState);
        server.close((err) => {
            clearTimeout(forceExitTimer);

            const resolvedPort = resolveServerPort(server);
            let port = resolvedPort;
            if (port == null) {
                const envPort = Number.parseInt(process.env.PORT || '', 10);
                port = Number.isNaN(envPort) ? null : envPort;
            }

            if (err) {
                console.error('[SHUTDOWN] Error during server close:', err.message);
                logShutdown('server_close_error', 1, { error: err.message, originalReason: shutdownReason });
            } else {
                console.log('[SHUTDOWN] Server closed successfully');
            }

            const stopPayload = {
                port: port ?? null,
                signal: signal || null,
                pid: process.pid,
                uptime: process.uptime()
            };
            appendLog('server_stop', stopPayload);

            // Clean up resources
            try {
                // Close all active sessions
                for (const [key, state] of Object.entries(globalState)) {
                    if (state.sessions instanceof Map) {
                        state.sessions.clear();
                    }
                }
                // Clear agent sessions
                agentSessionStore.clear();
            } catch (cleanupErr) {
                console.error('[SHUTDOWN] Error during cleanup:', cleanupErr.message);
            }

            clearPidFile();
            process.exit(exitCode);
        });

        // Stop accepting new connections immediately
        server.unref();
    };
}
```

## Public API

### setupProcessLifecycle(server, globalState, agentSessionStore)

**Purpose**: Sets up all process lifecycle handlers

**Parameters**:
- `server` (http.Server): HTTP server instance
- `globalState` (Object): Global state object
- `agentSessionStore` (Map): Agent session storage

**Returns**: (Object) Lifecycle control object

**Return Structure**:
```javascript
{
    gracefulShutdown: Function,  // Manual shutdown trigger
    isShuttingDown: Function     // Check shutdown state
}
```

**Implementation**:
```javascript
function setupProcessLifecycle(server, globalState, agentSessionStore) {
    ensurePidFile();

    const gracefulShutdown = createGracefulShutdown(server, globalState, agentSessionStore);

    // Exit handler
    process.on('exit', (code) => {
        clearPidFile();
        if (!isShuttingDown) {
            logShutdown('process_exit', code);
        }
    });

    // Signal handlers
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
        process.on(sig, () => {
            gracefulShutdown(sig, 0);
        });
    }

    // Global error handlers
    process.on('uncaughtException', (error, origin) => {
        // EPIPE/EIO errors occur when stdout/stderr is closed (e.g., watchdog killed).
        // Don't try to log these to console as it will cause more errors.
        // DON'T exit - the server can continue handling requests with broken stdout.
        if (error?.code === 'EPIPE' || error?.code === 'EIO') {
            try {
                appendLog('pipe_error', {
                    level: 'warn',
                    errorType: 'uncaughtException',
                    message: `${error.code} - stdout/stderr disconnected (continuing to run)`,
                    code: error.code,
                    origin,
                    pid: process.pid,
                    uptime: process.uptime()
                });
            } catch (_) { /* ignore */ }
            // Don't exit - server can still handle HTTP requests
            return;
        }

        logCrash('uncaughtException', error, { origin });
        try {
            console.error('[FATAL] Uncaught Exception:', error);
            console.error('Origin:', origin);
        } catch (_) { /* ignore EPIPE */ }
    });

    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logCrash('unhandledRejection', error, {
            reason: String(reason),
            promiseString: String(promise)
        });
        console.error('[FATAL] Unhandled Promise Rejection:', reason);
        console.error('Promise:', promise);

        // Exit with error code to trigger restart
        gracefulShutdown('unhandledRejection', 1);
    });

    process.on('warning', (warning) => {
        appendLog('process_warning', {
            name: warning.name,
            message: warning.message,
            stack: warning.stack
        });
        console.warn('[WARNING]', warning.name + ':', warning.message);
    });

    return {
        gracefulShutdown,
        isShuttingDown: () => isShuttingDown
    };
}
```

## Exports

```javascript
export {
    ensurePidFile,
    clearPidFile,
    setupProcessLifecycle
};
```

## Signal Handling

| Signal | Action |
|--------|--------|
| `SIGINT` | Graceful shutdown (exit code 0) |
| `SIGTERM` | Graceful shutdown (exit code 0) |
| `SIGQUIT` | Graceful shutdown (exit code 0) |

## Error Handling

| Error Type | Behavior |
|------------|----------|
| `EPIPE` / `EIO` | Log to file, continue running |
| `uncaughtException` | Log crash, continue running |
| `unhandledRejection` | Log crash, trigger shutdown |
| `warning` | Log and display |

## Shutdown Sequence

```
┌────────────────────────────────────────────────────────────┐
│                    Shutdown Sequence                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Signal received (SIGINT/SIGTERM/SIGQUIT)               │
│     │                                                      │
│  2. Set isShuttingDown = true                              │
│     │                                                      │
│  3. Log shutdown reason                                    │
│     │                                                      │
│  4. Start forced exit timer (10 seconds)                   │
│     │                                                      │
│  5. Close all WebChat sessions                             │
│     ├── End SSE responses                                  │
│     ├── Destroy SSE connections                            │
│     └── Kill/dispose TTY processes                         │
│     │                                                      │
│  6. Close HTTP server (server.close())                     │
│     │                                                      │
│  7. Clear forced exit timer                                │
│     │                                                      │
│  8. Log server_stop event                                  │
│     │                                                      │
│  9. Clear all session maps                                 │
│     │                                                      │
│ 10. Clear PID file                                         │
│     │                                                      │
│ 11. process.exit(exitCode)                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLOINKY_ROUTER_PID_FILE` | `null` | Path to PID file |
| `PORT` | - | Fallback port for logging |

## Usage Example

```javascript
import { setupProcessLifecycle } from './processLifecycle.js';
import http from 'http';

const server = http.createServer(app);
const globalState = {
    webchat: { sessions: new Map() },
    webtty: { sessions: new Map() }
};
const agentSessionStore = new Map();

const lifecycle = setupProcessLifecycle(server, globalState, agentSessionStore);

// Manual shutdown
lifecycle.gracefulShutdown('manual', 0);

// Check state
if (lifecycle.isShuttingDown()) {
    console.log('Server is shutting down');
}
```

## Related Modules

- [server-utils-logger.md](./server-utils-logger.md) - Logging functions
- [server-watchdog.md](../server-watchdog.md) - Process manager
- [server-routing-server.md](../server-routing-server.md) - Main server

