# cli/services/logUtils.js - Log Utilities

## Overview

Provides log file viewing and tailing functionality for Ploinky services. Supports both native `tail` command and fallback file watching for environments without Unix utilities.

## Source File

`cli/services/logUtils.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
```

## Constants

```javascript
// Log file base directory
const LOG_BASE_PATH = path.resolve('logs');

// Log file mappings
const LOG_FILE_MAP = {
    router: 'router.log'
};
```

## Public API

### getLogPath(kind)

**Purpose**: Gets the full path to a log file

**Parameters**:
- `kind` (string): Log type ('router', etc.)

**Returns**: (string) Full path to log file

**Implementation**:
```javascript
export function getLogPath(kind) {
    const base = path.resolve('logs');
    const map = { router: 'router.log' };
    const file = map[kind] || map.router;
    return path.join(base, file);
}
```

### logsTail(kind)

**Purpose**: Follows a log file in real-time (like `tail -f`)

**Parameters**:
- `kind` (string): Log type to tail

**Behavior**:
1. Attempts to use native `tail -f` command
2. Falls back to custom file watcher if `tail` unavailable
3. Outputs new content to stdout as it arrives
4. Runs until interrupted (Ctrl+C)

**Implementation**:
```javascript
export async function logsTail(kind) {
    const file = getLogPath(kind);
    if (!fs.existsSync(file)) {
        console.log(`No log file yet: ${file}`);
        return;
    }
    try {
        const proc = spawn('tail', ['-f', file], { stdio: 'inherit' });
        await new Promise(resolve => proc.on('exit', resolve));
    } catch (_) {
        console.log(`Following ${file} (fallback watcher). Stop with Ctrl+C.`);
        let pos = fs.statSync(file).size;
        const fd = fs.openSync(file, 'r');
        const loop = () => {
            try {
                const st = fs.statSync(file);
                if (st.size > pos) {
                    const len = st.size - pos;
                    const buf = Buffer.alloc(len);
                    fs.readSync(fd, buf, 0, len, pos);
                    process.stdout.write(buf.toString('utf8'));
                    pos = st.size;
                }
            } catch (_) {}
            setTimeout(loop, 1000);
        };
        loop();
    }
}
```

### showLast(count, kind)

**Purpose**: Shows the last N lines of a log file

**Parameters**:
- `count` (string|number): Number of lines to show (default: 200)
- `kind` (string): Log type (default: 'router')

**Behavior**:
1. Attempts to use native `tail -n` command
2. Falls back to reading file and slicing last N lines

**Implementation**:
```javascript
export function showLast(count, kind) {
    const n = Math.max(1, parseInt(count || '200', 10) || 200);
    const file = getLogPath(kind || 'router');
    if (!fs.existsSync(file)) {
        console.log(`No log file: ${file}`);
        return;
    }
    try {
        const result = spawnSync('tail', ['-n', String(n), file], { stdio: 'inherit' });
        if (result.status !== 0) throw new Error('tail failed');
    } catch (e) {
        try {
            const data = fs.readFileSync(file, 'utf8');
            const lines = data.split('\n');
            const chunk = lines.slice(-n).join('\n');
            console.log(chunk);
        } catch (e2) {
            console.error(`Failed to read ${file}: ${e2.message}`);
        }
    }
}
```

## Exports

```javascript
export { getLogPath, logsTail, showLast };
```

## Log File Locations

| Kind | File Path |
|------|-----------|
| router | logs/router.log |

## Usage Example

```javascript
import { getLogPath, logsTail, showLast } from './logUtils.js';

// Get log file path
const routerLog = getLogPath('router');
console.log(`Router log: ${routerLog}`);

// Show last 50 lines
showLast(50, 'router');

// Follow log in real-time (blocking)
await logsTail('router');
```

## Fallback Watcher Implementation

The fallback file watcher:
1. Records initial file size
2. Opens file descriptor for reading
3. Polls every 1 second for size changes
4. Reads and outputs new content when file grows
5. Continues until process is terminated

This ensures log viewing works on systems without Unix `tail` command (e.g., some Windows environments via WSL).

## Related Modules

- [server-routing-server.md](../../server/server-routing-server.md) - Creates router logs
- [server-watchdog.md](../../server/server-watchdog.md) - Creates watchdog logs
