# DS07 - MCP Protocol Integration

## Summary

Ploinky uses the Model Context Protocol (MCP) for agent communication. MCP provides a standardized way for agents to expose tools, resources, and prompts, enabling inter-agent communication and client integration. This specification documents Ploinky's MCP implementation.

## Background / Problem Statement

Agents need a standard protocol for:
- Exposing capabilities (tools, resources)
- Receiving and processing requests
- Communicating with other agents
- Supporting LLM integration patterns

MCP (Model Context Protocol) provides this standardization.

## Goals

1. **MCP Compliance**: Follow MCP specification for tools, resources, prompts
2. **HTTP Transport**: Implement MCP over HTTP/SSE for web compatibility
3. **Agent-to-Agent**: Enable inter-agent communication via router
4. **Task Queue**: Support async task processing with concurrency control

## Non-Goals

- Custom protocol extensions
- gRPC transport (HTTP/SSE only)
- Protocol version negotiation (single version supported)

## Architecture Overview

### MCP Communication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
│  (Browser, CLI, or another Agent)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST /mcps/:agent/mcp
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ROUTER SERVER                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    MCP Proxy Handler                         ││
│  │  - Route by agent name                                       ││
│  │  - Forward to container port                                 ││
│  │  - Stream SSE responses                                      ││
│  └─────────────────────────────────────────────────────────────┘│
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST :7000/mcp
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT CONTAINER                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    AgentServer.mjs                           ││
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐               ││
│  │  │ MCP Server│  │ Task Queue│  │   Tools   │               ││
│  │  │ Protocol  │  │ Handler   │  │ Registry  │               ││
│  │  └───────────┘  └───────────┘  └───────────┘               ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### MCP Message Types

```javascript
/**
 * JSON-RPC 2.0 Request
 * @typedef {Object} MCPRequest
 * @property {string} jsonrpc - Always "2.0"
 * @property {string|number} id - Request ID
 * @property {string} method - Method name
 * @property {Object} [params] - Method parameters
 */

/**
 * JSON-RPC 2.0 Response
 * @typedef {Object} MCPResponse
 * @property {string} jsonrpc - Always "2.0"
 * @property {string|number} id - Matching request ID
 * @property {any} [result] - Success result
 * @property {MCPError} [error] - Error details
 */

/**
 * JSON-RPC 2.0 Error
 * @typedef {Object} MCPError
 * @property {number} code - Error code
 * @property {string} message - Error message
 * @property {any} [data] - Additional error data
 */
```

### MCP Tool Definition

```javascript
/**
 * Tool definition for MCP
 * @typedef {Object} Tool
 * @property {string} name - Unique tool name
 * @property {string} description - Human-readable description
 * @property {Object} inputSchema - JSON Schema for parameters
 */

/**
 * Example tool definition
 */
const exampleTool = {
  name: 'execute_code',
  description: 'Execute JavaScript code and return the result',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute'
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds',
        default: 30000
      }
    },
    required: ['code']
  }
};
```

### MCP Resource Definition

```javascript
/**
 * Resource definition for MCP
 * @typedef {Object} Resource
 * @property {string} uri - Resource URI
 * @property {string} name - Display name
 * @property {string} [description] - Description
 * @property {string} [mimeType] - Content type
 */

/**
 * Resource template for dynamic resources
 * @typedef {Object} ResourceTemplate
 * @property {string} uriTemplate - URI template with placeholders
 * @property {string} name - Display name
 * @property {string} [description] - Description
 */
```

## API Contracts

### MCP Methods

| Method | Description |
|--------|-------------|
| `initialize` | Initialize MCP session |
| `tools/list` | List available tools |
| `tools/call` | Call a tool |
| `resources/list` | List available resources |
| `resources/read` | Read a resource |
| `prompts/list` | List available prompts |
| `prompts/get` | Get prompt content |

### AgentServer Implementation

```javascript
// Agent/server/AgentServer.mjs

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { HttpServerTransport } from '@modelcontextprotocol/sdk/server/http.js';

/**
 * Ploinky Agent MCP Server
 */
export class AgentServer {
  constructor(options = {}) {
    this.port = options.port || 7000;
    this.concurrency = options.concurrency || 1;
    this.taskQueue = new TaskQueue({ concurrency: this.concurrency });

    // Create MCP server
    this.server = new Server({
      name: options.name || 'ploinky-agent',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    });

    this.setupHandlers();
  }

  /**
   * Setup MCP method handlers
   */
  setupHandlers() {
    // List tools
    this.server.setRequestHandler('tools/list', async () => {
      return {
        tools: this.getRegisteredTools()
      };
    });

    // Call tool
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      // Queue task
      const result = await this.taskQueue.enqueue(async () => {
        const tool = this.getTool(name);
        if (!tool) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool '${name}' not found`
          );
        }
        return await tool.handler(args);
      });

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });

    // List resources
    this.server.setRequestHandler('resources/list', async () => {
      return {
        resources: this.getRegisteredResources()
      };
    });

    // Read resource
    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;
      const content = await this.readResource(uri);
      return { contents: [{ uri, text: content }] };
    });
  }

  /**
   * Register a tool
   */
  registerTool(tool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Start the server
   */
  async start() {
    const transport = new HttpServerTransport({
      port: this.port,
      path: '/mcp'
    });

    await this.server.connect(transport);
    console.log(`AgentServer listening on port ${this.port}`);
  }
}
```

### Router MCP Proxy

```javascript
// cli/server/mcp-proxy/index.js

/**
 * MCP Proxy handler for routing requests to agents
 */
