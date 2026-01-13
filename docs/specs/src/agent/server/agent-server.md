# Agent/server/AgentServer.mjs - MCP Server Implementation

## Overview

Core MCP (Model Context Protocol) server for Ploinky agents. Exposes tools and resources via Streamable HTTP transport, enabling agent-to-agent and CLI-to-agent communication. Supports synchronous and asynchronous tool execution with configurable schemas via JSON configuration files.

## Source File

`Agent/server/AgentServer.mjs`

## Dependencies

```javascript
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { zod } from 'mcp-sdk';
import { TaskQueue } from './TaskQueue.mjs';
const { z } = zod;
```

## Constants & Configuration

```javascript
const DEFAULT_MAX_CONCURRENT_TASKS = 10;
const TASK_QUEUE_FILE = path.resolve(process.cwd(), '.tasksQueue');
```

## Dynamic SDK Loading

### loadSdkDeps()

**Purpose**: Dynamically imports MCP SDK dependencies

**Returns**: (Promise<Object>) SDK components

**Implementation**:
```javascript
async function loadSdkDeps() {
    const { types, streamHttp, mcp } = await import('mcp-sdk');
    return {
        McpServer: mcp.McpServer,
        ResourceTemplate: mcp.ResourceTemplate,
        StreamableHTTPServerTransport: streamHttp.StreamableHTTPServerTransport,
        isInitializeRequest: types.isInitializeRequest,
        McpError: types.McpError,
        ErrorCode: types.ErrorCode
    };
}
```

## Configuration Management

### resolveConfigPaths()

**Purpose**: Builds ordered list of config file paths to check

**Returns**: (Array<string>) Config path candidates

**Priority Order**:
1. `PLOINKY_AGENT_CONFIG` (explicit)
2. `MCP_CONFIG_FILE` (explicit)
3. `AGENT_CONFIG_FILE` (explicit)
4. `PLOINKY_MCP_CONFIG_PATH` (default)
5. `/tmp/ploinky/mcp-config.json`
6. `/code/mcp-config.json`
7. `${cwd}/mcp-config.json`

```javascript
function resolveConfigPaths() {
    const explicit = [
        process.env.PLOINKY_AGENT_CONFIG,
        process.env.MCP_CONFIG_FILE,
        process.env.AGENT_CONFIG_FILE
    ].filter(Boolean);
    const defaults = [
        process.env.PLOINKY_MCP_CONFIG_PATH,
        '/tmp/ploinky/mcp-config.json',
        '/code/mcp-config.json',
        path.join(process.cwd(), 'mcp-config.json')
    ];
    return [...explicit, ...defaults];
}
```

### loadConfig()

**Purpose**: Loads and parses first valid config file

**Returns**: (Object|null) `{ source, config }` or null

```javascript
function loadConfig() {
    const candidates = resolveConfigPaths();
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const stat = fs.statSync(candidate);
            if (!stat.isFile()) continue;
            const raw = fs.readFileSync(candidate, 'utf8');
            const parsed = JSON.parse(raw);
            return { source: candidate, config: parsed };
        } catch (err) {
            if (err.code === 'ENOENT') continue;
            if (err instanceof SyntaxError) {
                console.error(`[AgentServer/MCP] Failed to parse config '${candidate}': ${err.message}`);
            } else {
                console.error(`[AgentServer/MCP] Cannot read config '${candidate}': ${err.message}`);
            }
        }
    }
    return null;
}
```

### getConfigResult()

**Purpose**: Cached config loader (singleton pattern)

### resolveMaxConcurrent(config)

**Purpose**: Extracts max parallel tasks from config

**Returns**: (number) Max concurrent tasks

## Zod Schema Building

### buildZodObjectSchema(spec)

**Purpose**: Converts JSON schema spec to Zod object schema

**Parameters**:
- `spec` (Object): Schema specification

**Returns**: (z.ZodObject) Zod schema

```javascript
function buildZodObjectSchema(spec) {
    if (!spec || typeof spec !== 'object') {
        return null;
    }
    const shape = {};
    let hasFields = false;
    for (const [key, fieldSpec] of Object.entries(spec)) {
        shape[key] = createFieldSchema(fieldSpec);
        hasFields = true;
    }
    if (!hasFields) {
        return z.object({});
    }
    return z.object(shape);
}
```

