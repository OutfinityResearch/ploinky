# cli/server/handlers/webtty.js - WebTTY Handler

## Overview

Handles HTTP requests for the WebTTY web application. Provides browser-based terminal access with SSE streaming, session management, terminal resize support, and process lifecycle management with resource limits.

## Source File

`cli/server/handlers/webtty.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie } from './common.js';
import * as staticSrv from '../static/index.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webtty';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;  // 'webtty_sid'
```

## Internal Functions

### renderTemplate(filenames, replacements)

**Purpose**: Renders HTML template with variable substitution

**Parameters**:
- `filenames` (string[]): Template filenames to try in order
- `replacements` (Object): Key-value pairs for substitution

**Returns**: (string|null) Rendered HTML or null

**Implementation**:
```javascript
function renderTemplate(filenames, replacements) {
    const target = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, filenames);
    if (!target) return null;
    let html = fs.readFileSync(target, 'utf8');
    for (const [key, value] of Object.entries(replacements || {})) {
        html = html.split(key).join(String(value ?? ''));
    }
    return html;
}
```

### getSession(req, appState)

**Purpose**: Gets session ID from cookie if session exists

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `appState` (Object): Application state with sessions Map

**Returns**: (string|null) Session ID or null

**Implementation**:
```javascript
function getSession(req, appState) {
    const cookies = parseCookies(req);
    const sid = cookies.get(SID_COOKIE);
    return (sid && appState.sessions.has(sid)) ? sid : null;
}
```

### authorized(req, appState)

**Purpose**: Checks if request is authorized via SSO or session

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `appState` (Object): Application state

**Returns**: (boolean) True if authorized

**Implementation**:
```javascript
function authorized(req, appState) {
    if (req.user) return true;  // SSO authenticated
    return !!getSession(req, appState);  // Legacy session
}
```

### handleAuth(req, res, appConfig, appState)

**Purpose**: Handles legacy token-based authentication

**Method**: POST `/webtty/auth`

**Request Body**:
```json
{
    "token": "authentication_token"
}
```

**Behavior**:
- Returns 400 if SSO is enabled (req.user exists)
- Validates token against stored token file
- Creates new session on success

**Implementation**:
```javascript
async function handleAuth(req, res, appConfig, appState) {
    if (req.user) {
        res.writeHead(400);
        res.end('SSO is enabled; legacy auth disabled.');
        return;
    }
    try {
        const token = loadToken(appName);
        const body = await readJsonBody(req);
        if (body && body.token && String(body.token).trim() === token) {
            const sid = crypto.randomBytes(16).toString('hex');
            appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': buildCookie(SID_COOKIE, sid, req, `/${appName}`)
            });
            res.end(JSON.stringify({ ok: true }));
        } else {
            res.writeHead(403);
            res.end('Forbidden');
        }
    } catch (_) {
        res.writeHead(400);
        res.end('Bad Request');
    }
}
```

### ensureAppSession(req, res, appState)

**Purpose**: Creates or retrieves app session for SSO users

**Returns**: (string) Session ID

**Implementation**:
```javascript
function ensureAppSession(req, res, appState) {
    const cookies = parseCookies(req);
    let sid = cookies.get(SID_COOKIE);
    if (!sid) {
        sid = crypto.randomBytes(16).toString('hex');
        appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
        appendSetCookie(res, buildCookie(SID_COOKIE, sid, req, `/${appName}`));
    } else if (!appState.sessions.has(sid)) {
        appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
    }
    if (!cookies.has(SID_COOKIE)) {
        const existing = req.headers.cookie || '';
        req.headers.cookie = existing ? `${existing}; ${SID_COOKIE}=${sid}` : `${SID_COOKIE}=${sid}`;
    }
    return sid;
}
```

## Public API

### handleWebTTY(req, res, appConfig, appState)

**Purpose**: Main request handler for WebTTY routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `appConfig` (Object): Configuration with ttyFactory
- `appState` (Object): State with sessions Map

