# cli/services/serverManager.js - Server Manager

## Overview

Manages web server lifecycle including port allocation, configuration persistence, process tracking, and status monitoring for WebTTY, WebChat, WebMeet, and Dashboard servers.

## Source File

`cli/services/serverManager.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import { setEnvVar } from './secretVars.js';
import { appendLog } from '../server/utils/logger.js';
```

## Constants

```javascript
const SERVERS_CONFIG_FILE = path.resolve('.ploinky/servers.json');
```

## Public API

### isPortAvailable(port)

**Purpose**: Checks if a port is available for binding

**Parameters**:
- `port` (number): Port to check

**Returns**: (Promise<boolean>) True if available

**Implementation**:
```javascript
export function isPortAvailable(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '127.0.0.1');
    });
}
```

### findAvailablePort(min, max, maxAttempts)

**Purpose**: Finds an available port in range

**Parameters**:
- `min` (number): Minimum port (default: 10000)
- `max` (number): Maximum port (default: 60000)
- `maxAttempts` (number): Max attempts (default: 50)

**Returns**: (Promise<number>) Available port

**Throws**: Error if no port found after maxAttempts

**Implementation**:
```javascript
export async function findAvailablePort(min = 10000, max = 60000, maxAttempts = 50) {
    for (let i = 0; i < maxAttempts; i++) {
        const port = getRandomPort(min, max);
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error('Could not find available port after ' + maxAttempts + ' attempts');
}
```

### loadServersConfig()

**Purpose**: Loads server configuration from disk

**Returns**: (Object) Server configuration

**Default Config**:
```javascript
{
    webtty: { port: null, token: null, command: null },
    webchat: { port: null, token: null, command: null },
    webmeet: { port: null, token: null, agent: null },
    dashboard: { port: null, token: null }
}
```

### saveServersConfig(config)

**Purpose**: Saves server configuration to disk

**Parameters**:
- `config` (Object): Configuration to save

### ensureServerConfig(serverName, options)

**Purpose**: Ensures server has valid configuration

**Parameters**:
- `serverName` (string): Server name (webtty, webchat, webmeet, dashboard)
- `options` (Object):
  - `forceNewPort` (boolean): Allocate new port
  - `forceNewToken` (boolean): Generate new token
  - `keepExistingPort` (boolean): Keep port even if unavailable
  - `command` (string): Command to store
  - `agent` (string): Agent name to store

**Returns**: (Promise<Object>) Server configuration

**Behavior**:
1. Loads existing config
2. Allocates port if needed
3. Generates token if needed
4. Sets environment variable for token
5. Saves updated config

**Token Environment Variables**:

| Server | Environment Variable |
|--------|---------------------|
| webtty | WEBTTY_TOKEN |
| webchat | WEBCHAT_TOKEN |
| webmeet | WEBMEET_TOKEN |
| dashboard | WEBDASHBOARD_TOKEN |

**Implementation**:
```javascript
export async function ensureServerConfig(serverName, options = {}) {
    const config = loadServersConfig();
    const server = config[serverName] || {};

    if (!server.port || options.forceNewPort) {
        server.port = await findAvailablePort();
    } else {
        const available = await isPortAvailable(server.port);
        if (!available && !options.keepExistingPort) {
            server.port = await findAvailablePort();
        }
    }

    if (!server.token || options.forceNewToken) {
        server.token = crypto.randomBytes(32).toString('hex');
    }

    // Set token environment variable
    const tokenName = serverName === 'webtty' ? 'WEBTTY_TOKEN'
        : serverName === 'webchat' ? 'WEBCHAT_TOKEN'
        : serverName === 'webmeet' ? 'WEBMEET_TOKEN'
        : serverName === 'dashboard' ? 'WEBDASHBOARD_TOKEN'
        : null;
    if (tokenName) setEnvVar(tokenName, server.token);

    if (options.command !== undefined) server.command = options.command;
    if (options.agent !== undefined) server.agent = options.agent;

    config[serverName] = server;
    saveServersConfig(config);

    return server;
}
```

### getServerConfig(serverName)

**Purpose**: Gets configuration for a specific server

**Parameters**:
- `serverName` (string): Server name

**Returns**: (Object|null) Server config or null

