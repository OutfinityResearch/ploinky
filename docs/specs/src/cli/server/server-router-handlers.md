# cli/server/routerHandlers.js - Router Handlers

## Overview

Implements MCP JSON-RPC 2.0 protocol handling for the router server. Provides tool and resource aggregation across multiple agents, session management, and command execution routing.

## Source File

`cli/server/routerHandlers.js`

## Dependencies

```javascript
import { sendJson } from './authHandlers.js';
import { createAgentClient } from './AgentClient.js';
import { appendLog } from './utils/logger.js';
import { getEnabledAgents } from '../services/agents.js';
import { randomUUID } from 'node:crypto';
```

## Constants

```javascript
// Router protocol version
const ROUTER_PROTOCOL_VERSION = '2025-06-18';

// Router server info
const ROUTER_SERVER_INFO = {
    name: 'ploinky-router',
    version: '1.0.0'
};

// Session storage - Map of sessionId to session data
const routerSessions = new Map();

// Session timeout (30 minutes)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
```

## Data Structures

```javascript
/**
 * @typedef {Object} RouterSession
 * @property {string} id - Session identifier
 * @property {number} createdAt - Creation timestamp
 * @property {number} lastAccess - Last access timestamp
 * @property {Map<string, AgentConnection>} agents - Connected agents
 * @property {Object} capabilities - Aggregated capabilities
 */

/**
 * @typedef {Object} AgentConnection
 * @property {string} name - Agent name
 * @property {string} baseUrl - Agent MCP endpoint
 * @property {number} hostPort - Agent host port
 * @property {boolean} available - Agent availability status
 * @property {Object[]} tools - Agent's tools
 * @property {Object[]} resources - Agent's resources
 */

/**
 * @typedef {Object} AnnotatedTool
 * @property {string} name - Original tool name
 * @property {string} qualifiedName - agent:toolName format
 * @property {string} agentName - Source agent
 * @property {string} description - Tool description
 * @property {Object} inputSchema - JSON schema for inputs
 */

/**
 * @typedef {Object} AnnotatedResource
 * @property {string} uri - Resource URI
 * @property {string} qualifiedUri - agent://agentName/path format
 * @property {string} agentName - Source agent
 * @property {string} name - Resource name
 * @property {string} mimeType - Content type
 */
```

## Internal Functions

### cleanupExpiredSessions()

**Purpose**: Removes expired sessions from storage

**Implementation**:
```javascript
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of routerSessions) {
        if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
            routerSessions.delete(sessionId);
            appendLog(`[router] Session ${sessionId} expired`);
        }
    }
}
```

### getSession(sessionId)

**Purpose**: Retrieves session and updates last access time

**Parameters**:
- `sessionId` (string): Session identifier

**Returns**: (RouterSession|null) Session object or null

**Implementation**:
```javascript
function getSession(sessionId) {
    const session = routerSessions.get(sessionId);
    if (session) {
        session.lastAccess = Date.now();
    }
    return session;
}
```

### annotateToolsWithAgent(tools, agentName)

**Purpose**: Adds agent metadata to tool definitions

**Parameters**:
- `tools` (Object[]): Tool definitions
- `agentName` (string): Source agent name

**Returns**: (AnnotatedTool[]) Tools with agent annotations

**Implementation**:
```javascript
function annotateToolsWithAgent(tools, agentName) {
    return tools.map(tool => ({
        ...tool,
        qualifiedName: `${agentName}:${tool.name}`,
        agentName,
        _originalName: tool.name
    }));
}
```

### annotateResourcesWithAgent(resources, agentName)

**Purpose**: Adds agent metadata to resource definitions

**Parameters**:
- `resources` (Object[]): Resource definitions
- `agentName` (string): Source agent name

**Returns**: (AnnotatedResource[]) Resources with agent annotations