**Routes**:

| Path | Method | Description |
|------|--------|-------------|
| `/webtty/auth` | POST | Legacy token authentication |
| `/webtty/whoami` | GET | Check authorization status |
| `/webtty/assets/*` | GET | Static assets |
| `/webtty/` | GET | Main terminal interface |
| `/webtty/stream` | GET | SSE stream for terminal output |
| `/webtty/input` | POST | Send input to terminal |
| `/webtty/resize` | POST | Resize terminal |

**Connection Limits**:
- `MAX_GLOBAL_TTYS = 20`: Maximum total TTY processes across all sessions
- `MAX_CONCURRENT_TTYS = 3`: Maximum per session
- `MIN_RECONNECT_INTERVAL_MS = 1000`: Minimum time between reconnections

**Implementation**:
```javascript
function handleWebTTY(req, res, appConfig, appState) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    // Route: POST /auth
    if (pathname === '/auth' && req.method === 'POST') {
        return handleAuth(req, res, appConfig, appState);
    }

    // Route: GET /whoami
    if (pathname === '/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: authorized(req, appState) }));
    }

    // SSO session setup
    if (req.user) {
        ensureAppSession(req, res, appState);
    }

    // Route: Static assets
    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    // Authorization check
    if (!authorized(req, appState)) {
        if (req.user) {
            res.writeHead(403);
            return res.end('Access forbidden');
        }
        const html = renderTemplate(['login.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Router',
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

    // Route: Main page
    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['webtty.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Router',
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

    // Route: SSE Stream
    if (pathname === '/stream') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        if (!session || !tabId) {
            res.writeHead(400);
            return res.end();
        }

        // Global limit
        const MAX_GLOBAL_TTYS = 20;
        let globalTabCount = 0;
        for (const sess of appState.sessions.values()) {
            if (sess.tabs instanceof Map) {
                globalTabCount += sess.tabs.size;
            }
        }
        if (globalTabCount >= MAX_GLOBAL_TTYS) {
            res.writeHead(503, { 'Retry-After': '30' });
            res.end('Server at capacity.');
            return;
        }

        // Per-session limit
        const MAX_CONCURRENT_TTYS = 3;
        if (session.tabs.size >= MAX_CONCURRENT_TTYS) {
            res.writeHead(429, { 'Retry-After': '5' });
            res.end('Too many concurrent connections.');
            return;
        }

        // Reconnection debounce
        let tab = session.tabs.get(tabId);
        const now = Date.now();
        if (tab && tab.lastConnectTime && (now - tab.lastConnectTime) < 1000) {
            res.writeHead(429, { 'Retry-After': '1' });
            res.end('Reconnecting too fast.');
            return;
        }

        // SSE response headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'alt-svc': 'clear'
        });
        res.write(': connected\n\n');

        // Create or reuse TTY
        if (!tab) {
            if (!appConfig.ttyFactory) {
                res.writeHead(503);
                res.end('TTY support unavailable.');
                return;
            }
            try {
                const tty = appConfig.ttyFactory.create();
                tab = {
                    tty,
                    sseRes: res,
                    lastConnectTime: now,
                    createdAt: now,
                    pid: tty.pid || null,
                    cleanupTimer: null
                };
                session.tabs.set(tabId, tab);

                tty.onOutput((data) => {
                    if (tab.sseRes) {
                        tab.sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
                    }
                });
                tty.onClose(() => {
                    if (tab.sseRes) {
                        tab.sseRes.write('event: close\ndata: {}\n\n');
                    }
                    if (tab.cleanupTimer) {
                        clearTimeout(tab.cleanupTimer);
                    }
                });
            } catch (e) {
                res.writeHead(500);
                res.end('Failed to create TTY: ' + (e?.message || e));
                return;
            }
        } else {
            tab.sseRes = res;
            tab.lastConnectTime = now;
        }

        // Cleanup on disconnect
        req.on('close', () => {
            if (tab.cleanupTimer) {
                clearTimeout(tab.cleanupTimer);
            }
            if (tab.tty) {
                const pid = tab.pid || tab.tty.pid;
                if (typeof tab.tty.dispose === 'function') {
                    try { tab.tty.dispose(); } catch (_) { }
                } else if (typeof tab.tty.kill === 'function') {
                    try { tab.tty.kill(); } catch (_) { }
                }
                // Force kill after 2s
                if (pid) {
                    setTimeout(() => {
                        try {
                            global.processKill(pid, 0);
                            global.processKill(pid, 'SIGKILL');
                        } catch (_) { }
                    }, 2000);
                }
            }
            tab.sseRes = null;
            if (session.tabs instanceof Map) {
                session.tabs.delete(tabId);
            }
        });
        return;
    }

    // Route: POST /input
    if (pathname === '/input' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        const tab = session && session.tabs.get(tabId);
        if (!tab) {
            res.writeHead(400);
            return res.end();
        }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try { tab.tty.write(body); } catch (_) { }
            res.writeHead(204);
            res.end();
        });
        return;
    }

    // Route: POST /resize
    if (pathname === '/resize' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        const tab = session && session.tabs.get(tabId);
        if (!tab) {
            res.writeHead(400);
            return res.end();
        }
        readJsonBody(req)
            .then(({ cols, rows }) => {
                try { tab.tty.resize?.(cols, rows); } catch (_) { }
                res.writeHead(204);
                res.end();
            })
            .catch(() => {
                res.writeHead(400);
                res.end();
            });
        return;
    }

    res.writeHead(404);
    res.end('Not Found in App');
}
```

