# cli/server/RoutingServer.js - Main HTTP Router Server

## Overview

The central HTTP server for Ploinky that routes requests to appropriate handlers including WebTTY, WebChat, WebMeet, Dashboard, and agent MCP endpoints. Handles authentication, static file serving, and health monitoring.

## Source File

`cli/server/RoutingServer.js`

## Dependencies

```javascript
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Handler imports
import { handleWebTTY } from './handlers/webtty.js';
import { handleWebChat } from './handlers/webchat.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleWebMeet } from './handlers/webmeet.js';
import { handleStatus } from './handlers/status.js';
import { handleBlobs } from './handlers/blobs.js';
import * as staticSrv from './static/index.js';

// Authentication and routing
import { ensureAuthenticated, ensureAgentAuthenticated, handleAuthRoutes } from './authHandlers.js';
import { loadApiRoutes, handleRouterMcp } from './routerHandlers.js';

// Logging
import { appendLog, logBootEvent, logMemoryUsage } from './utils/logger.js';

// Modular components
import { agentSessionStore, handleAgentMcpRequest } from './mcp-proxy/index.js';
import { initializeTTYFactories, createServiceConfig } from './utils/ttyFactories.js';
import { setupProcessLifecycle } from './utils/processLifecycle.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_BROWSER_CLIENT_PATH = path.resolve(__dirname, '../../Agent/client/MCPBrowserClient.js');
```

## Data Structures

```javascript
/**
 * Global state for all services
 * @typedef {Object} GlobalState
 * @property {Object} webtty - WebTTY state
 * @property {Map} webtty.sessions - Active WebTTY sessions
 * @property {Object} webchat - WebChat state
 * @property {Map} webchat.sessions - Active WebChat sessions
 * @property {Object} dashboard - Dashboard state
 * @property {Map} dashboard.sessions - Active dashboard sessions
 * @property {Object} webmeet - WebMeet state
 * @property {Map} webmeet.sessions - Active WebMeet sessions
 * @property {Map} webmeet.participants - Meeting participants
 * @property {Array} webmeet.chatHistory - Chat history
 * @property {Map} webmeet.privateHistory - Private chat history
 * @property {number} webmeet.nextMsgId - Next message ID
 * @property {Array} webmeet.queue - Speaker queue
 * @property {string|null} webmeet.currentSpeaker - Current speaker
 * @property {Object} status - Status endpoint state
 * @property {Map} status.sessions - Active status sessions
 */

const globalState = {
    webtty: { sessions: new Map() },
    webchat: { sessions: new Map() },
    dashboard: { sessions: new Map() },
    webmeet: {
        sessions: new Map(),
        participants: new Map(),
        chatHistory: [],
        privateHistory: new Map(),
        nextMsgId: 1,
        queue: [],
        currentSpeaker: null
    },
    status: { sessions: new Map() }
};

/**
 * Health data structure
 * @typedef {Object} HealthData
 * @property {'healthy'} status - Health status
 * @property {number} uptime - Process uptime in seconds
 * @property {string} timestamp - ISO timestamp
 * @property {number} pid - Process ID
 * @property {Object} memory - Memory statistics
 * @property {Object} activeSessions - Session counts by service
 */
```

## Internal Functions

### safeLog(...args)

**Purpose**: Console logging that catches EPIPE/EIO errors

**Implementation**:
```javascript
function safeLog(...args) {
    try {
        console.log(...args);
    } catch (_) {
        // Ignore write errors - stdout may be broken
    }
}
```

### serveMcpBrowserClient(req, res)

**Purpose**: Serves the MCP Browser Client JavaScript file

**Implementation**:
```javascript
function serveMcpBrowserClient(req, res) {
    let stats;
    try {
        stats = fs.statSync(MCP_BROWSER_CLIENT_PATH);
        if (!stats.isFile()) throw new Error('not a file');
    } catch (err) {
        appendLog('mcp_client_missing', { error: err?.message || String(err) });
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    appendLog('mcp_client_request', { method: req.method });
    res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Length': stats.size
    });

    if (req.method === 'HEAD') {
        res.end();
        return;
    }

    const stream = fs.createReadStream(MCP_BROWSER_CLIENT_PATH);
    stream.on('error', err => {
        appendLog('mcp_client_stream_error', { error: err?.message || String(err) });
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
    });
    stream.pipe(res);
}
```

### proxyAgentTaskStatus(req, res, route, parsedUrl, agentName)

**Purpose**: Proxies task status requests to agent containers

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `route` (Object): Route configuration with hostPort
- `parsedUrl` (URL): Parsed request URL
- `agentName` (string): Target agent name

