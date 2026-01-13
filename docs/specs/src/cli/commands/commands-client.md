# cli/commands/client.js - MCP Client Commands

## Overview

Provides CLI commands for interacting with the MCP (Model Context Protocol) router. Allows listing tools and resources, calling tools, and checking agent status through the local routing server.

## Source File

`cli/commands/client.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../services/config.js';
import { debugLog, parseParametersString } from '../services/utils.js';
import { createAgentClient as createBrowserClient } from '../../Agent/client/MCPBrowserClient.js';
```

## Class: ClientCommands

### Constructor

```javascript
constructor() {
    this.configPath = path.join(PLOINKY_DIR, 'cloud.json');
    this.loadConfig();
    this._toolCache = null;
}
```

### Properties

- `configPath` (string): Path to cloud configuration file
- `config` (Object): Loaded configuration
- `_toolCache` (Array|null): Cached tool list for efficiency

## Internal Methods

### getToolAgentName(tool)

**Purpose**: Extracts agent name from tool metadata

**Parameters**:
- `tool` (Object): Tool object with annotations

**Returns**: (string|null) Agent name

**Implementation**:
```javascript
getToolAgentName(tool) {
    const routerInfo = tool && tool.annotations && typeof tool.annotations === 'object'
        ? tool.annotations.router
        : null;
    if (routerInfo && typeof routerInfo.agent === 'string') {
        return routerInfo.agent;
    }
    if (tool && typeof tool.agent === 'string') {
        return tool.agent;
    }
    return null;
}
```

### getResourceAgentName(resource)

**Purpose**: Extracts agent name from resource metadata

**Parameters**:
- `resource` (Object): Resource object with annotations

**Returns**: (string|null) Agent name

### loadConfig()

**Purpose**: Loads configuration from cloud.json

**Implementation**:
```javascript
loadConfig() {
    if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
    } else {
        this.config = {};
    }
}
```

### getRouterPort()

**Purpose**: Gets the router port from routing configuration

**Returns**: (number) Port number (default: 8080)

**Implementation**:
```javascript
getRouterPort() {
    const routingFile = path.resolve('.ploinky/routing.json');
    try {
        const cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {};
        return cfg.port || 8080;
    } catch (_) {
        return 8080;
    }
}
```

### withRouterClient(fn)

**Purpose**: Executes a function with an MCP client connection

**Parameters**:
- `fn` (Function): Async function receiving client

**Returns**: Promise with function result