### createFieldSchema(fieldSpec)

**Purpose**: Converts field spec to Zod field schema

**Supported Types**:
- `string`: With optional enum, minLength, maxLength
- `number`: With optional enum, min, max
- `boolean`: Simple boolean
- `array`: With items schema, minItems, maxItems
- `object`: With nested properties, additionalProperties

**Field Modifiers**:
- `nullable`: Allows null values
- `optional`: Makes field optional
- `description`: Adds schema description
- `isArray`: Wraps any type in array

```javascript
function createFieldSchema(fieldSpec) {
    if (typeof fieldSpec === 'string') {
        fieldSpec = { type: fieldSpec };
    }
    if (!fieldSpec || typeof fieldSpec !== 'object') {
        return z.any();
    }
    const type = typeof fieldSpec.type === 'string' ? fieldSpec.type.toLowerCase() : 'string';
    let schema;
    switch (type) {
        case 'string': {
            if (Array.isArray(fieldSpec.enum) && fieldSpec.enum.every(value => typeof value === 'string')) {
                schema = createLiteralUnionSchema(fieldSpec.enum) || z.string();
            } else {
                schema = z.string();
            }
            if (typeof fieldSpec.minLength === 'number') {
                schema = schema.min(fieldSpec.minLength);
            }
            if (typeof fieldSpec.maxLength === 'number') {
                schema = schema.max(fieldSpec.maxLength);
            }
            break;
        }
        case 'number': {
            schema = z.number();
            if (typeof fieldSpec.min === 'number') {
                schema = schema.min(fieldSpec.min);
            }
            if (typeof fieldSpec.max === 'number') {
                schema = schema.max(fieldSpec.max);
            }
            if (Array.isArray(fieldSpec.enum) && fieldSpec.enum.every(value => typeof value === 'number')) {
                schema = createLiteralUnionSchema(fieldSpec.enum) || schema;
            }
            break;
        }
        case 'boolean':
            schema = z.boolean();
            break;
        case 'array': {
            const itemSchema = createFieldSchema(fieldSpec.items ?? { type: 'string' });
            schema = z.array(itemSchema);
            if (typeof fieldSpec.minItems === 'number') {
                schema = schema.min(fieldSpec.minItems);
            }
            if (typeof fieldSpec.maxItems === 'number') {
                schema = schema.max(fieldSpec.maxItems);
            }
            break;
        }
        case 'object': {
            const nested = buildZodObjectSchema(fieldSpec.properties) || z.object({});
            schema = fieldSpec.additionalProperties === true ? nested.passthrough() : nested;
            break;
        }
        default:
            schema = z.any();
            break;
    }
    // Apply modifiers
    if (fieldSpec.nullable) schema = schema.nullable();
    if (fieldSpec.optional) schema = schema.optional();
    if (typeof fieldSpec.description === 'string' && schema.describe) {
        schema = schema.describe(fieldSpec.description);
    }
    return schema;
}
```

### createLiteralUnionSchema(values)

**Purpose**: Creates Zod union from literal values

**Returns**: (z.ZodUnion|z.ZodLiteral|null) Literal schema

## Command Execution

### buildCommandSpec(entry, defaultCwd)

**Purpose**: Builds command specification from config entry

**Parameters**:
- `entry` (Object): Tool/resource config entry
- `defaultCwd` (string): Default working directory

**Returns**: (Object|null) `{ command, cwd, env, timeoutMs }`

```javascript
function buildCommandSpec(entry, defaultCwd) {
    const commandValue = typeof entry?.command === 'string' ? entry.command.trim() : null;
    if (!commandValue) return null;
    const command = path.isAbsolute(commandValue) ? commandValue : path.resolve(defaultCwd, commandValue);
    if (entry.cwd === "workspace") {
        defaultCwd = process.cwd();
    } else {
        defaultCwd = entry.cwd;
    }
    const cwd = defaultCwd;
    const env = entry?.env && typeof entry.env === 'object' ? entry.env : {};
    const timeoutMs = Number.isFinite(entry?.timeoutMs) ? entry.timeoutMs : undefined;
    return { command, cwd, env, timeoutMs };
}
```

