# Agent/client/AgentMcpClient.mjs - Agent-to-Agent MCP Client

## Overview

MCP client helper for agents to call other agents via RoutingServer. Uses StreamableHTTPClientTransport with OAuth token management for authenticated agent-to-agent communication.

## Source File

`Agent/client/AgentMcpClient.mjs`

## Dependencies

```javascript
import { client as mcpClient, StreamableHTTPClientTransport } from 'mcp-sdk';
import http from 'http';
import https from 'https';

const { Client } = mcpClient;
```

## Module State

```javascript
// Token cache
let cachedToken = null;
let tokenExpiresAt = 0;
```

## Public API

### getRouterUrl()

**Purpose**: Gets router URL from environment variables

**Returns**: (string) Router URL

```javascript
export function getRouterUrl() {
    const routerUrl = process.env.PLOINKY_ROUTER_URL;
    if (routerUrl && typeof routerUrl === 'string' && routerUrl.trim()) {
        return routerUrl.trim();
    }
    const routerPort = process.env.PLOINKY_ROUTER_PORT || '8080';
    return `http://127.0.0.1:${routerPort}`;
}
```

### getAgentMcpUrl(agentName)

**Purpose**: Constructs MCP endpoint URL for target agent

**Parameters**:
- `agentName` (string): Target agent identifier

**Returns**: (string) Full MCP endpoint URL

```javascript
export function getAgentMcpUrl(agentName) {
    const routerUrl = getRouterUrl();
    return `${routerUrl}/mcps/${agentName}/mcp`;
}
```

### getAgentAccessToken()

**Purpose**: Retrieves OAuth access token for agent authentication with caching

**Returns**: (Promise<string>) Access token

**Token Lifecycle**:
1. Check if cached token exists and is still valid (60s buffer)
2. If valid, return cached token
3. Otherwise, request new token from router's `/auth/agent-token` endpoint
4. Cache token with expiration time

```javascript
export async function getAgentAccessToken() {
    const now = Date.now();

    // Return cached token if still valid (with 60 second buffer)
    if (cachedToken && tokenExpiresAt > now + 60000) {
        return cachedToken;
    }

    const clientId = process.env.PLOINKY_AGENT_CLIENT_ID;
    const clientSecret = process.env.PLOINKY_AGENT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('PLOINKY_AGENT_CLIENT_ID and PLOINKY_AGENT_CLIENT_SECRET must be set');
    }

    const routerUrl = getRouterUrl();
    const tokenUrl = `${routerUrl}/auth/agent-token`;

    // Request token from router
    const tokenData = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ client_id: clientId, client_secret: clientSecret });
        const url = new URL(tokenUrl);
        const httpModule = url.protocol === 'https:' ? https : http;
        const pathWithQuery = `${url.pathname}${url.search || ''}`;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: pathWithQuery,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = httpModule.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const responseText = Buffer.concat(chunks).toString('utf8');
                try {
                    const parsed = JSON.parse(responseText);
                    if (!parsed.ok) {
                        reject(new Error(parsed.error || 'Token request failed'));
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`Invalid token response: ${responseText}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });

    cachedToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600;
    tokenExpiresAt = now + (expiresIn * 1000);

    return cachedToken;
}
```

### createAgentClient(agentName)

**Purpose**: Creates MCP client for calling another agent via router

**Parameters**:
- `agentName` (string): Target agent identifier

**Returns**: (Promise<Object>) Client interface

**Client Interface**:
- `connect()` - Establishes connection
- `listTools()` - Lists available tools
- `callTool(name, args)` - Invokes a tool
- `listResources()` - Lists available resources
- `readResource(uri)` - Reads a resource
- `ping()` - Pings the server
- `close()` - Closes connection

```javascript
export async function createAgentClient(agentName) {
    const agentUrl = getAgentMcpUrl(agentName);
    let client = null;
    let transport = null;
    let connected = false;

    // Get OAuth token
    const accessToken = await getAgentAccessToken();

    async function connect() {
        if (connected && client && transport) return;

        // Create transport with Authorization header in requestInit
        const url = new URL(agentUrl);
        transport = new StreamableHTTPClientTransport(url, {
            requestInit: {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        });

        client = new Client({ name: 'ploinky-agent-client', version: '1.0.0' });
        await client.connect(transport);
        connected = true;
    }

    async function listTools() {
        await connect();
        const { tools } = await client.listTools({});
        return tools || [];
    }

    async function callTool(name, args) {
        await connect();
        const result = await client.callTool({ name, arguments: args || {} });
        return result;
    }

    async function listResources() {
        await connect();
        const { resources } = await client.listResources({});
        return resources || [];
    }

    async function readResource(uri) {
        await connect();
        const res = await client.readResource({ uri });
        return res?.resource ?? res;
    }

    async function ping() {
        await connect();
        return await client.ping();
    }

    async function close() {
        try {
            if (client) await client.close();
        } catch (_) {}
        try {
            if (transport) await transport.close?.();
        } catch (_) {}
        connected = false;
        client = null;
        transport = null;
    }

    return { connect, listTools, callTool, listResources, readResource, ping, close };
}
```

## Test Helper

### __resetAgentClientTestState()

**Purpose**: Resets cached token state for automated tests

```javascript
export function __resetAgentClientTestState() {
    cachedToken = null;
    tokenExpiresAt = 0;
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLOINKY_ROUTER_URL` | Full router URL | - |
| `PLOINKY_ROUTER_PORT` | Router port (if URL not set) | 8080 |
| `PLOINKY_AGENT_CLIENT_ID` | OAuth client ID | Required |
| `PLOINKY_AGENT_CLIENT_SECRET` | OAuth client secret | Required |

## Token Request Flow

```
┌─────────────────────────────────────────────────────────┐
│                Token Acquisition Flow                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  getAgentAccessToken()                                  │
│       │                                                 │
│       ├── Check cache (token + 60s buffer)              │
│       │        │                                        │
│       │        ├── Valid → Return cached token          │
│       │        │                                        │
│       │        └── Expired/Missing                      │
│       │                 │                               │
│       │                 ▼                               │
│       │         POST /auth/agent-token                  │
│       │         Body: { client_id, client_secret }      │
│       │                 │                               │
│       │                 ▼                               │
│       │         Response: { ok, access_token,           │
│       │                     expires_in }                │
│       │                 │                               │
│       │                 ▼                               │
│       │         Cache token + expiration                │
│       │                 │                               │
│       └─────────────────┴── Return token                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## MCP Client Flow

```
┌─────────────────────────────────────────────────────────┐
│              Agent-to-Agent Communication                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Agent A                  Router              Agent B   │
│     │                       │                     │     │
│     │ createAgentClient('B')│                     │     │
│     ├──────────────────────►│                     │     │
│     │                       │                     │     │
│     │ callTool('x', args)   │                     │     │
│     │ [Authorization: Bearer token]               │     │
│     ├──────────────────────►│                     │     │
│     │                       │ POST /mcps/B/mcp    │     │
│     │                       ├────────────────────►│     │
│     │                       │                     │     │
│     │                       │◄────────────────────┤     │
│     │                       │   Tool result       │     │
│     │◄──────────────────────┤                     │     │
│     │   Tool result         │                     │     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing client credentials | Throws Error with credential message |
| Token request fails | Throws Error with response details |
| Invalid token response | Throws Error with response text |
| Connection failure | Propagates MCP client error |
| Close errors | Silently ignored |

## Related Modules

- [agent-server.md](../server/agent-server.md) - Target agent server
- [../../cli/server/server-routing-server.md](../../cli/server/server-routing-server.md) - Router
