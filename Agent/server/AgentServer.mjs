import { randomUUID } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { zod } from 'mcp-sdk';
import { TaskQueue } from './TaskQueue.mjs';
const { z } = zod;

const DEFAULT_MAX_CONCURRENT_TASKS = 10;
const TASK_QUEUE_FILE = path.resolve(process.cwd(), '.tasksQueue');

// AgentServer (MCP over HTTP): exposes tools/resources via Streamable HTTP transport on PORT (default 7000) at /mcp.

async function loadSdkDeps() {
    const { types,  streamHttp, mcp } = await import('mcp-sdk');
    return {
        McpServer: mcp.McpServer,
        ResourceTemplate: mcp.ResourceTemplate,
        StreamableHTTPServerTransport:  streamHttp.StreamableHTTPServerTransport,
        isInitializeRequest: types.isInitializeRequest,
        McpError: types.McpError,
        ErrorCode: types.ErrorCode
    };
}

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

let cachedConfigResult = null;
function getConfigResult() {
    if (!cachedConfigResult) {
        cachedConfigResult = loadConfig();
    }
    return cachedConfigResult;
}

function resolveMaxConcurrent(config) {
    if (config && config.maxParallelTasks) {
        const candidate = Number(config.maxParallelTasks);
        if (Number.isFinite(candidate) && candidate > 0) {
            return Math.floor(candidate);
        }
    }
    return DEFAULT_MAX_CONCURRENT_TASKS;
}

function buildCommandSpec(entry, defaultCwd) {
    const commandValue = typeof entry?.command === 'string' ? entry.command.trim() : null;
    if (!commandValue) return null;
    const command = path.isAbsolute(commandValue) ? commandValue : path.resolve(defaultCwd, commandValue);
    if (entry.cwd === "workspace") {
        defaultCwd = process.cwd();
    } else {
        defaultCwd = entry.cwd
    }
    const cwd = defaultCwd;
    const env = entry?.env && typeof entry.env === 'object' ? entry.env : {};
    const timeoutMs = Number.isFinite(entry?.timeoutMs) ? entry.timeoutMs : undefined;
    return { command, cwd, env, timeoutMs };
}

function createLiteralUnionSchema(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }
    const unique = [...new Set(values)];
    if (unique.length === 1) {
        return z.literal(unique[0]);
    }
    return z.union(unique.map(value => z.literal(value)));
}

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

    if (!schema) {
        schema = z.any();
    }

    if (fieldSpec.isArray && type !== 'array') {
        let arraySchema = z.array(schema);
        if (typeof fieldSpec.minItems === 'number') {
            arraySchema = arraySchema.min(fieldSpec.minItems);
        }
        if (typeof fieldSpec.maxItems === 'number') {
            arraySchema = arraySchema.max(fieldSpec.maxItems);
        }
        schema = arraySchema;
    }

    if (Array.isArray(fieldSpec.enum) && !['string', 'number'].includes(type)) {
        const enumSchema = createLiteralUnionSchema(fieldSpec.enum);
        if (enumSchema) {
            schema = enumSchema;
        }
    }

    if (fieldSpec.nullable) {
        schema = schema.nullable();
    }
    if (fieldSpec.optional) {
        schema = schema.optional();
    }
    if (typeof fieldSpec.description === 'string' && schema.describe) {
        schema = schema.describe(fieldSpec.description);
    }
    return schema;
}

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
            if (err?.code === 'EPIPE') {
                return;
            }
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

const initialConfigResult = getConfigResult();
const initialConfig = initialConfigResult ? initialConfigResult.config : {};
const taskQueue = new TaskQueue({
    maxConcurrent: resolveMaxConcurrent(initialConfig),
    storagePath: TASK_QUEUE_FILE,
    executor: executeShell
});

function extractTemplateParams(template) {
    const params = {};
    const regex = /\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(template)) !== null) {
        params[match[1]] = undefined;
    }
    return params;
}

async function registerFromConfig(server, config, helpers) {
    if (!config || typeof config !== 'object') return;
    const { ResourceTemplate, McpError, ErrorCode } = helpers;
    const defaultCwd = '/code';

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
                if (cbArgs.length === 1 && typeof args === 'object' && args !== null && args.requestId) {
                    context = args;
                    args = {};
                }
                console.log(`[AgentServer/MCP] Tool '${name}' args:`, args);
                console.log(`[AgentServer/MCP] Tool '${name}' context:`, context);
                const payload = { tool: name, input: args, metadata: context };
                console.log(`[AgentServer/MCP] Tool '${name}' payload:`, JSON.stringify(payload));
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
                    if (helpers && helpers.McpError && helpers.ErrorCode) {
                        throw new helpers.McpError(helpers.ErrorCode.InternalError, message);
                    }
                    throw new Error(message);
                }
                const textOut = result.stdout?.length ? result.stdout : '(no output)';
                const content = [{ type: 'text', text: textOut }];
                if (result.stderr && result.stderr.trim()) {
                    content.push({ type: 'text', text: `stderr:\n${result.stderr}` });
                }
                return { content, metadata: { agent: process.env.AGENT_NAME || name } };
            };

            const registeredTool = server.registerTool(name, definition, invocation);

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

    if (Array.isArray(config.resources)) {
        for (const resource of config.resources) {
            if (!resource || typeof resource !== 'object') continue;
            const name = typeof resource.name === 'string' ? resource.name : null;
            if (!name) continue;
            const commandSpec = buildCommandSpec(resource, defaultCwd);
            if (!commandSpec) {
                console.warn(`[AgentServer/MCP] Skipping resource '${name}' - missing command`);
                continue;
            }
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
                        const message = result.stderr?.trim() || `command exited with code ${result.code}`;
                        throw new McpError(ErrorCode.InternalError, message);
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
                        const message = result.stderr?.trim() || `command exited with code ${result.code}`;
                        throw new McpError(ErrorCode.InternalError, message);
                    }
                    return {
                        contents: [{ uri: uri.href, text: result.stdout, mimeType: metadata.mimeType }]
                    };
                });
            } else {
                console.warn(`[AgentServer/MCP] Skipping resource '${name}' - missing uri/template definition`);
            }
        }
    }

    if (Array.isArray(config.prompts)) {
        for (const prompt of config.prompts) {
            if (!prompt || typeof prompt !== 'object') continue;
            const name = typeof prompt.name === 'string' ? prompt.name : null;
            if (!name) continue;
            if (!Array.isArray(prompt.messages) || !prompt.messages.length) {
                console.warn(`[AgentServer/MCP] Skipping prompt '${name}' - missing messages`);
                continue;
            }
            server.registerPrompt(name, {
                description: prompt.description,
                messages: prompt.messages
            });
        }
    }
}

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

    // Ensure core MCP request handlers are in place so the server responds with empty lists
    // instead of "method not found" when no configuration entries exist.
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
            if (method === 'GET' && u.pathname === '/health') {
                return sendJson(200, { ok: true, server: 'ploinky-agent-mcp' });
            }
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
                            return; // handled
                        }
                        await entry.transport.handleRequest(req, res, body);
                    } catch (err) {
                        console.error('[AgentServer/MCP] error:', err);
                        if (!res.headersSent) return sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
                    }
                });
                return;
            }
            // Not found
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