### executeShell(spec, payload, options)

**Purpose**: Spawns child process and executes command

**Parameters**:
- `spec` (Object): Command specification `{ command, cwd, env, timeoutMs }`
- `payload` (Object): Input payload (JSON stringified to stdin)
- `options` (Object): Optional `{ onSpawn }` callback

**Returns**: (Promise<Object>) `{ code, signal, stdout, stderr }`

```javascript
function executeShell(spec, payload, options = {}) {
    return new Promise((resolve, reject) => {
        const { command, cwd, env, timeoutMs } = spec;
        const child = spawn(command, [], {
            cwd,
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs
        });
        if (typeof options.onSpawn === 'function') {
            try {
                options.onSpawn(child);
            } catch (err) {
                console.warn('[AgentServer/MCP] onSpawn hook failed:', err);
            }
        }
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        child.on('error', reject);
        child.stdin.on('error', err => {
            if (err?.code === 'EPIPE') return;
            reject(err);
        });
        child.on('close', (code, signal) => {
            resolve({
                code,
                signal,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8')
            });
        });
        try {
            child.stdin.end(JSON.stringify(payload ?? {}) + '\n');
        } catch (_) {
            // ignore broken pipes
        }
    });
}
```

## Registration

### registerFromConfig(server, config, helpers)

**Purpose**: Registers tools, resources, and prompts from config

**Tool Registration**:
```javascript
if (Array.isArray(config.tools)) {
    for (const tool of config.tools) {
        if (!tool || typeof tool !== 'object') continue;
        const name = typeof tool.name === 'string' ? tool.name : null;
        if (!name) continue;
        const commandSpec = buildCommandSpec(tool, defaultCwd);
        if (!commandSpec) {
            console.warn(`[AgentServer/MCP] Skipping tool '${name}' - missing command`);
            continue;
        }
        const definition = {
            title: tool.title,
            description: tool.description
        };

        const isAsync = tool.async === true;
        const asyncTimeout = Number.isFinite(tool.timeout) ? tool.timeout : undefined;

        const invocation = async (...cbArgs) => {
            let args = cbArgs[0] ?? {};
            let context = cbArgs[1] ?? {};
            const payload = { tool: name, input: args, metadata: context };

            if (isAsync) {
                const enqueued = taskQueue.enqueueTask({
                    toolName: name,
                    commandSpec,
                    payload,
                    timeoutMs: asyncTimeout
                });
                return {
                    content: [{ type: 'text', text: `Task '${name}' queued with id ${enqueued.id}` }],
                    metadata: {
                        agent: process.env.AGENT_NAME || name,
                        taskId: enqueued.id,
                        toolName: enqueued.toolName,
                        status: enqueued.status,
                        createdAt: enqueued.createdAt,
                        updatedAt: enqueued.updatedAt
                    }
                };
            }

            const result = await executeShell(commandSpec, payload);
            if (result.code !== 0) {
                const message = result.stderr?.trim() || `command exited with code ${result.code}`;
                throw new helpers.McpError(helpers.ErrorCode.InternalError, message);
            }
            const textOut = result.stdout?.length ? result.stdout : '(no output)';
            const content = [{ type: 'text', text: textOut }];
            if (result.stderr && result.stderr.trim()) {
                content.push({ type: 'text', text: `stderr:\n${result.stderr}` });
            }
            return { content, metadata: { agent: process.env.AGENT_NAME || name } };
        };

        const registeredTool = server.registerTool(name, definition, invocation);

        // Apply input schema if configured
        let configuredSchema = null;
        if (tool.inputSchema && typeof tool.inputSchema === 'object') {
            try {
                configuredSchema = buildZodObjectSchema(tool.inputSchema);
            } catch (err) {
                console.error(`[AgentServer/MCP] Failed to build inputSchema for tool '${name}': ${err.message}`);
            }
        }

        if (configuredSchema) {
            registeredTool.inputSchema = configuredSchema;
            if (typeof server.sendToolListChanged === 'function') {
                server.sendToolListChanged();
            }
        } else if (!registeredTool.inputSchema) {
            registeredTool.inputSchema = z.object({});
        }
    }
}
```