**Implementation**:
```javascript
function annotateResourcesWithAgent(resources, agentName) {
    return resources.map(resource => ({
        ...resource,
        qualifiedUri: `agent://${agentName}${resource.uri}`,
        agentName,
        _originalUri: resource.uri
    }));
}
```

### parseQualifiedName(qualifiedName)

**Purpose**: Parses agent:toolName format

**Parameters**:
- `qualifiedName` (string): Qualified name string

**Returns**: `{ agentName: string, toolName: string }` or null

**Implementation**:
```javascript
function parseQualifiedName(qualifiedName) {
    const colonIndex = qualifiedName.indexOf(':');
    if (colonIndex === -1) {
        return null;
    }
    return {
        agentName: qualifiedName.substring(0, colonIndex),
        toolName: qualifiedName.substring(colonIndex + 1)
    };
}
```

### parseQualifiedUri(qualifiedUri)

**Purpose**: Parses agent://agentName/path format

**Parameters**:
- `qualifiedUri` (string): Qualified URI string

**Returns**: `{ agentName: string, resourceUri: string }` or null

**Implementation**:
```javascript
function parseQualifiedUri(qualifiedUri) {
    const match = qualifiedUri.match(/^agent:\/\/([^/]+)(.*)$/);
    if (!match) {
        return null;
    }
    return {
        agentName: match[1],
        resourceUri: match[2] || '/'
    };
}
```

### discoverAgentCapabilities(agentName, hostPort)

**Purpose**: Discovers tools and resources from an agent

**Parameters**:
- `agentName` (string): Agent name
- `hostPort` (number): Agent host port

**Returns**: (Promise<Object>) Agent capabilities

**Implementation**:
```javascript
async function discoverAgentCapabilities(agentName, hostPort) {
    const client = createAgentClient({ hostPort });

    try {
        const [toolsResponse, resourcesResponse] = await Promise.all([
            client.listTools(),
            client.listResources()
        ]);

        return {
            available: true,
            tools: toolsResponse.tools || [],
            resources: resourcesResponse.resources || []
        };
    } catch (err) {
        appendLog(`[router] Failed to discover ${agentName}: ${err.message}`);
        return {
            available: false,
            tools: [],
            resources: [],
            error: err.message
        };
    }
}
```

### aggregateCapabilities(session)

**Purpose**: Aggregates all agent capabilities for a session

**Parameters**:
- `session` (RouterSession): Session object

**Returns**: (Object) Aggregated capabilities

**Implementation**:
```javascript
function aggregateCapabilities(session) {
    const allTools = [];
    const allResources = [];

    for (const [agentName, agent] of session.agents) {
        if (!agent.available) continue;

        const annotatedTools = annotateToolsWithAgent(agent.tools, agentName);
        const annotatedResources = annotateResourcesWithAgent(agent.resources, agentName);

        allTools.push(...annotatedTools);
        allResources.push(...annotatedResources);
    }

    return {
        tools: allTools,
        resources: allResources,
        agentCount: session.agents.size
    };
}
```

## Public API

### handleRouterInitialize(req, res, payload)

**Purpose**: Initializes router session with MCP protocol

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `payload` (Object): JSON-RPC initialize payload

**Request**:
```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": { "name": "client", "version": "1.0.0" }
    }
}
```

**Response**:
```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": "2025-06-18",
        "capabilities": {
            "tools": { "listChanged": false },
            "resources": { "listChanged": false }
        },
        "serverInfo": { "name": "ploinky-router", "version": "1.0.0" }
    }
}
```

**Implementation**:
```javascript
export async function handleRouterInitialize(req, res, payload) {
    cleanupExpiredSessions();

    const sessionId = randomUUID();
    const session = {
        id: sessionId,
        createdAt: Date.now(),
        lastAccess: Date.now(),
        agents: new Map(),
        capabilities: null
    };

    // Discover all enabled agents
    const enabledAgents = getEnabledAgents();
    const discoveryPromises = [];

    for (const agent of enabledAgents) {
        if (!agent.hostPort) continue;

        discoveryPromises.push(
            discoverAgentCapabilities(agent.name, agent.hostPort)
                .then(caps => ({
                    name: agent.name,
                    baseUrl: `http://127.0.0.1:${agent.hostPort}/mcp`,
                    hostPort: agent.hostPort,
                    ...caps
                }))
        );
    }

    const agentResults = await Promise.all(discoveryPromises);

    for (const agent of agentResults) {
        session.agents.set(agent.name, agent);
    }

    session.capabilities = aggregateCapabilities(session);
    routerSessions.set(sessionId, session);

    appendLog(`[router] Session ${sessionId} created with ${session.agents.size} agents`);

    res.setHeader('mcp-session-id', sessionId);
    res.setHeader('mcp-protocol-version', ROUTER_PROTOCOL_VERSION);

    sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        result: {
            protocolVersion: ROUTER_PROTOCOL_VERSION,
            capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false }
            },
            serverInfo: ROUTER_SERVER_INFO
        }
    });
}
```

### handleRouterListTools(req, res, payload, sessionId)

**Purpose**: Lists aggregated tools from all agents

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `payload` (Object): JSON-RPC payload
- `sessionId` (string): Session identifier

**Response**:
```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "tools": [
            {
                "name": "readFile",
                "qualifiedName": "node-dev:readFile",
                "agentName": "node-dev",
                "description": "Read file contents",
                "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } }
            }
        ]
    }
}
```

**Implementation**:
```javascript
export function handleRouterListTools(req, res, payload, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: 'Session not found or expired' }
        });
        return;
    }

    sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        result: {
            tools: session.capabilities.tools
        }
    });
}
```

### handleRouterListResources(req, res, payload, sessionId)

**Purpose**: Lists aggregated resources from all agents

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `payload` (Object): JSON-RPC payload
- `sessionId` (string): Session identifier

**Implementation**:
```javascript
export function handleRouterListResources(req, res, payload, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: 'Session not found or expired' }
        });
        return;
    }

    sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        result: {
            resources: session.capabilities.resources
        }
    });
}
```

### handleRouterCallTool(req, res, payload, sessionId)

**Purpose**: Routes tool call to appropriate agent

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `payload` (Object): JSON-RPC tools/call payload
- `sessionId` (string): Session identifier

**Request**:
```json
{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
        "name": "node-dev:readFile",
        "arguments": { "path": "/code/index.js" }
    }
}
```

**Implementation**:
```javascript
export async function handleRouterCallTool(req, res, payload, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: 'Session not found or expired' }
        });
        return;
    }

    const { name: qualifiedName, arguments: args } = payload.params || {};

    if (!qualifiedName) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32602, message: 'Missing tool name' }
        });
        return;
    }

    const parsed = parseQualifiedName(qualifiedName);
    if (!parsed) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32602, message: `Invalid qualified name: ${qualifiedName}` }
        });
        return;
    }

    const { agentName, toolName } = parsed;
    const agent = session.agents.get(agentName);

    if (!agent) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: `Agent not found: ${agentName}` }
        });
        return;
    }

    if (!agent.available) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: `Agent unavailable: ${agentName}` }
        });
        return;
    }

    try {
        const client = createAgentClient({ hostPort: agent.hostPort });
        const result = await client.callTool(toolName, args);

        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            result
        });
    } catch (err) {
        appendLog(`[router] Tool call failed: ${agentName}:${toolName} - ${err.message}`);
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: `Tool call failed: ${err.message}` }
        });
    }
}
```

### handleRouterReadResource(req, res, payload, sessionId)

**Purpose**: Routes resource read to appropriate agent

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `payload` (Object): JSON-RPC resources/read payload
- `sessionId` (string): Session identifier

**Request**:
```json
{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "resources/read",
    "params": {
        "uri": "agent://node-dev/logs/app.log"
    }
}
```

**Implementation**:
```javascript
export async function handleRouterReadResource(req, res, payload, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: 'Session not found or expired' }
        });
        return;
    }

    const { uri: qualifiedUri } = payload.params || {};

    if (!qualifiedUri) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32602, message: 'Missing resource URI' }
        });
        return;
    }

    const parsed = parseQualifiedUri(qualifiedUri);
    if (!parsed) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32602, message: `Invalid qualified URI: ${qualifiedUri}` }
        });
        return;
    }

    const { agentName, resourceUri } = parsed;
    const agent = session.agents.get(agentName);

    if (!agent || !agent.available) {
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: `Agent not available: ${agentName}` }
        });
        return;
    }

    try {
        const client = createAgentClient({ hostPort: agent.hostPort });
        const result = await client.readResource(resourceUri);

        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            result
        });
    } catch (err) {
        appendLog(`[router] Resource read failed: ${agentName}:${resourceUri} - ${err.message}`);
        sendJson(res, 200, {
            jsonrpc: '2.0',
            id: payload.id ?? null,
            error: { code: -32000, message: `Resource read failed: ${err.message}` }
        });
    }
}
```

### handleRouterPing(req, res, payload, sessionId)

**Purpose**: Handles ping request for health check

**Implementation**:
```javascript
export function handleRouterPing(req, res, payload, sessionId) {
    const session = sessionId ? getSession(sessionId) : null;

    sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        result: {
            status: 'ok',
            sessionActive: !!session,
            timestamp: Date.now()
        }
    });
}
```

### executeRouterCommand(req, res, sessionId, command, params)

**Purpose**: Executes router commands (list_tools, list_resources, tool, resources/read, ping)

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `sessionId` (string): Session identifier
- `command` (string): Command to execute
- `params` (Object): Command parameters

**Implementation**:
```javascript
export async function executeRouterCommand(req, res, sessionId, command, params = {}) {
    const payload = {
        jsonrpc: '2.0',
        id: params.id ?? 1,
        method: command,
        params
    };

    switch (command) {
        case 'initialize':
            return handleRouterInitialize(req, res, payload);

        case 'tools/list':
        case 'list_tools':
            return handleRouterListTools(req, res, payload, sessionId);

        case 'resources/list':
        case 'list_resources':
            return handleRouterListResources(req, res, payload, sessionId);

        case 'tools/call':
        case 'tool':
            return handleRouterCallTool(req, res, payload, sessionId);

        case 'resources/read':
            return handleRouterReadResource(req, res, payload, sessionId);

        case 'ping':
            return handleRouterPing(req, res, payload, sessionId);

        default:
            sendJson(res, 200, {
                jsonrpc: '2.0',
                id: payload.id,
                error: { code: -32601, message: `Method not found: ${command}` }
            });
    }
}
```

### handleRouterRequest(req, res)

**Purpose**: Main entry point for router JSON-RPC requests

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response

**Implementation**:
```javascript
export async function handleRouterRequest(req, res) {
    const sessionId = req.headers['mcp-session-id'];

    // Collect body
    let body = '';
    for await (const chunk of req) {
        body += chunk;
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch (err) {
        sendJson(res, 400, {
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null
        });
        return;
    }

    // Validate JSON-RPC
    if (!payload.jsonrpc || payload.jsonrpc !== '2.0') {
        sendJson(res, 400, {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request' },
            id: payload.id ?? null
        });
        return;
    }

    const method = payload.method;

    // Initialize doesn't require session
    if (method === 'initialize') {
        return handleRouterInitialize(req, res, payload);
    }

    // Other methods require valid session
    return executeRouterCommand(req, res, sessionId, method, payload.params);
}
```

## Exports

```javascript
export {
    routerSessions,
    handleRouterInitialize,
    handleRouterListTools,
    handleRouterListResources,
    handleRouterCallTool,
    handleRouterReadResource,
    handleRouterPing,
    handleRouterRequest,
    executeRouterCommand
};
```

## Router MCP Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Router Aggregation Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client              Router                     Agents          │
│    │                   │                          │             │
│    │── initialize ────►│                          │             │
│    │                   │── discover agents ──────►│             │
│    │                   │◄─ tools/resources ───────│             │
│    │◄── capabilities ──│                          │             │
│    │                   │                          │             │
│    │── tools/list ────►│                          │             │
│    │◄── [aggregated] ──│                          │             │
│    │                   │                          │             │
│    │── tools/call ────►│                          │             │
│    │   agent:tool      │── route to agent ───────►│             │
│    │                   │◄─────────────────────────│             │
│    │◄── result ────────│                          │             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Qualified Name Format

Tools are exposed with qualified names in `agent:toolName` format:
- `node-dev:readFile` - readFile tool from node-dev agent
- `python-dev:runScript` - runScript tool from python-dev agent

Resources use `agent://agentName/path` URI format:
- `agent://node-dev/logs/app.log`
- `agent://python-dev/output/results.json`

## Usage Example

```javascript
// Initialize router session
const initResponse = await fetch('http://localhost:8080/router/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
    })
});

const sessionId = initResponse.headers.get('mcp-session-id');

// List all tools
const toolsResponse = await fetch('http://localhost:8080/router/mcp', {
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

// Call a tool on specific agent
const callResponse = await fetch('http://localhost:8080/router/mcp', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId
    },
    body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'node-dev:readFile',
            arguments: { path: '/code/package.json' }
        }
    })
});
```

## Related Modules

- [server-agent-client.md](./server-agent-client.md) - Agent MCP client
- [server-mcp-proxy-index.md](./mcp-proxy/server-mcp-proxy-index.md) - MCP proxy
- [service-agents.md](../services/agents/service-agents.md) - Agent management