export async function handleMCPProxy(req, res, { agent }) {
  // Get agent container info
  const agentConfig = await getAgentConfig(agent);
  if (!agentConfig) {
    return res.status(404).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: { code: -32601, message: `Agent '${agent}' not found` }
    });
  }

  // Build upstream URL
  const upstreamUrl = `http://localhost:${agentConfig.hostPort}/mcp`;

  // Proxy request
  try {
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    // Check for streaming response
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // Stream SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }

      res.end();
    } else {
      // JSON response
      const data = await response.json();
      res.json(data);
    }
  } catch (error) {
    res.status(502).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: { code: -32603, message: `Failed to reach agent: ${error.message}` }
    });
  }
}
```

### Agent MCP Client

```javascript
// Agent/client/AgentMcpClient.mjs

/**
 * MCP Client for agent-to-agent communication
 */
export class AgentMcpClient {
  constructor(options = {}) {
    this.routerHost = options.routerHost || process.env.ROUTER_HOST || 'localhost';
    this.routerPort = options.routerPort || process.env.ROUTER_PORT || 8088;
    this.authToken = options.authToken || process.env.AGENT_TOKEN;
  }

  /**
   * Get MCP endpoint URL for an agent
   */
  getAgentUrl(agentName) {
    return `http://${this.routerHost}:${this.routerPort}/mcps/${agentName}/mcp`;
  }

  /**
   * Send MCP request to another agent
   */
  async request(agentName, method, params) {
    const url = this.getAgentUrl(agentName);
    const request = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify(request)
    });

    const data = await response.json();

    if (data.error) {
      throw new MCPError(data.error.code, data.error.message, data.error.data);
    }

    return data.result;
  }

  /**
   * List tools available on an agent
   */
  async listTools(agentName) {
    const result = await this.request(agentName, 'tools/list', {});
    return result.tools;
  }

  /**
   * Call a tool on another agent
   */
  async callTool(agentName, toolName, args) {
    const result = await this.request(agentName, 'tools/call', {
      name: toolName,
      arguments: args
    });
    return result;
  }

  /**
   * List resources available on an agent
   */
  async listResources(agentName) {
    const result = await this.request(agentName, 'resources/list', {});
    return result.resources;
  }

  /**
   * Read a resource from another agent
   */
  async readResource(agentName, uri) {
    const result = await this.request(agentName, 'resources/read', { uri });
    return result.contents[0]?.text;
  }
}
```

## Behavioral Specification

### Request Processing Flow

```
1. Client sends JSON-RPC request to /mcps/:agent/mcp

2. Router validates request format

3. Router looks up agent in routing.json

4. Router forwards to agent container port

5. AgentServer receives request

6. If tool call: enqueue in TaskQueue

7. TaskQueue processes with concurrency control

8. Tool handler executes

9. Response flows back through router

10. Client receives JSON-RPC response
```

### Task Queue Implementation

```javascript
// Agent/server/TaskQueue.mjs

/**
 * Task queue with concurrency control
 */
export class TaskQueue {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 1;
    this.queue = [];
    this.running = 0;
  }

  /**
   * Enqueue a task
   * @param {Function} task - Async task function
   * @returns {Promise} - Resolves with task result
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  /**
   * Process queued tasks
   */
  async process() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      this.running++;

      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.running--;
        this.process(); // Process next
      }
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queued: this.queue.length,
      running: this.running,
      concurrency: this.concurrency
    };
  }
}
```

## Configuration

### AgentServer Configuration

```javascript
// Default configuration
const defaultConfig = {
  port: 7000,                    // HTTP port
  concurrency: 1,                // Task queue concurrency
  timeout: 30000,                // Request timeout (ms)
  maxRequestSize: '10mb'         // Max request body size
};
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_PORT` | AgentServer HTTP port | `7000` |
| `AGENT_CONCURRENCY` | Task queue concurrency | `1` |
| `ROUTER_HOST` | Router hostname for inter-agent calls | `localhost` |
| `ROUTER_PORT` | Router port | `8088` |

## Error Handling

### MCP Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | ParseError | Invalid JSON |
| -32600 | InvalidRequest | Invalid request object |
| -32601 | MethodNotFound | Method not found |
| -32602 | InvalidParams | Invalid method parameters |
| -32603 | InternalError | Internal server error |

### Custom Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32000 | ToolExecutionError | Tool failed during execution |
| -32001 | ResourceNotFound | Resource URI not found |
| -32002 | QueueFull | Task queue at capacity |
| -32003 | Timeout | Request timed out |

## Security Considerations

- **Input Validation**: Validate all tool parameters against schema
- **Timeout Enforcement**: Prevent runaway tool executions
- **Resource Limits**: Limit queue size and concurrency
- **Authentication**: Require tokens for inter-agent calls

## Success Criteria

1. MCP protocol compliance verified
2. Tool calls work reliably
3. Resource access works correctly
4. Inter-agent communication functions
5. Task queue handles concurrency properly

## MCP Browser Client

The `Agent/client/MCPBrowserClient.js` provides a browser-side MCP client for web interfaces:

- Exposed via the Router at `/MCPBrowserClient.js`
- HTTP Fetch-based transport (no WebSocket required)
- Supports SSE (Server-Sent Events) for streaming responses
- Built-in task status polling with configurable intervals for async operations

```javascript
// Browser usage
const client = new MCPBrowserClient({ baseUrl: '/mcps/agent-name' });

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('execute_code', { code: '1 + 1' });

// List and read resources
const resources = await client.listResources();
const content = await client.readResource('file:///code/main.js');
```

Used by the WebChat interface for agent communication from the browser.

## References

- [MCP Specification](https://modelcontextprotocol.io/spec)
- [DS02 - Architecture](./DS02-architecture.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS06 - Web Interfaces](./DS06-web-interfaces.md)
- [DS09 - Skills System](./DS09-skills-system.md)
