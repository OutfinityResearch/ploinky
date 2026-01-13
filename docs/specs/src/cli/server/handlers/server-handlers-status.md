# cli/server/handlers/status.js - Status Handler

## Overview

Handles HTTP requests for the Status web application. Provides system status information including server status, workspace agents, static configuration, and CLI output.

## Source File

`cli/server/handlers/status.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import * as staticSrv from '../static/index.js';
import { getAllServerStatuses } from '../../services/serverManager.js';
import { loadAgents } from '../../services/workspace.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'status';
const fallbackAppPath = path.join(__dirname, '../', appName);
```

## Internal Functions

### renderTemplate(filenames, replacements)

**Purpose**: Renders HTML template with variable substitution

**Parameters**:
- `filenames` (string[]): Template filenames to try
- `replacements` (Object): Key-value substitutions

**Returns**: (string|null) Rendered HTML or null

### runStatusCommand()

**Purpose**: Executes `ploinky status` CLI command

**Returns**: (Promise<{code: number, stdout: string, stderr: string}>)

**Implementation**:
```javascript
function runStatusCommand() {
    return new Promise((resolve) => {
        let resolved = false;
        const finish = (payload) => {
            if (resolved) return;
            resolved = true;
            resolve(payload);
        };

        try {
            const proc = spawn('ploinky', ['status'], { cwd: process.cwd() });
            let out = '';
            let err = '';
            proc.stdout.on('data', chunk => out += chunk.toString('utf8'));
            proc.stderr.on('data', chunk => err += chunk.toString('utf8'));
            proc.on('close', (code) => {
                finish({ code, stdout: out, stderr: err });
            });
            proc.on('error', (error) => {
                const message = error && error.message ? error.message : String(error || 'spawn error');
                finish({ code: -1, stdout: out, stderr: message });
            });
        } catch (e) {
            finish({ code: -1, stdout: '', stderr: e?.message || String(e) });
        }
    });
}
```

### collectServerStatuses()

**Purpose**: Collects server status information

**Returns**: (Object) Server statuses from serverManager

**Implementation**:
```javascript
function collectServerStatuses() {
    try {
        return getAllServerStatuses();
    } catch (_) {
        return {};
    }
}
```

### collectWorkspaceAgents()

**Purpose**: Collects workspace agent information

**Returns**: (Array<{container, agentName, repoName, image}>)

**Implementation**:
```javascript
function collectWorkspaceAgents() {
    try {
        const map = loadAgents() || {};
        return Object.entries(map)
            .filter(([key]) => key !== '_config')
            .map(([container, rec]) => ({
                container,
                agentName: rec?.agentName || container,
                repoName: rec?.repoName || '',
                image: rec?.containerImage || ''
            }));
    } catch (_) {
        return [];
    }
}
```

### collectStaticInfo()

**Purpose**: Collects static hosting configuration

**Returns**: (Object) Static info with agent, hostPath, port, repo

**Implementation**:
```javascript
function collectStaticInfo() {
    try {
        const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
        let repo = null;

        if (routing?.static?.hostPath) {
            const pathParts = routing.static.hostPath.split(path.sep);
            const reposIndex = pathParts.indexOf('repos');
            if (reposIndex !== -1 && reposIndex < pathParts.length - 1) {
                repo = pathParts[reposIndex + 1];
            } else {
                repo = path.basename(path.dirname(routing.static.hostPath));
            }
        }

        return {
            agent: routing?.static?.agent || null,
            hostPath: routing?.static?.hostPath || null,
            port: routing?.port || null,
            repo: repo
        };
    } catch (_) {
        return { agent: null, hostPath: null, port: null, repo: null };
    }
}
```

## Public API

### handleStatus(req, res)

**Purpose**: Main request handler for status routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response

**Routes**:

| Path | Method | Description |
|------|--------|-------------|
| `/status/assets/*` | GET | Static assets |
| `/status/` | GET | Status page HTML |
| `/status/data` | GET | JSON status data |

**Implementation**:
```javascript
function handleStatus(req, res) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    // Static assets
    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    // Main status page
    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['status.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': 'Status',
            '__CONTAINER_NAME__': '-',
            '__RUNTIME__': 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
    }

    // JSON data endpoint
    if (pathname === '/data') {
        Promise.all([runStatusCommand()]).then(([result]) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const payload = {
                ok: true,
                code: result.code,
                output: result.stdout || result.stderr || '',
                servers: collectServerStatuses(),
                static: collectStaticInfo(),
                agents: collectWorkspaceAgents()
            };
            res.end(JSON.stringify(payload));
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found in App');
}
```

## Exports

```javascript
export { handleStatus };
```

## Data Endpoint Response

**GET /status/data**:
```json
{
    "ok": true,
    "code": 0,
    "output": "CLI status output...",
    "servers": {
        "router": {
            "running": true,
            "pid": 1234,
            "port": 8080
        }
    },
    "static": {
        "agent": "my-agent",
        "hostPath": "/path/to/static",
        "port": 8080,
        "repo": "basic"
    },
    "agents": [
        {
            "container": "ploinky_basic_node-dev_proj_123",
            "agentName": "node-dev",
            "repoName": "basic",
            "image": "node:18-alpine"
        }
    ]
}
```

## Template Variables

| Variable | Description |
|----------|-------------|
| `__ASSET_BASE__` | Base URL for static assets |
| `__AGENT_NAME__` | Always 'Status' |
| `__CONTAINER_NAME__` | Always '-' |
| `__RUNTIME__` | Always 'local' |
| `__REQUIRES_AUTH__` | Always 'true' |
| `__BASE_PATH__` | Base URL path |

## Usage Example

```javascript
import { handleStatus } from './handlers/status.js';

// In request handler
if (req.url.startsWith('/status')) {
    handleStatus(req, res);
}
```

## Related Modules

- [server-static-index.md](../static/server-static-index.md) - Static file serving
- [service-workspace.md](../../services/workspace/service-workspace.md) - Agent loading
- [service-server-manager.md](../../services/utils/service-server-manager.md) - Server status