### updateServerConfig(serverName, updates)

**Purpose**: Updates server configuration

**Parameters**:
- `serverName` (string): Server name
- `updates` (Object): Fields to update

**Returns**: (Object) Updated configuration

### isServerRunning(pidFile)

**Purpose**: Checks if a server process is running

**Parameters**:
- `pidFile` (string): PID filename (e.g., 'webtty.pid')

**Returns**: `{ running: boolean, pid: number|null }`

**Implementation**:
```javascript
export function isServerRunning(pidFile) {
    try {
        const pidPath = path.resolve('.ploinky/running', pidFile);
        if (fs.existsSync(pidPath)) {
            const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
            if (pid && !Number.isNaN(pid)) {
                try {
                    process.kill(pid, 0); // Signal 0 tests if process exists
                    return { running: true, pid };
                } catch {
                    return { running: false, pid };
                }
            }
        }
    } catch (_) {}
    return { running: false, pid: null };
}
```

### stopServer(pidFile, serverName)

**Purpose**: Stops a running server

**Parameters**:
- `pidFile` (string): PID filename
- `serverName` (string): Server name for logging

**Behavior**:
1. Reads PID from file
2. Sends SIGTERM to process
3. Logs action
4. Removes PID file

### getAllServerStatuses()

**Purpose**: Gets status of all managed servers

**Returns**: (Object) Map of server statuses

**Status Structure**:
```javascript
{
    webtty: {
        displayName: 'Dashboard Console',
        running: boolean,
        pid: number|null,
        port: number|null,
        hasToken: boolean,
        command: string|null,
        agent: string|null
    },
    webchat: { ... },
    webmeet: { ... },
    dashboard: { ... }
}
```

**Implementation**:
```javascript
export function getAllServerStatuses() {
    const config = loadServersConfig();
    const statuses = {};

    const servers = [
        { name: 'webtty', pidFile: 'webtty.pid', displayName: 'Dashboard Console' },
        { name: 'webchat', pidFile: 'webchat.pid', displayName: 'WebChat' },
        { name: 'webmeet', pidFile: 'webmeet.pid', displayName: 'WebMeet' },
        { name: 'dashboard', pidFile: 'dashboard.pid', displayName: 'Dashboard' }
    ];

    for (const server of servers) {
        const cfg = config[server.name] || {};
        const status = isServerRunning(server.pidFile);
        statuses[server.name] = {
            displayName: server.displayName,
            running: status.running,
            pid: status.pid,
            port: cfg.port,
            hasToken: Boolean(cfg.token),
            command: cfg.command,
            agent: cfg.agent
        };
    }

    return statuses;
}
```

## Configuration File

Location: `.ploinky/servers.json`

```json
{
    "webtty": {
        "port": 12345,
        "token": "abc123...",
        "command": "bash"
    },
    "webchat": {
        "port": 12346,
        "token": "def456...",
        "command": null
    },
    "webmeet": {
        "port": 12347,
        "token": "ghi789...",
        "agent": "node-dev"
    },
    "dashboard": {
        "port": 12348,
        "token": "jkl012..."
    }
}
```

## PID Files

Location: `.ploinky/running/`

- `webtty.pid`
- `webchat.pid`
- `webmeet.pid`
- `dashboard.pid`

## Usage Example

```javascript
import {
    ensureServerConfig,
    getAllServerStatuses,
    stopServer,
    isServerRunning
} from './serverManager.js';

// Ensure WebTTY is configured
const config = await ensureServerConfig('webtty', {
    command: 'bash'
});
console.log(`WebTTY on port ${config.port}`);
console.log(`Token: ${config.token}`);

// Check status
const statuses = getAllServerStatuses();
for (const [name, status] of Object.entries(statuses)) {
    console.log(`${status.displayName}: ${status.running ? 'Running' : 'Stopped'}`);
}

// Stop server
stopServer('webtty.pid', 'webtty');
```

## Related Modules

- [commands-webtty.md](../../commands/commands-webtty.md) - WebTTY commands
- [service-secret-vars.md](./service-secret-vars.md) - Token environment
- [server-handlers-status.md](../../server/handlers/server-handlers-status.md) - Uses statuses