**Resource Registration**:
```javascript
if (Array.isArray(config.resources)) {
    for (const resource of config.resources) {
        if (!resource || typeof resource !== 'object') continue;
        const name = typeof resource.name === 'string' ? resource.name : null;
        if (!name) continue;
        const commandSpec = buildCommandSpec(resource, defaultCwd);
        if (!commandSpec) continue;

        const metadata = {
            title: resource.title || name,
            description: resource.description || '',
            mimeType: resource.mimeType || 'text/plain'
        };

        if (resource.template && typeof resource.template === 'string') {
            const template = new ResourceTemplate(resource.template, extractTemplateParams(resource.template));
            server.registerResource(name, template, metadata, async (uri, params = {}) => {
                const payload = { resource: name, uri: uri.href, params };
                const result = await executeShell(commandSpec, payload);
                if (result.code !== 0) {
                    throw new McpError(ErrorCode.InternalError, result.stderr?.trim() || `command exited with code ${result.code}`);
                }
                return {
                    contents: [{ uri: uri.href, text: result.stdout, mimeType: metadata.mimeType }]
                };
            });
        } else if (resource.uri && typeof resource.uri === 'string') {
            server.registerResource(name, resource.uri, metadata, async (uri) => {
                const payload = { resource: name, uri: uri.href };
                const result = await executeShell(commandSpec, payload);
                if (result.code !== 0) {
                    throw new McpError(ErrorCode.InternalError, result.stderr?.trim() || `command exited with code ${result.code}`);
                }
                return {
                    contents: [{ uri: uri.href, text: result.stdout, mimeType: metadata.mimeType }]
                };
            });
        }
    }
}
```

**Prompt Registration**:
```javascript
if (Array.isArray(config.prompts)) {
    for (const prompt of config.prompts) {
        if (!prompt || typeof prompt !== 'object') continue;
        const name = typeof prompt.name === 'string' ? prompt.name : null;
        if (!name) continue;
        if (!Array.isArray(prompt.messages) || !prompt.messages.length) continue;
        server.registerPrompt(name, {
            description: prompt.description,
            messages: prompt.messages
        });
    }
}
```

### extractTemplateParams(template)

**Purpose**: Extracts parameter names from URI template

**Returns**: (Object) Parameter name map

```javascript
function extractTemplateParams(template) {
    const params = {};
    const regex = /\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(template)) !== null) {
        params[match[1]] = undefined;
    }
    return params;
}
```

## Server Creation

### createServerInstance()

**Purpose**: Creates configured MCP server instance

**Returns**: (Promise<McpServer>) Configured server

```javascript
async function createServerInstance() {
    const { McpServer, ResourceTemplate, McpError, ErrorCode } = await loadSdkDeps();
    const server = new McpServer({ name: 'ploinky-agent-mcp', version: '1.0.0' });

    const configResult = getConfigResult();
    const config = configResult ? configResult.config : {};

    if (configResult) {
        console.log(`[AgentServer/MCP] Loaded config from ${configResult.source}`);
    } else {
        console.log('[AgentServer/MCP] No configuration file found; starting with an empty configuration.');
    }
    await registerFromConfig(server, config, { ResourceTemplate, McpError, ErrorCode });

    // Ensure core MCP request handlers
    if (typeof server.setToolRequestHandlers === 'function') {
        server.setToolRequestHandlers();
    }
    if (typeof server.setResourceRequestHandlers === 'function') {
        server.setResourceRequestHandlers();
    }
    if (typeof server.setPromptRequestHandlers === 'function') {
        server.setPromptRequestHandlers();
    }

    return server;
}
```

## HTTP Server

### main()

**Purpose**: Starts HTTP server with MCP endpoints

**Endpoints**:

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check |
| `/getTaskStatus` | GET | Query async task status |
| `/mcp` | POST | MCP protocol endpoint |