**Implementation**:
```javascript
async withRouterClient(fn) {
    const baseUrl = `http://127.0.0.1:${this.getRouterPort()}/mcp`;
    const client = createBrowserClient(baseUrl);
    try {
        return await fn(client);
    } finally {
        await client.close().catch(() => { });
    }
}
```

### formatToolLine(tool)

**Purpose**: Formats a tool for display

**Returns**: (string) Formatted line like `- [agent] toolName (title) - description`

**Implementation**:
```javascript
formatToolLine(tool) {
    const agent = this.getToolAgentName(tool) || 'unknown';
    const name = tool && tool.name ? String(tool.name) : '(unnamed)';
    const title = tool && tool.title && tool.title !== name ? ` (${tool.title})` : '';
    const description = tool && tool.description ? ` - ${tool.description}` : '';
    return `- [${agent}] ${name}${title}${description}`;
}
```

### formatResourceLine(resource)

**Purpose**: Formats a resource for display

**Returns**: (string) Formatted line like `- [agent] uri (name) - description`

### printAggregatedList(items, formatter)

**Purpose**: Prints a list of items using a formatter

**Parameters**:
- `items` (Array): Items to print
- `formatter` (Function): Formatting function

## Public Methods

### listTools()

**Purpose**: Lists all tools from the router

**Async**: Yes

**Implementation**:
```javascript
async listTools() {
    try {
        const tools = await this.withRouterClient(async (client) => client.listTools());
        this._toolCache = Array.isArray(tools) ? tools : [];
        this.printAggregatedList(this._toolCache, this.formatToolLine.bind(this));
    } catch (err) {
        const message = err && err.message ? err.message : String(err || '');
        console.log(`Failed to retrieve tool list: ${message}`);
    }
}
```

### listResources()

**Purpose**: Lists all resources from the router

**Async**: Yes

### getAgentStatus(agentName)

**Purpose**: Gets the status of a specific agent via MCP ping

**Parameters**:
- `agentName` (string): Agent to check

**Implementation**:
```javascript
async getAgentStatus(agentName) {
    if (!agentName) {
        console.log('Usage: client status <agentName>');
        return;
    }
    try {
        await this.withRouterClient(async (client) => {
            const meta = { router: { agent: agentName } };
            let ok = true;
            let message = 'MCP ping succeeded.';

            try {
                await client.ping(meta);
            } catch (err) {
                const reason = err?.message ? err.message : String(err || 'Unknown error');
                message = `MCP ping failed: ${reason}`;
                ok = false;
            }

            console.log(`${agentName}: ok=${ok}`);
            if (message) {
                console.log(message.trim());
            }
        });
    } catch (err) {
        console.log(`Failed to retrieve status for '${agentName}': ${err?.message || err}`);
    }
}
```

### findToolAgent(toolName)

**Purpose**: Finds which agent provides a tool

**Parameters**:
- `toolName` (string): Tool name to find

**Returns**: `{agent: string|null, error: string|null, agents?: string[]}`

**Implementation**:
```javascript
async findToolAgent(toolName) {
    if (!this._toolCache) {
        try {
            const tools = await this.withRouterClient(async (client) => client.listTools());
            this._toolCache = Array.isArray(tools) ? tools : [];
        } catch (_) {
            this._toolCache = [];
        }
    }
    const matchingTools = this._toolCache.filter(t => t.name === toolName);
    if (matchingTools.length === 0) {
        return { agent: null, error: 'not_found' };
    }
    if (matchingTools.length > 1) {
        const agents = Array.from(new Set(matchingTools
            .map(tool => this.getToolAgentName(tool))
            .filter(Boolean)));
        return { agent: null, error: 'ambiguous', agents };
    }
    const tool = matchingTools[0];
    const agent = this.getToolAgentName(tool);
    if (!agent) {
        return { agent: null, error: 'not_found' };
    }
    return { agent, error: null };
}
```

### callTool(toolName, payloadObj, targetAgent)

**Purpose**: Calls a tool on an agent

**Parameters**:
- `toolName` (string): Tool name
- `payloadObj` (Object): Tool parameters
- `targetAgent` (string|null): Target agent or auto-detect

**Async**: Yes

**Implementation**:
```javascript
async callTool(toolName, payloadObj = {}, targetAgent = null) {
    if (!toolName) {
        console.error('Missing tool name.');
        return;
    }

    let agent = targetAgent;
    if (!agent) {
        const findResult = await this.findToolAgent(toolName);
        if (findResult.error === 'not_found') {
            console.error(`Tool '${toolName}' not found on any active agent.`);
            return;
        }
        if (findResult.error === 'ambiguous') {
            const errPayload = {
                error: 'ambiguous tool',
                message: `Tool '${toolName}' was found on multiple agents. Please specify one with --agent.`,
                agents: findResult.agents
            };
            console.log(JSON.stringify(errPayload, null, 2));
            return;
        }
        agent = findResult.agent;
        debugLog(`--> Found tool '${toolName}' on agent '${agent}'. Calling...`);
    }

    try {
        await this.withRouterClient(async (client) => {
            const result = await client.callTool(toolName, payloadObj);
            console.log(JSON.stringify(result, null, 2));
        });
    } catch (err) {
        console.log(`Failed to call tool: ${err?.message || err}`);
    }
}
```

### handleClientCommand(args)

**Purpose**: Main command dispatcher for client subcommands

**Parameters**:
- `args` (string[]): Command arguments

**Subcommands**:
| Command | Description |
|---------|-------------|
| `client list tools` | List all available tools |
| `client list resources` | List all available resources |
| `client tool <name> [options]` | Call a tool |
| `client status <agent>` | Check agent status |
| `client task-status <agent> <id>` | Get task status |

**Tool Command Options**:
- `--agent <name>` or `-a <name>`: Specify target agent
- `--parameters <params>` or `-p <params>`: Parameters string
- `-key value`: Set parameter key to value

**Implementation**:
```javascript
async handleClientCommand(args) {
    const [subcommand, ...options] = args;
    debugLog(`Handling client command: '${subcommand}' with options: [${options.join(', ')}]`);

    switch (subcommand) {
        case 'tool': {
            const toolName = options[0];
            let idx = 1;
            let fields = {};
            let targetAgent = null;

            // Helper functions for value coercion and field merging
            const coerceValue = (s) => {
                if (s === undefined || s === null) return s;
                if (typeof s !== 'string') return s;
                const trimmed = s.trim();
                const lower = trimmed.toLowerCase();
                if (lower === 'true') return true;
                if (lower === 'false') return false;
                if (lower === 'null') return null;
                const n = Number(trimmed);
                return Number.isFinite(n) && String(n) === trimmed ? n : s;
            };

            // Parse arguments
            while (idx < options.length) {
                const tok = String(options[idx] || '');

                if (tok === '--parameters' || tok === '-p') {
                    const parametersString = options[idx + 1] || '';
                    if (parametersString) {
                        const parsedParams = parseParametersString(parametersString);
                        fields = mergeFields(fields, parsedParams);
                    }
                    idx += 2;
                    continue;
                }

                if (tok === '--agent' || tok === '-a') {
                    targetAgent = String(options[idx + 1]);
                    idx += 2;
                    continue;
                }

                if (tok.startsWith('-')) {
                    const key = tok.replace(/^[-]+/, '');
                    const next = options[idx + 1];
                    if (next !== undefined && !String(next).startsWith('-')) {
                        applyField(fields, key, coerceValue(next));
                        idx += 2;
                    } else {
                        applyField(fields, key, true);
                        idx += 1;
                    }
                    continue;
                }

                idx += 1;
            }

            await this.callTool(toolName, fields, targetAgent);
            break;
        }
        case 'list':
            switch ((options[0] || '').toLowerCase()) {
                case 'tools': await this.listTools(); break;
                case 'resources': await this.listResources(); break;
                default: console.log('Unknown list option. Supported: tools, resources');
            }
            break;
        case 'status':
            await this.getAgentStatus(options[0]);
            break;
        // ... other cases
    }
}
```

## Exports

```javascript
export default ClientCommands;
```

## Usage Example

```javascript
import ClientCommands from './client.js';

const client = new ClientCommands();

// List all tools
await client.listTools();

// Call a tool
await client.callTool('echo', { message: 'Hello' });

// Check agent status
await client.getAgentStatus('node-dev');

// Handle CLI command
await client.handleClientCommand(['tool', 'search', '-query', 'test']);
```

## Related Modules

- [agent-mcp-browser-client.md](../../agent/client/agent-mcp-browser-client.md) - MCP client
- [server-routing-server.md](../server/server-routing-server.md) - Router server
- [service-utils.md](../services/utils/service-utils.md) - Parameter parsing
