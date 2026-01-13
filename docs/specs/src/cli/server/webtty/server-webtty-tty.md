# cli/server/webtty/tty.js - WebTTY PTY Factory

## Overview

Server-side PTY (pseudo-terminal) factory module for WebTTY. Provides factories for creating terminal sessions both inside Docker containers and locally on the host system. Uses node-pty for terminal emulation.

## Source File

`cli/server/webtty/tty.js`

## Dependencies

```javascript
import { buildExecArgs } from '../../services/docker/index.js';
```

## Public API

### createTTYFactory(options)

**Purpose**: Creates a factory for Docker container terminal sessions

**Parameters**:
- `options` (Object):
  - `runtime` (string): Container runtime ('docker' or 'podman')
  - `containerName` (string): Target container name
  - `ptyLib` (Object): node-pty library
  - `workdir` (string): Working directory
  - `entry` (string): Entry command

**Returns**: (Object) Factory object

**Return Structure**:
```javascript
{
    create: Function  // Creates new PTY session
}
```

**Implementation**:
```javascript
function createTTYFactory({ runtime, containerName, ptyLib, workdir, entry }) {
    const DEBUG = process.env.WEBTTY_DEBUG === '1';
    const log = (...args) => { if (DEBUG) console.log('[webtty][tty]', ...args); };

    const factory = () => {
        const wd = workdir || process.cwd();
        const env = { ...process.env, TERM: 'xterm-256color' };
        const shellCmd = entry && String(entry).trim()
            ? entry
            : "(command -v /bin/bash >/dev/null 2>&1 && exec /bin/bash) || exec /bin/sh";
        const execArgs = buildExecArgs(containerName, wd, shellCmd, true);

        let isPTY = false;
        let ptyProc = null;
        const outputHandlers = new Set();
        const closeHandlers = new Set();

        const emitOutput = (data) => {
            for (const h of outputHandlers) {
                try { h(data); } catch (_) {}
            }
        };
        const emitClose = () => {
            for (const h of closeHandlers) {
                try { h(); } catch (_) {}
            }
        };

        if (!ptyLib) throw new Error("'node-pty' is required for console sessions.");

        try {
            ptyProc = ptyLib.spawn(runtime, execArgs, {
                name: 'xterm-color',
                cols: 80,
                rows: 24,
                cwd: process.cwd(),
                env
            });
            isPTY = true;
            log('spawned PTY', { runtime, containerName, entry: entry || 'sh' });
            ptyProc.onData(emitOutput);
            ptyProc.onExit(() => {
                log('pty exit');
                emitClose();
            });
        } catch (e) {
            log('pty spawn failed', e?.message || e);
            throw e;
        }

        return {
            isPTY,
            onOutput(handler) {
                if (handler) outputHandlers.add(handler);
                return () => outputHandlers.delete(handler);
            },
            onClose(handler) {
                if (handler) closeHandlers.add(handler);
                return () => closeHandlers.delete(handler);
            },
            write(data) {
                if (DEBUG) log('write', { bytes: Buffer.byteLength(data || '') });
                try { ptyProc?.write?.(data); } catch (e) { log('write error', e?.message || e); }
            },
            resize(cols, rows) {
                if (!cols || !rows) return;
                try { ptyProc?.resize?.(cols, rows); }
                catch (e) { log('resize error', e?.message || e); }
                if (DEBUG) log('resized', { cols, rows, pty: isPTY });
            },
            close() {
                try { ptyProc?.kill?.(); } catch (_) {}
            }
        };
    };

    return { create: factory };
}
```

### createLocalTTYFactory(options)

**Purpose**: Creates a factory for local host terminal sessions

**Parameters**:
- `options` (Object):
  - `ptyLib` (Object): node-pty library
  - `workdir` (string): Working directory
  - `command` (string): Custom shell command

**Returns**: (Object) Factory object

**Implementation**:
```javascript
function createLocalTTYFactory({ ptyLib, workdir, command }) {
    const DEBUG = process.env.WEBTTY_DEBUG === '1';
    const log = (...args) => { if (DEBUG) console.log('[webtty][tty-local]', ...args); };

    const factory = () => {
        const wd = workdir || process.cwd();
        const env = { ...process.env, TERM: 'xterm-256color' };

        const hasCustom = !!(command && String(command).trim());
        const parentShell = process.env.WEBTTY_SHELL || process.env.SHELL || '/bin/sh';
        const entry = hasCustom
            ? String(command)
            : 'command -v /bin/bash >/dev/null 2>&1 && exec /bin/bash || exec /bin/sh';
        const shCmd = `cd '${wd}' && ${entry}`;

        if (!ptyLib) throw new Error("'node-pty' is required for local console sessions.");

        let ptyProc = ptyLib.spawn(parentShell, ['-lc', shCmd], {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: wd,
            env
        });

        // ... same PTY instance API as container factory
    };

    return { create: factory };
}
```

## PTY Instance API

The factory's `create()` method returns an instance with:

| Method | Description |
|--------|-------------|
| `isPTY` | Boolean indicating PTY mode |
| `onOutput(handler)` | Subscribe to output data |
| `onClose(handler)` | Subscribe to close event |
| `write(data)` | Write data to terminal |
| `resize(cols, rows)` | Resize terminal dimensions |
| `close()` | Kill terminal process |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBTTY_DEBUG` | Enable debug logging (`'1'`) |
| `WEBTTY_SHELL` | Override parent shell |
| `SHELL` | Fallback shell path |

## PTY Options

```javascript
{
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' }
}
```

## Exports

```javascript
export { createTTYFactory, createLocalTTYFactory };
```

## Usage Example

```javascript
import { createTTYFactory, createLocalTTYFactory } from './tty.js';
import * as pty from 'node-pty';

// Docker container terminal
const containerFactory = createTTYFactory({
    runtime: 'docker',
    containerName: 'my-container',
    ptyLib: pty,
    workdir: '/app',
    entry: '/bin/bash'
});

const session = containerFactory.create();
session.onOutput((data) => console.log('Output:', data));
session.onClose(() => console.log('Session closed'));
session.write('ls -la\n');
session.resize(120, 40);
session.close();

// Local terminal
const localFactory = createLocalTTYFactory({
    ptyLib: pty,
    workdir: '/home/user',
    command: 'bash --login'
});

const localSession = localFactory.create();
```

## Related Modules

- [server-utils-tty-factories.md](../utils/server-utils-tty-factories.md) - Factory initialization
- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - WebTTY handler
- [docker-index.md](../../services/docker/docker-index.md) - Docker exec args