```javascript
async function main() {
    const { StreamableHTTPServerTransport, isInitializeRequest } = await loadSdkDeps();
    taskQueue.initialize();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;
    const sessions = {};

    const serverHttp = http.createServer((req, res) => {
        const { method, url } = req;
        const sendJson = (code, obj, extraHeaders = {}) => {
            const data = Buffer.from(JSON.stringify(obj));
            res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': data.length, ...extraHeaders });
            res.end(data);
        };
        try {
            const u = new URL(url || '/', 'http://localhost');

            // Health check
            if (method === 'GET' && u.pathname === '/health') {
                return sendJson(200, { ok: true, server: 'ploinky-agent-mcp' });
            }

            // Task status query
            if (method === 'GET' && u.pathname === '/getTaskStatus') {
                const taskId = u.searchParams.get('taskId');
                if (!taskId) {
                    return sendJson(400, { error: 'missing taskId' });
                }
                const task = taskQueue.getTask(taskId);
                if (!task) {
                    return sendJson(404, { error: 'task not found' });
                }
                return sendJson(200, { task });
            }

            // MCP protocol
            if (method === 'POST' && u.pathname === '/mcp') {
                const chunks = [];
                req.on('data', c => chunks.push(c));
                req.on('end', async () => {
                    let body = {};
                    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { body = {}; }
                    const sessionId = req.headers['mcp-session-id'];
                    let entry = sessionId && sessions[sessionId] ? sessions[sessionId] : null;
                    try {
                        if (!entry) {
                            if (!isInitializeRequest(body)) {
                                return sendJson(400, { jsonrpc: '2.0', error: { code: -32000, message: 'Missing session; send initialize first' }, id: null });
                            }
                            const transport = new StreamableHTTPServerTransport({
                                sessionIdGenerator: () => randomUUID(),
                                enableJsonResponse: true,
                                onsessioninitialized: (sid) => { sessions[sid] = { transport, server }; }
                            });
                            const server = await createServerInstance();
                            await server.connect(transport);
                            transport.onclose = () => {
                                try { server.close(); } catch (_) {}
                                const sid = transport.sessionId;
                                if (sid && sessions[sid]) delete sessions[sid];
                            };
                            await transport.handleRequest(req, res, body);
                            return;
                        }
                        await entry.transport.handleRequest(req, res, body);
                    } catch (err) {
                        console.error('[AgentServer/MCP] error:', err);
                        if (!res.headersSent) return sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
                    }
                });
                return;
            }

            res.statusCode = 404; res.end('Not Found');
        } catch (err) {
            console.error('[AgentServer/MCP] http error:', err);
            if (!res.headersSent) return sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
    });

    serverHttp.listen(PORT, () => {
        console.log(`[AgentServer/MCP] Streamable HTTP listening on ${PORT} (/mcp)`);
    });
}

main().catch(err => { console.error('[AgentServer/MCP] fatal error:', err); process.exit(1); });
```

## Configuration Schema

### mcp-config.json

```json
{
    "maxParallelTasks": 10,
    "tools": [
        {
            "name": "tool-name",
            "title": "Tool Title",
            "description": "What the tool does",
            "command": "/path/to/script.sh",
            "cwd": "/code",
            "env": { "VAR": "value" },
            "timeoutMs": 30000,
            "async": false,
            "timeout": 60000,
            "inputSchema": {
                "paramName": {
                    "type": "string",
                    "description": "Parameter description",
                    "optional": true
                }
            }
        }
    ],
    "resources": [
        {
            "name": "resource-name",
            "title": "Resource Title",
            "description": "Resource description",
            "uri": "file:///path/to/resource",
            "template": "file:///path/{param}/resource",
            "mimeType": "text/plain",
            "command": "/path/to/handler.sh"
        }
    ],
    "prompts": [
        {
            "name": "prompt-name",
            "description": "Prompt description",
            "messages": [
                { "role": "user", "content": "Prompt template" }
            ]
        }
    ]
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 7000 |
| `AGENT_NAME` | Agent identifier for metadata | tool name |
| `PLOINKY_AGENT_CONFIG` | Explicit config path | - |
| `MCP_CONFIG_FILE` | Explicit config path | - |
| `AGENT_CONFIG_FILE` | Explicit config path | - |
| `PLOINKY_MCP_CONFIG_PATH` | Default config path | - |

## Session Management

Sessions are tracked by `mcp-session-id` header:
- First request must be `initialize` to create session
- Subsequent requests use session ID from header
- Session cleanup on transport close

## Related Modules

- [agent-task-queue.md](./agent-task-queue.md) - Async task queue
- [agent-server-startup.md](./agent-server-startup.md) - Supervisor script
