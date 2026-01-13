# cli/server/AgentClient.js - MCP Agent Client

## Overview

Minimal MCP client wrapper for communicating with agent containers. Provides factory function that returns methods for MCP interactions including tool listing, tool calling, resource access, and health checks.

## Source File

`cli/server/AgentClient.js`

## Dependencies

```javascript
import { client as mcpClient, StreamableHTTPClientTransport } from 'mcp-sdk';
const { Client } = mcpClient;
```

## Public API

### createAgentClient(baseUrl)

**Purpose**: Creates an MCP client for an agent endpoint

**Parameters**:
- `baseUrl` (string): Base URL of the agent MCP server

**Returns**: Agent client object with methods:

```javascript
{
    connect: () => Promise<void>,
    listTools: () => Promise<Tool[]>,
    callTool: (name: string, args?: object) => Promise<any>,
    listResources: () => Promise<Resource[]>,
    readResource: (uri: string) => Promise<any>,
    ping: () => Promise<any>,
    close: () => Promise<void>
}
```

**Implementation**:
```javascript
function createAgentClient(baseUrl) {
    let client = null;
    let transport = null;
    let connected = false;

    async function connect() {
        if (connected && client && transport) return;
        transport = new StreamableHTTPClientTransport(new URL(baseUrl));
        client = new Client({ name: 'ploinky-router', version: '1.0.0' });
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
        try { if (client) await client.close(); } catch (_) {}
        try { if (transport) await transport.close?.(); } catch (_) {}
        connected = false;
        client = null;
        transport = null;
    }

    return { connect, listTools, callTool, listResources, readResource, ping, close };
}
```

## Client Methods

### connect()

**Purpose**: Establishes MCP connection to agent

**Returns**: (Promise<void>)

**Behavior**:
- Creates StreamableHTTPClientTransport with base URL
- Creates MCP Client with router identity
- Connects client to transport
- Skips if already connected

### listTools()

**Purpose**: Lists available tools from agent

**Returns**: (Promise<Tool[]>) Array of tool definitions

**Tool Structure**:
```javascript
{
    name: string,
    description: string,
    inputSchema: object
}
```

### callTool(name, args)

**Purpose**: Invokes a tool on the agent

**Parameters**:
- `name` (string): Tool name
- `args` (Object): Tool arguments (optional)

**Returns**: (Promise<any>) Tool execution result

### listResources()

**Purpose**: Lists available resources from agent

**Returns**: (Promise<Resource[]>) Array of resource definitions

**Resource Structure**:
```javascript
{
    uri: string,
    name: string,
    description: string,
    mimeType: string
}
```

### readResource(uri)

**Purpose**: Reads a resource from the agent

**Parameters**:
- `uri` (string): Resource URI

**Returns**: (Promise<any>) Resource content

### ping()

**Purpose**: Health check for agent connection

**Returns**: (Promise<any>) Ping response

### close()

**Purpose**: Closes MCP connection and cleans up

**Returns**: (Promise<void>)

**Behavior**:
- Closes client connection
- Closes transport
- Resets state variables

## Exports

```javascript
export { createAgentClient };
```

## Usage Example

```javascript
import { createAgentClient } from './AgentClient.js';

// Create client for agent on port 7000
const client = createAgentClient('http://127.0.0.1:7000');

try {
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:', tools.map(t => t.name));

    // Call a tool
    const result = await client.callTool('processFile', {
        path: '/data/input.txt'
    });
    console.log('Result:', result);

    // List resources
    const resources = await client.listResources();
    console.log('Resources:', resources.map(r => r.uri));

    // Read a resource
    const content = await client.readResource('file://config.json');
    console.log('Config:', content);

    // Check health
    const pong = await client.ping();
    console.log('Agent is alive');

} finally {
    // Always close connection
    await client.close();
}
```

## Connection Lifecycle

```
┌─────────────────┐
│    Created      │
│   (no conn)     │
└────────┬────────┘
         │ connect()
         ▼
┌─────────────────┐
│   Connected     │◄──────┐
│  (active conn)  │       │
└────────┬────────┘       │
         │                │ auto-reconnect
         │ listTools()    │ on method call
         │ callTool()     │
         │ etc.           │
         │                │
         │ close()        │
         ▼                │
┌─────────────────┐       │
│    Closed       │───────┘
│   (no conn)     │
└─────────────────┘
```

## Error Handling

- Connection errors propagate to caller
- Method calls auto-connect if needed
- close() silently catches cleanup errors
- Transport errors close connection state

## Client Identity

The client identifies itself to agents as:
```javascript
{
    name: 'ploinky-router',
    version: '1.0.0'
}
```

## Related Modules

- [server-routing-server.md](./server-routing-server.md) - Uses client for agent routing
- [server-mcp-proxy-index.md](./mcp-proxy/server-mcp-proxy-index.md) - MCP proxy layer
- [commands-client.md](../commands/commands-client.md) - CLI client commands
