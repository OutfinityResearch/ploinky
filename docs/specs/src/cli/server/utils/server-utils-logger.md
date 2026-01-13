# cli/server/utils/logger.js - Server Logger

## Overview

Provides structured JSON logging for the router server with crash handling, memory usage tracking, and shutdown logging. Includes safe error handling to prevent EPIPE recursion.

## Source File

`cli/server/utils/logger.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
```

## Constants

```javascript
// Log directory and file paths
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_PATH = path.join(LOG_DIR, 'router.log');

// Crash logging flag (prevents EPIPE recursion)
let isLoggingCrash = false;
```

## Internal Functions

### ensureLogDirectory()

**Purpose**: Creates the log directory if it doesn't exist

**Implementation**:
```javascript
function ensureLogDirectory() {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) {
        // Ignore logging directory errors to avoid crashing the server.
    }
}
```

### safeConsoleError(...args)

**Purpose**: Safely writes to stderr (catches EPIPE errors)

**Parameters**:
- `args` (...any): Arguments to log

**Implementation**:
```javascript
function safeConsoleError(...args) {
    try {
        console.error(...args);
    } catch (err) {
        // Ignore EPIPE and other write errors - stderr may be broken
        // This prevents EPIPE from triggering another uncaughtException
    }
}
```

## Public API

### appendLog(type, data)

**Purpose**: Appends a log entry to the router log file

**Parameters**:
- `type` (string): Log entry type
- `data` (Object): Additional data to log

**Log Format**:
```json
{
    "ts": "2024-01-15T10:30:00.000Z",
    "level": "debug",
    "type": "request",
    "method": "GET",
    "path": "/health"
}
```

**Implementation**:
```javascript
export function appendLog(type, data = {}) {
    try {
        ensureLogDirectory();
        const record = JSON.stringify({
            ts: new Date().toISOString(),
            level: 'debug',
            type,
            ...data
        });
        fs.appendFileSync(LOG_PATH, `${record}\n`);
    } catch (_) {
        // Ignore logging failures; diagnostics should not interrupt routing.
    }
}
```

### logBootEvent(action, details)

**Purpose**: Logs a boot/startup event

**Parameters**:
- `action` (string): Boot action name
- `details` (Object): Additional details

**Implementation**:
```javascript
export function logBootEvent(action, details = {}) {
    appendLog('boot_operation', { action, ...details });
}
```

### logCrash(errorType, error, additionalData)

**Purpose**: Logs crash/fatal error with protection against recursion

**Parameters**:
- `errorType` (string): Type of error (e.g., 'uncaughtException')
- `error` (Error): Error object
- `additionalData` (Object): Additional context

**Logged Data**:
- Error message and stack trace
- Error code
- Process ID
- Uptime
- Memory usage

**Implementation**:
```javascript
export function logCrash(errorType, error, additionalData = {}) {
    // Prevent recursion: if we're already logging a crash and get another
    // error (like EPIPE), just bail out silently
    if (isLoggingCrash) {
        return;
    }
    isLoggingCrash = true;

    try {
        const errorDetails = {
            level: 'fatal',
            errorType,
            message: error?.message || String(error),
            stack: error?.stack || null,
            code: error?.code || null,
            pid: process.pid,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            ...additionalData
        };

        try {
            ensureLogDirectory();
            const record = JSON.stringify({
                ts: new Date().toISOString(),
                type: 'crash',
                ...errorDetails
            });
            fs.appendFileSync(LOG_PATH, `${record}\n`);

            // Also write to stderr for immediate visibility (safely)
            safeConsoleError(`[CRASH] ${errorType}:`, error?.message || String(error));
            if (error?.stack) {
                safeConsoleError(error.stack);
            }
        } catch (_) {
            // Last resort: try to write to stderr (safely)
            safeConsoleError('[CRASH] Failed to log crash:', errorType, error);
        }
    } finally {
        isLoggingCrash = false;
    }
}
```

### logMemoryUsage()

**Purpose**: Logs current memory usage statistics

**Logged Metrics**:
- `rss` - Resident Set Size (bytes)
- `heapTotal` - Total heap size (bytes)
- `heapUsed` - Used heap size (bytes)
- `external` - External memory (bytes)
- `arrayBuffers` - ArrayBuffer memory (bytes)
- `rssMB` - RSS in megabytes
- `heapUsedMB` - Heap used in megabytes

**Implementation**:
```javascript
export function logMemoryUsage() {
    const usage = process.memoryUsage();
    appendLog('memory_usage', {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
        rssMB: Math.round(usage.rss / 1024 / 1024),
        heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024)
    });
}
```

### logShutdown(reason, exitCode, additionalData)

**Purpose**: Logs server shutdown event

**Parameters**:
- `reason` (string): Shutdown reason
- `exitCode` (number): Exit code (default: 0)
- `additionalData` (Object): Additional context

**Implementation**:
```javascript
export function logShutdown(reason, exitCode = 0, additionalData = {}) {
    const shutdownDetails = {
        level: exitCode === 0 ? 'info' : 'error',
        reason,
        exitCode,
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        ...additionalData
    };

    try {
        ensureLogDirectory();
        const record = JSON.stringify({
            ts: new Date().toISOString(),
            type: 'shutdown',
            ...shutdownDetails
        });
        fs.appendFileSync(LOG_PATH, `${record}\n`);
        console.log(`[SHUTDOWN] ${reason} (exit code: ${exitCode})`);
    } catch (_) {
        console.error('[SHUTDOWN] Failed to log shutdown:', reason);
    }
}
```

## Exports

```javascript
export {
    appendLog,
    logBootEvent,
    logCrash,
    logMemoryUsage,
    logShutdown,
    LOG_DIR,
    LOG_PATH
};
```

## Log Entry Types

| Type | Description |
|------|-------------|
| `boot_operation` | Server startup events |
| `memory_usage` | Memory statistics |
| `crash` | Fatal errors |
| `shutdown` | Server shutdown |
| Custom | Application-specific events |

## Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Normal operations |
| `info` | Informational events |
| `error` | Error conditions |
| `fatal` | Crash/fatal errors |

## Usage Example

```javascript
import { appendLog, logCrash, logShutdown, logMemoryUsage } from './logger.js';

// Log a request
appendLog('request', {
    method: 'GET',
    path: '/api/agents',
    status: 200,
    duration: 45
});

// Log memory periodically
setInterval(logMemoryUsage, 60000);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logCrash('uncaughtException', error);
    process.exit(1);
});

// Log graceful shutdown
process.on('SIGTERM', () => {
    logShutdown('SIGTERM received', 0);
    process.exit(0);
});
```

## Log File Location

```
logs/router.log
```

## Sample Log Output

```json
{"ts":"2024-01-15T10:30:00.000Z","level":"debug","type":"boot_operation","action":"server_start","port":8080}
{"ts":"2024-01-15T10:30:01.000Z","level":"debug","type":"request","method":"GET","path":"/health","status":200}
{"ts":"2024-01-15T10:31:00.000Z","level":"debug","type":"memory_usage","rss":52428800,"heapUsed":25165824,"rssMB":50,"heapUsedMB":24}
{"ts":"2024-01-15T11:00:00.000Z","level":"info","type":"shutdown","reason":"SIGTERM received","exitCode":0,"uptime":1800}
```

## Related Modules

- [server-routing-server.md](../server-routing-server.md) - Uses logger
- [server-watchdog.md](../server-watchdog.md) - Crash handling
- [service-log-utils.md](../../services/utils/service-log-utils.md) - Log viewing
