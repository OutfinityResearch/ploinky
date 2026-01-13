# cli/server/mcp-proxy/index.js - MCP Proxy

## Overview

Provides MCP (Model Context Protocol) proxy functionality for routing requests to agent containers. Implements JSON-RPC 2.0 protocol handling, session management, and agent authorization.

## Source File

`cli/server/mcp-proxy/index.js`

## Dependencies

```javascript
import { randomUUID } from 'node:crypto';
import { sendJson } from '../authHandlers.js';
import { createAgentClient } from '../AgentClient.js';
```

## Constants

```javascript
const AGENT_PROXY_PROTOCOL_VERSION = '2025-06-18';
const AGENT_PROXY_SERVER_INFO = { name: 'ploinky-router-proxy', version: '1.0.0' };

// Session store for agent MCP connections
const agentSessionStore = new Map();
```

## Internal Functions

### readAgentSessionId(req)

**Purpose**: Reads MCP session ID from request headers

**Parameters**:
- `req` (http.IncomingMessage): HTTP request

**Returns**: (string|null) Session ID

**Header**: `mcp-session-id`

### isJsonRpcPayload(payload)

**Purpose**: Checks if payload is valid JSON-RPC

**Parameters**:
- `payload` (any): Request payload

**Returns**: (boolean) True if valid JSON-RPC

### handleAgentJsonRpc(req, res, route, agentName, payload)

**Purpose**: Handles JSON-RPC requests to agent MCP endpoints

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `route` (Object): Routing information with hostPort
- `agentName` (string): Target agent name
- `payload` (Object): JSON-RPC payload

**Supported Methods**:

| Method | Description |
|--------|-------------|
| `initialize` | Creates new session |
| `notifications/initialized` | Acknowledgment (204) |
| `tools/list` | Lists agent tools |
| `tools/call` | Calls an agent tool |
| `resources/list` | Lists agent resources |
| `resources/read` | Reads agent resource |
| `ping` | Health check |

**Implementation**:
```javascript
async function handleAgentJsonRpc(req, res, route, agentName, payload) {
    const isBatch = Array.isArray(payload);
    const messages = isBatch ? payload : [payload];
    if (messages.length !== 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Batch requests are not supported' }, id: null }));
        return;
    }

    const message = messages[0];
    const baseUrl = `http://127.0.0.1:${route.hostPort}/mcp`;

    const sessionIdHeader = readAgentSessionId(req);
    const sessionEntry = sessionIdHeader ? agentSessionStore.get(sessionIdHeader) : null;

    if (message.method === 'initialize') {
        const newSessionId = randomUUID();
        agentSessionStore.set(newSessionId, { agentName, baseUrl });
        sendResponse(200, {
            jsonrpc: '2.0',
            id: message.id ?? null,
            result: {
                protocolVersion: AGENT_PROXY_PROTOCOL_VERSION,
                capabilities: {
                    tools: { listChanged: false },
                    resources: { listChanged: false }
                },
                serverInfo: { ...AGENT_PROXY_SERVER_INFO, name: `${AGENT_PROXY_SERVER_INFO.name}:${agentName}` }
            }
        }, newSessionId);
        return;
    }

    // ... handle other methods
}
```

## Public API

### handleAgentMcpRequest(req, res, route, agentName)

**Purpose**: Main handler for agent MCP requests

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `route` (Object): Routing information
- `agentName` (string): Target agent name

**HTTP Methods**:

| Method | Action |
|--------|--------|
| POST | Process JSON-RPC request |
| DELETE | Delete session |
| GET | Not supported (405) |

**Agent Authorization**:
- Checks `req.agent.allowedTargets` if agent auth used
- Allows if targets include `'*'` or agent name
- Returns 403 if not authorized

**Implementation**:
```javascript
function handleAgentMcpRequest(req, res, route, agentName) {
    const method = (req.method || 'GET').toUpperCase();

    // Check agent authorization
    if (req.agent) {
        const allowedTargets = req.agent.allowedTargets || [];
        const isAllowed = allowedTargets.includes('*') || allowedTargets.includes(agentName);
        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'forbidden',
                detail: `Agent '${req.agent.name}' is not authorized to access agent '${agentName}'`
            }));
            return;
        }
    }

    if (method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, DELETE' });
        res.end(JSON.stringify({ error: 'event_stream_not_supported' }));
        return;
    }

    if (method === 'DELETE') {
        const sessionId = readAgentSessionId(req);
        if (sessionId) {
            agentSessionStore.delete(sessionId);
        }
        res.writeHead(204);
        res.end();
        return;
    }

    // POST handling...
}
```

## Exports

```javascript
export {
    agentSessionStore,
    handleAgentMcpRequest,
    readAgentSessionId,
    isJsonRpcPayload,
    handleAgentJsonRpc
};
```

## MCP Protocol Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Session Flow                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                    Router Proxy                Agent    │
│    │                           │                          │     │
│    │── POST initialize ───────►│                          │     │
│    │                           │ Create session           │     │
│    │◄── 200 + session-id ─────│                          │     │
│    │                           │                          │     │
│    │── POST tools/list ───────►│                          │     │
│    │   (mcp-session-id)        │── AgentClient ──────────►│     │
│    │                           │◄─────────────────────────│     │
│    │◄── 200 tools ────────────│                          │     │
│    │                           │                          │     │
│    │── POST tools/call ───────►│                          │     │
│    │   (tool name + args)      │── AgentClient.callTool ─►│     │
│    │                           │◄─────────────────────────│     │
│    │◄── 200 result ───────────│                          │     │
│    │                           │                          │     │
│    │── DELETE ────────────────►│                          │     │
│    │                           │ Delete session           │     │
│    │◄── 204 ──────────────────│                          │     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## JSON-RPC Request Format

### Initialize

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": { "name": "my-client", "version": "1.0.0" }
    }
}
```

### Tools/Call

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
        "name": "processFile",
        "arguments": {
            "path": "/data/input.txt"
        }
    }
}
```

## Response Headers

- `Content-Type: application/json`
- `mcp-protocol-version: 2025-06-18`
- `mcp-session-id: <uuid>` (after initialize)

## Error Codes

| Code | Message |
|------|---------|
| -32600 | Invalid Request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32000 | Generic error (session, proxy errors) |

## Usage Example

```javascript
// Client-side usage (not part of this module)
const response = await fetch('http://localhost:8080/agent/node-dev/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
    })
});

const result = await response.json();
const sessionId = response.headers.get('mcp-session-id');

// Subsequent requests include session ID
const toolsResponse = await fetch('http://localhost:8080/agent/node-dev/mcp', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId
    },
    body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
    })
});
```

## Related Modules

- [server-agent-client.md](../server-agent-client.md) - Agent MCP client
- [server-routing-server.md](../server-routing-server.md) - Request routing
- [server-auth-handlers.md](../server-auth-handlers.md) - Authentication
