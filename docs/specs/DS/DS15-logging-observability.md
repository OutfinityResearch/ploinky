# DS15 - Logging & Observability

## Summary

Ploinky provides structured JSON logging for the RoutingServer and Watchdog, CLI-accessible log commands for tailing and viewing logs, and memory/crash diagnostics. All log events are written to `logs/router.log` and `logs/watchdog.log` in JSON-lines format.

## Background / Problem Statement

Operating a multi-container system requires visibility into:
- Router request handling and lifecycle events
- Process crashes with stack traces and memory snapshots
- Watchdog restart decisions and health check results
- Boot and shutdown sequences
- Historical logs for debugging after-the-fact

## Goals

1. **Structured Logging**: JSON-lines format for machine-parseable logs
2. **Crash Diagnostics**: Capture stack trace, memory usage, and process metadata on crash
3. **CLI Access**: `logs tail` and `logs last` commands for live and historical viewing
4. **EPIPE Resilience**: Logging never crashes the server, even with broken stdout/stderr

## Non-Goals

- Log aggregation or forwarding (ELK, Splunk)
- Log rotation (handled by external tools)
- Request-level access logs (use reverse proxy for that)
- Metrics collection (Prometheus, StatsD)

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                      LOG WRITERS                            │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────┐           │
│  │  Watchdog.js     │    │  RoutingServer.js     │           │
│  │  (watchdog.log)  │    │  (router.log via      │           │
│  │                  │    │   logger.js)           │           │
│  └─────────────────┘    └──────────────────────┘           │
│          │                         │                        │
│          ▼                         ▼                        │
│  ┌─────────────────────────────────────────────────┐       │
│  │              logs/ directory                      │       │
│  │  watchdog.log    router.log                       │       │
│  └─────────────────────────────────────────────────┘       │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────┐       │
│  │           CLI Log Commands                        │       │
│  │  ploinky logs tail [kind]                         │       │
│  │  ploinky logs last [count] [kind]                 │       │
│  └─────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────┘
```

## Data Models

### Log Entry (router.log)

```json
{
  "ts": "2026-02-18T09:30:00.000Z",
  "level": "debug",
  "type": "boot_operation",
  "action": "server_starting",
  "port": 8080
}
```

### Crash Entry

```json
{
  "ts": "2026-02-18T09:31:00.000Z",
  "type": "crash",
  "level": "fatal",
  "errorType": "uncaught_exception",
  "message": "Cannot read property 'x' of null",
  "stack": "TypeError: Cannot read property...\n    at ...",
  "code": null,
  "pid": 12345,
  "uptime": 3600.5,
  "memoryUsage": {
    "rss": 104857600,
    "heapTotal": 67108864,
    "heapUsed": 52428800,
    "external": 1048576,
    "arrayBuffers": 524288
  }
}
```

### Shutdown Entry

```json
{
  "ts": "2026-02-18T09:32:00.000Z",
  "type": "shutdown",
  "level": "info",
  "reason": "SIGTERM received",
  "exitCode": 0,
  "pid": 12345,
  "uptime": 7200.0,
  "memoryUsage": { ... }
}
```

### Memory Usage Entry

```json
{
  "ts": "2026-02-18T09:33:00.000Z",
  "level": "debug",
  "type": "memory_usage",
  "rss": 104857600,
  "heapTotal": 67108864,
  "heapUsed": 52428800,
  "external": 1048576,
  "arrayBuffers": 524288,
  "rssMB": 100,
  "heapUsedMB": 50
}
```

### Watchdog Log Entry

```json
{
  "ts": "2026-02-18T09:34:00.000Z",
  "level": "warn",
  "event": "process_exited",
  "pid": 12346,
  "managerPid": 12340,
  "exitCode": 1,
  "signal": null,
  "uptime": 500,
  "uptimeSeconds": 0,
  "wasExpected": false
}
```

### Process Signal Entry

```json
{
  "ts": "2026-02-18T09:35:00.000Z",
  "level": "debug",
  "type": "process_signal",
  "action": "watchdog_shutdown",
  "pid": 12346,
  "signal": "SIGTERM",
  "reason": "watchdog_received_signal",
  "originalSignal": "SIGTERM",
  "source": "Watchdog.shutdownManager"
}
```

## API Contracts

### Logger (cli/server/utils/logger.js)

| Function | Description |
|----------|-------------|
| `appendLog(type, data)` | Append JSON log entry to `logs/router.log` |
| `logBootEvent(action, details)` | Log a boot/startup event (type: `boot_operation`) |
| `logCrash(errorType, error, additionalData)` | Log crash with stack, memory, pid, uptime |
| `logMemoryUsage()` | Log current memory usage snapshot |
| `logShutdown(reason, exitCode, additionalData)` | Log shutdown with reason and exit code |
| `LOG_DIR` | Resolved log directory path (`$CWD/logs`) |
| `LOG_PATH` | Router log file path (`$CWD/logs/router.log`) |

### Log Utilities (cli/services/logUtils.js)

| Function | Description |
|----------|-------------|
| `logsTail(kind)` | Follow log file with `tail -f` (falls back to polling watcher) |
| `showLast(count, kind)` | Show last N lines with `tail -n` (falls back to `fs.readFileSync`) |
| `getLogPath(kind)` | Resolve log file path by kind (currently only `router`) |

## Behavioral Specification

### Log Writing

```
appendLog(type, data):
├─ Ensure logs/ directory exists (mkdir -p)
├─ Build JSON record: { ts, level: 'debug', type, ...data }
├─ appendFileSync to logs/router.log
└─ On error: silently ignore (logging must never crash the server)
```

### Crash Logging (EPIPE-safe)

```
logCrash(errorType, error, additionalData):
├─ Check re-entrancy guard (prevent EPIPE recursion)
├─ Set isLoggingCrash = true
├─ Build crash details:
│   ├─ level: 'fatal'
│   ├─ errorType, message, stack, code
│   ├─ pid, uptime
│   └─ memoryUsage (rss, heap, external, arrayBuffers)
├─ Write to router.log
├─ Write to stderr via safeConsoleError() (catches EPIPE)
└─ Clear re-entrancy guard
```

### CLI Log Access

```
ploinky logs tail [router]
├─ Resolve log file path
├─ If file exists:
│   ├─ Try: spawn('tail', ['-f', file])
│   └─ Fallback: polling watcher (read new bytes every 1s)
└─ If not: print "No log file yet: <path>"