## Exports

```javascript
export { handleWebTTY };
```

## Session State Structure

```javascript
{
    sessions: Map {
        'session_id_hex': {
            tabs: Map {
                'tab_id': {
                    tty: {
                        pid: number,
                        write: (data: string) => void,
                        resize: (cols: number, rows: number) => void,
                        onOutput: (callback: (data: string) => void) => void,
                        onClose: (callback: () => void) => void,
                        dispose: () => void,
                        kill: () => void
                    },
                    sseRes: http.ServerResponse,
                    lastConnectTime: number,
                    createdAt: number,
                    pid: number,
                    cleanupTimer: Timer | null
                }
            },
            createdAt: number
        }
    }
}
```

## Template Variables

| Variable | Description |
|----------|-------------|
| `__ASSET_BASE__` | Base URL for static assets |
| `__AGENT_NAME__` | Agent name or 'Router' |
| `__CONTAINER_NAME__` | Container name or '-' |
| `__RUNTIME__` | Runtime type (local/container) |
| `__REQUIRES_AUTH__` | Whether authentication required |
| `__BASE_PATH__` | Base URL path for app |

## Usage Example

```javascript
import { handleWebTTY } from './handlers/webtty.js';

const appState = {
    sessions: new Map()
};

const appConfig = {
    ttyFactory: {
        create: () => {
            // Create PTY using node-pty
            const pty = require('node-pty');
            const shell = process.env.SHELL || '/bin/bash';
            const term = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: process.cwd(),
                env: process.env
            });
            return {
                pid: term.pid,
                write: (data) => term.write(data),
                resize: (cols, rows) => term.resize(cols, rows),
                onOutput: (cb) => term.onData(cb),
                onClose: (cb) => term.onExit(cb),
                dispose: () => term.kill()
            };
        }
    },
    agentName: 'my-agent',
    containerName: 'ploinky_basic_my-agent_project_abc123',
    runtime: 'container'
};

// In server request handler
if (req.url.startsWith('/webtty')) {
    handleWebTTY(req, res, appConfig, appState);
}
```

## Related Modules

- [server-handlers-common.md](./server-handlers-common.md) - HTTP utilities
- [server-static-index.md](../static/server-static-index.md) - Static file serving
- [commands-webtty.md](../../commands/commands-webtty.md) - WebTTY CLI commands