**Implementation**:
```javascript
function proxyAgentTaskStatus(req, res, route, parsedUrl, agentName) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
    }

    const pathWithQuery = `/getTaskStatus${parsedUrl.search || ''}`;
    const upstream = http.request({
        hostname: '127.0.0.1',
        port: route.hostPort,
        path: pathWithQuery,
        method: 'GET',
        headers: { accept: 'application/json' }
    }, upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
    });

    upstream.on('error', err => {
        appendLog('agent_task_proxy_error', { agent: agentName, error: err?.message || String(err) });
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
    });
    upstream.end();
}
```

### processRequest(req, res)

**Purpose**: Main request processor - routes to appropriate handler

**Implementation Flow**:
```
Request
    │
    ├─► /health → Return health data (no auth)
    │
    ├─► /MCPBrowserClient.js → Serve client file
    │
    ├─► /auth/* → Handle auth routes
    │
    ├─► /mcps/* or /mcp/* → Agent MCP (agent/user auth)
    │       │
    │       ├─► /mcps/<agent>/task → Proxy task status
    │       │
    │       └─► /mcps/<agent>/mcp → Handle MCP request
    │
    ├─► Ensure authenticated for protected routes
    │
    ├─► /webtty → handleWebTTY()
    │
    ├─► /webchat → handleWebChat()
    │
    ├─► /dashboard → handleDashboard()
    │
    ├─► /webmeet → handleWebMeet()
    │
    ├─► /status → handleStatus()
    │
    ├─► /blobs → handleBlobs()
    │
    ├─► /mcp → handleRouterMcp()
    │
    └─► Static files / 404
```

## Route Handlers

| Route | Handler | Auth Required | Description |
|-------|---------|---------------|-------------|
| `/health` | inline | No | Health check endpoint |
| `/MCPBrowserClient.js` | `serveMcpBrowserClient` | No | MCP client JavaScript |
| `/auth/*` | `handleAuthRoutes` | No | Authentication endpoints |
| `/webtty/*` | `handleWebTTY` | Yes | WebTTY terminal |
| `/webchat/*` | `handleWebChat` | Yes | WebChat interface |
| `/dashboard/*` | `handleDashboard` | Yes | Dashboard UI |
| `/webmeet/*` | `handleWebMeet` | Yes | WebMeet conferencing |
| `/status/*` | `handleStatus` | Yes | Status endpoint |
| `/blobs/*` | `handleBlobs` | Yes | Blob storage |
| `/mcp` | `handleRouterMcp` | Yes | Router MCP endpoint |
| `/mcps/<agent>/mcp` | `handleAgentMcpRequest` | Yes | Agent MCP proxy |
| `/mcps/<agent>/task` | `proxyAgentTaskStatus` | Yes | Task status proxy |

## Server Configuration

```javascript
// Create HTTP server
const server = http.createServer((req, res) => {
    processRequest(req, res).catch(err => {
        appendLog('request_error', { error: err?.message || String(err) });
        if (!res.headersSent) {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
            } catch (_) {
                try { res.end(); } catch (_) { }
            }
        }
    });
});

// Setup process lifecycle management
const lifecycle = setupProcessLifecycle(server, globalState, agentSessionStore);
```

## Health Check Endpoint

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "healthy",
  "uptime": 3600.5,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "pid": 12345,
  "memory": {
    "rss": 52428800,
    "heapUsed": 20971520,
    "heapTotal": 41943040,
    "rssMB": 50,
    "heapUsedMB": 20
  },
  "activeSessions": {
    "webtty": 2,
    "webchat": 1,
    "dashboard": 0,
    "webmeet": 0,
    "status": 1,
    "agent": 3
  }
}
```

## Error Handling

- Server errors logged via `appendLog`
- `EADDRINUSE`: Exit with code 2
- `EACCES`: Exit with code 2
- Request errors return 500 with JSON error
- Stream errors handled gracefully

## Global Process Kill Safety

```javascript
// Prevents killing process 0 or self
if (!global.processKill) {
    global.processKill = function (pid, signal) {
        if (pid === 0 || pid === process.pid || pid === (-process.pid)) {
            try { console.error("Cannot kill process 0 or self"); } catch (_) {}
            return;
        }
        safeLog(`Killing process ${pid} with signal ${signal}`);
        process.kill(pid, signal);
    }
}
```

## Integration Points

- All handlers in `handlers/` directory
- Authentication via `authHandlers.js`
- MCP proxy via `mcp-proxy/index.js`
- Static serving via `static/index.js`
- Logging via `utils/logger.js`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port |

## Usage

The routing server is started by the CLI:

```bash
ploinky start <agent> <port>
```

This spawns the RoutingServer as a child process.

## Related Modules

- [server-auth-handlers.md](./auth/server-auth-handlers.md) - Authentication
- [server-handlers-webtty.md](./handlers/server-handlers-webtty.md) - WebTTY
- [server-handlers-webchat.md](./handlers/server-handlers-webchat.md) - WebChat
- [mcp-proxy-index.md](./mcp-proxy/mcp-proxy-index.md) - MCP proxy