ploinky logs last [200] [router]
├─ Parse count (default 200, min 1)
├─ Resolve log file path
├─ If file exists:
│   ├─ Try: spawnSync('tail', ['-n', count, file])
│   └─ Fallback: read entire file, slice last N lines
└─ If not: print "No log file: <path>"
```

## Configuration

### Log Directory

All logs are written to `$CWD/logs/` where `$CWD` is the workspace directory. The directory is created automatically on first write.

### Log Types Reference

| Type | Writer | Description |
|------|--------|-------------|
| `boot_operation` | logger.js | Server startup events |
| `crash` | logger.js | Uncaught exceptions with diagnostics |
| `shutdown` | logger.js | Clean shutdown with reason |
| `memory_usage` | logger.js | Memory snapshot |
| `process_signal` | logger.js | Signal sent to processes (SIGTERM, SIGKILL) |
| Watchdog events | Watchdog.js | Uses own structured format with `event` field |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Log directory doesn't exist | Auto-create with `mkdir -p` |
| Log write fails | Silently ignore; server continues |
| EPIPE on stderr during crash log | Catch and suppress; no recursion |
| `tail` command not available | Fallback to polling file watcher |
| Log file doesn't exist yet | Display informative message |

## Security Considerations

- **No Secrets in Logs**: Log entries should not contain API keys or tokens
- **File Permissions**: Log files inherit process umask; no special permissions set
- **Crash Memory Data**: Memory usage numbers only (no heap dumps or core dumps)
- **EPIPE Safety**: All console writes wrapped in try-catch to prevent crash cascades

## Success Criteria

1. All RoutingServer lifecycle events logged in JSON format
2. Crashes captured with full stack trace and memory snapshot
3. CLI provides `logs tail` and `logs last` for interactive debugging
4. Logging failures never crash the server
5. EPIPE errors handled gracefully without recursion

## References

- [DS02 - Architecture](./DS02-architecture.md) - Router startup and lifecycle
- [DS13 - Watchdog & Reliability](./DS13-watchdog-reliability.md) - Watchdog logging and process management
