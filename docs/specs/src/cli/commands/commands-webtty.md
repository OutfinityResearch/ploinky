# cli/commands/webttyCommands.js - WebTTY Commands

## Overview

Provides CLI commands for configuring WebTTY terminal settings, specifically the shell to use for terminal sessions.

## Source File

`cli/commands/webttyCommands.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import * as envSvc from '../services/secretVars.js';
```

## Public API

### configureWebttyShell(input)

**Purpose**: Configures the shell used for WebTTY terminal sessions

**Parameters**:
- `input` (string): Shell name or absolute path

**Returns**: (boolean) True if configuration succeeded

**Allowed Shells**:
- `sh`, `zsh`, `dash`, `ksh`, `csh`, `tcsh`, `fish`
- Or any absolute path to a shell executable

**Implementation**:
```javascript
export function configureWebttyShell(input) {
    const allowed = new Set(['sh', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish']);
    const name = String(input || '').trim();

    // Validate shell name
    if (!allowed.has(name) && !name.startsWith('/')) {
        console.error(`Unsupported shell '${name}'. Allowed: ${Array.from(allowed).join(', ')}, or an absolute path.`);
        return false;
    }

    // Find shell in PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const candidates = name.startsWith('/') ? [name] : pathDirs.map(d => path.join(d, name));

    let found = null;
    for (const p of candidates) {
        try {
            fs.accessSync(p, fs.constants.X_OK);
            found = p;
            break;
        } catch (_) { }
    }

    if (!found) {
        console.error(`Cannot execute shell '${name}': not found or not executable in PATH.`);
        return false;
    }

    try {
        // Set environment variables for WebTTY
        envSvc.setEnvVar('WEBTTY_SHELL', found);
        envSvc.setEnvVar('WEBTTY_COMMAND', `exec ${name}`);

        console.log(`✓ Configured WebTTY shell: ${name} (${found}).`);
        console.log('Note: Restart the router (restart) for changes to take effect.');
        return true;
    } catch (e) {
        console.error(`Failed to configure WebTTY shell: ${e?.message || e}`);
        return false;
    }
}
```

## Exports

```javascript
export { configureWebttyShell };
```

## Environment Variables Set

| Variable | Description |
|----------|-------------|
| `WEBTTY_SHELL` | Full path to shell executable |
| `WEBTTY_COMMAND` | Command to execute (`exec <shell>`) |

## Usage Example

```javascript
import { configureWebttyShell } from './webttyCommands.js';

// Configure zsh as WebTTY shell
configureWebttyShell('zsh');
// Output: ✓ Configured WebTTY shell: zsh (/usr/bin/zsh).

// Configure custom shell path
configureWebttyShell('/opt/custom-shell/bin/mysh');

// Invalid shell
configureWebttyShell('badshell');
// Output: Unsupported shell 'badshell'. Allowed: sh, zsh, dash, ksh, csh, tcsh, fish, or an absolute path.
```

## CLI Usage

```bash
# Configure shell via CLI
ploinky shell zsh

# Use custom path
ploinky shell /usr/local/bin/custom-shell
```

## Related Modules

- [service-secret-vars.md](../services/utils/service-secret-vars.md) - Variable storage
- [server-handlers-webtty.md](../server/handlers/server-handlers-webtty.md) - WebTTY handler
