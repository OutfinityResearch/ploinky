# cli/server/handlers/dashboard.js - Dashboard Handler

## Overview

Handles HTTP requests for the Dashboard web application. Provides web-based management interface with command execution capabilities, session management, and static file serving.

## Source File

`cli/server/handlers/dashboard.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie } from './common.js';
import * as staticSrv from '../static/index.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'dashboard';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;  // 'dashboard_sid'
```

## Internal Functions

### renderTemplate(filenames, replacements)

**Purpose**: Renders HTML template with variable substitution

**Parameters**:
- `filenames` (string[]): Template filenames to try
- `replacements` (Object): Key-value substitutions

**Returns**: (string|null) Rendered HTML or null

### getSession(req, appState)

**Purpose**: Gets session ID from cookie if session exists

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `appState` (Object): Application state

**Returns**: (string|null) Session ID or null

### authorized(req, appState)

**Purpose**: Checks if request is authorized

**Returns**: (boolean) True if SSO user or valid session

### handleAuth(req, res, appConfig, appState)

**Purpose**: Handles legacy token authentication

**Method**: POST `/dashboard/auth`

**Behavior**:
- Returns 400 if SSO enabled
- Validates token and creates session on success

### ensureAppSession(req, res, appState)

**Purpose**: Ensures app session exists for SSO users

**Returns**: (string) Session ID

## Public API

### handleDashboard(req, res, appConfig, appState)

**Purpose**: Main request handler for dashboard routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `appConfig` (Object): Application configuration
- `appState` (Object): Application state with sessions Map

**Routes**:

| Path | Method | Description |
|------|--------|-------------|
| `/dashboard/auth` | POST | Legacy token authentication |
| `/dashboard/whoami` | GET | Check authorization status |
| `/dashboard/assets/*` | GET | Static assets |
| `/dashboard/` | GET | Main dashboard interface |
| `/dashboard/run` | POST | Execute ploinky command |

**Implementation**:
```javascript
function handleDashboard(req, res, appConfig, appState) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    // Auth route
    if (pathname === '/auth' && req.method === 'POST') {
        return handleAuth(req, res, appConfig, appState);
    }

    // Authorization check
    if (pathname === '/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: authorized(req, appState) }));
    }

    // SSO session setup
    if (req.user) {
        ensureAppSession(req, res, appState);
    }

    // Static assets
    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    // Authorization required for remaining routes
    if (!authorized(req, appState)) {
        if (req.user) {
            res.writeHead(403);
            return res.end('Access forbidden');
        }
        // Show login page
        const html = renderTemplate(['login.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Dashboard',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
        res.writeHead(403);
        return res.end('Forbidden');
    }

    // Main dashboard page
    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['dashboard.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Dashboard',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
    }

    // Command execution
    if (pathname === '/run' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { cmd } = JSON.parse(body);
                const args = (cmd || '').trim().split(/\s+/).filter(Boolean);
                const proc = spawn('ploinky', args, { cwd: process.cwd() });

                let out = '';
                let err = '';
                proc.stdout.on('data', d => out += d.toString('utf8'));
                proc.stderr.on('data', d => err += d.toString('utf8'));

                proc.on('close', (code) => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, code, stdout: out, stderr: err }));
                });
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found in App');
}
```

## Exports

```javascript
export { handleDashboard };
```

## Template Variables

| Variable | Description |
|----------|-------------|
| `__ASSET_BASE__` | Base URL for static assets |
| `__AGENT_NAME__` | Agent name or 'Dashboard' |
| `__CONTAINER_NAME__` | Container name or '-' |
| `__RUNTIME__` | Runtime type (local/container) |
| `__REQUIRES_AUTH__` | Whether auth is required |
| `__BASE_PATH__` | Base URL path |

## Command Execution

The `/run` endpoint allows executing ploinky CLI commands:

**Request**:
```json
{
    "cmd": "status"
}
```

**Response**:
```json
{
    "ok": true,
    "code": 0,
    "stdout": "...",
    "stderr": ""
}
```

**Security Notes**:
- Commands are limited to `ploinky` subcommands
- Requires authentication
- Runs in server's working directory

## Session State

```javascript
{
    sessions: Map {
        'session_id_hex': {
            createdAt: number
        }
    }
}
```

## Usage Example

```javascript
import { handleDashboard } from './handlers/dashboard.js';

const appState = {
    sessions: new Map()
};

const appConfig = {
    agentName: 'Dashboard',
    containerName: '-',
    runtime: 'local'
};

// In request handler
if (req.url.startsWith('/dashboard')) {
    handleDashboard(req, res, appConfig, appState);
}
```

## Related Modules

- [server-handlers-common.md](./server-handlers-common.md) - HTTP utilities
- [server-static-index.md](../static/server-static-index.md) - Static file serving
- [server-handlers-status.md](./server-handlers-status.md) - Status handler
