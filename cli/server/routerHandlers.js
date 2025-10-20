import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';

import { sendJson } from './authHandlers.js';
import { createAgentClient } from './AgentClient.js';

const ROUTING_DIR = path.resolve('.ploinky');
const ROUTING_FILE = path.join(ROUTING_DIR, 'routing.json');

const ROUTER_PROTOCOL_VERSION = '2025-06-18';
const ROUTER_SERVER_INFO = { name: 'ploinky-router', version: '1.0.0' };
const ROUTER_INSTRUCTIONS = 'Ploinky Router aggregates tools and resources from registered agents.';

const routerSessions = new Map();

export function loadApiRoutes() {
    try {
        return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')).routes || {};
    } catch (_) {
        return {};
    }
}

export function buildAgentPath(parsedUrl, includeSearch = true) {
    if (!parsedUrl || typeof parsedUrl !== 'object') return '/mcp';
    const pathname = parsedUrl.pathname && parsedUrl.pathname !== '/' ? parsedUrl.pathname : '';
    const search = includeSearch && parsedUrl.search ? parsedUrl.search : '';
    return `/mcp${pathname}${search}`;
}

export function postJsonToAgent(targetPort, payload, res, agentPath, extraHeaders = {}) {
    try {
        const data = Buffer.from(JSON.stringify(payload || {}));
        const opts = {
            hostname: '127.0.0.1',
            port: targetPort,
            path: agentPath && agentPath.length ? agentPath : '/mcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                ...extraHeaders
            }
        };
        const upstream = http.request(opts, upstreamRes => {
            res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
            upstreamRes.pipe(res, { end: true });
        });
        upstream.on('error', err => {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
        });
        upstream.end(data);
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'proxy failure', detail: String(err) }));
    }
}

export function proxyMcpPassthrough(req, res, targetPort, agentPath) {
    const pathWithLeadingSlash = agentPath.startsWith('/') ? agentPath : `/${agentPath}`;
    const opts = {
        hostname: '127.0.0.1',
        port: targetPort,
        path: pathWithLeadingSlash,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${targetPort}`
        }
    };

    const upstream = http.request(opts, upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
    });

    upstream.on('error', err => {
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
    });

    req.on('aborted', () => {
        upstream.destroy();
    });

    req.pipe(upstream, { end: true });
}

export function proxyApi(req, res, targetPort, identityHeaders = {}) {
    const method = (req.method || 'GET').toUpperCase();
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const includeSearch = method !== 'GET';
    const agentPath = buildAgentPath(parsed, includeSearch);
    if (method === 'GET') {
        // Convert URLSearchParams to plain object
        const params = {};
        parsed.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return postJsonToAgent(targetPort, params, res, agentPath, identityHeaders);
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        const data = body.length ? body : Buffer.from('{}');
        const opts = {
            hostname: '127.0.0.1',
            port: targetPort,
            path: agentPath,
            method: method,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Content-Length': data.length,
                ...identityHeaders
            }
        };
        const upstream = http.request(opts, upstreamRes => {
            res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
            upstreamRes.pipe(res, { end: true });
        });
        upstream.on('error', err => {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
        });
        upstream.end(data);
    });
    req.on('error', err => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'request error', detail: String(err) }));
    });
}

export function createAgentRouteEntries() {
    const routes = loadApiRoutes();
    const entries = [];
    for (const [agentName, route] of Object.entries(routes || {})) {
        if (!route || route.disabled) continue;
        const port = Number(route.hostPort);
        if (!Number.isFinite(port)) continue;
        const baseUrl = `http://127.0.0.1:${port}/mcp`;
        entries.push({ agentName, port, baseUrl, client: createAgentClient(baseUrl) });
    }
    return entries;
}

function annotateTool(tool, agentName) {
    const baseAnnotations = tool && typeof tool === 'object' && tool.annotations && typeof tool.annotations === 'object'
        ? tool.annotations
        : {};
    const routerAnnotations = baseAnnotations.router && typeof baseAnnotations.router === 'object'
        ? baseAnnotations.router
        : {};
    const annotations = {
        ...baseAnnotations,
        router: {
            ...routerAnnotations,
            agent: agentName
        }
    };
    return { ...tool, annotations };
}

function annotateResource(resource, agentName) {
    const baseAnnotations = resource && typeof resource === 'object' && resource.annotations && typeof resource.annotations === 'object'
        ? resource.annotations
        : {};
    const routerAnnotations = baseAnnotations.router && typeof baseAnnotations.router === 'object'
        ? baseAnnotations.router
        : {};
    const annotations = {
        ...baseAnnotations,
        router: {
            ...routerAnnotations,
            agent: agentName
        }
    };
    return { ...resource, annotations };
}

function isJsonRpcMessage(payload) {
    if (Array.isArray(payload)) {
        return payload.some(item => item && typeof item === 'object' && item.jsonrpc === '2.0');
    }
    return !!(payload && typeof payload === 'object' && payload.jsonrpc === '2.0');
}

function summarizeMcpError(err, action) {
    const raw = (err && err.message ? err.message : String(err || '')) || '';
    if (/invalid_literal/.test(raw) && /jsonrpc/.test(raw)) {
        return `${action} failed: agent response is not MCP JSON-RPC (AgentServer may be disabled).`;
    }
    if (/ECONNREFUSED/.test(raw)) {
        return `${action} failed: connection refused (AgentServer offline?).`;
    }
    if (/ENOTFOUND|EHOSTUNREACH/.test(raw)) {
        return `${action} failed: agent host is unreachable.`;
    }
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized.length) {
        return `${action} failed: unknown error.`;
    }
    const truncated = normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
    return `${action} failed: ${truncated}`;
}

async function collectTools(entries) {
    const toolsByAgent = new Map();
    const toolIndex = new Map();
    const errors = [];
    const failures = new Map();

    await Promise.all(entries.map(async (entry) => {
        try {
            const tools = await entry.client.listTools();
            toolsByAgent.set(entry.agentName, tools || []);
            for (const tool of tools || []) {
                const name = tool && tool.name ? String(tool.name) : null;
                if (!name) continue;
                if (!toolIndex.has(name)) {
                    toolIndex.set(name, []);
                }
                toolIndex.get(name).push({ entry, tool });
            }
        } catch (err) {
            const message = summarizeMcpError(err, 'listTools');
            errors.push({ agent: entry.agentName, error: message });
            failures.set(entry.agentName, message);
        }
    }));

    return { toolsByAgent, toolIndex, errors, failures };
}

async function collectResources(entries) {
    const resourcesByAgent = new Map();
    const errors = [];
    const failures = new Map();

    await Promise.all(entries.map(async (entry) => {
        try {
            const resources = await entry.client.listResources();
            resourcesByAgent.set(entry.agentName, resources || []);
        } catch (err) {
            const message = summarizeMcpError(err, 'listResources');
            errors.push({ agent: entry.agentName, error: message });
            failures.set(entry.agentName, message);
        }
    }));

    return { resourcesByAgent, errors, failures };
}

function readSessionHeader(req) {
    const value = req.headers['mcp-session-id'];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : null;
}

function getSession(sessionId) {
    if (!sessionId) return null;
    const entry = routerSessions.get(sessionId);
    if (!entry) return null;
    entry.lastSeen = Date.now();
    return entry;
}

function startSession() {
    const sessionId = randomUUID();
    routerSessions.set(sessionId, { createdAt: Date.now(), lastSeen: Date.now() });
    return sessionId;
}

function endSession(sessionId) {
    if (!sessionId) return;
    routerSessions.delete(sessionId);
}

function canonicalCommand(command) {
    if (typeof command !== 'string') return '';
    const trimmed = command.trim();
    if (!trimmed) return '';
    if (trimmed === 'tools/list') return 'list_tools';
    if (trimmed === 'tools/call') return 'tool';
    if (trimmed === 'resources/list') return 'list_resources';
    if (trimmed === 'resources/read') return 'resources/read';
    if (trimmed === 'ping') return 'ping';
    const lower = trimmed.toLowerCase();
    switch (lower) {
        case 'methods':
        case 'list_tools':
        case 'tools':
            return 'list_tools';
        case 'list_resources':
        case 'resources':
            return 'list_resources';
        case 'tool':
            return 'tool';
        case 'status':
            return 'status';
        case 'ping':
            return 'ping';
        default:
            return trimmed;
    }
}

async function executeRouterCommand(command, payload = {}) {
    const normalized = canonicalCommand(command);
    const entries = createAgentRouteEntries();
    if (!entries.length) {
        return {
            statusCode: 503,
            body: { error: 'no MCP agents are registered with the router' }
        };
    }

    try {
        switch (normalized) {
            case 'list_tools': {
                const { toolsByAgent, errors, failures } = await collectTools(entries);
                const aggregated = [];
                const emptyAgents = [];
                for (const entry of entries) {
                    if (failures.has(entry.agentName)) {
                        continue;
                    }
                    const tools = toolsByAgent.get(entry.agentName) || [];
                    if (!tools.length) {
                        emptyAgents.push(entry.agentName);
                        continue;
                    }
                    for (const tool of tools) {
                        aggregated.push(annotateTool(tool, entry.agentName));
                    }
                }
                return { statusCode: 200, body: { tools: aggregated, emptyAgents, errors } };
            }
            case 'list_resources': {
                const { resourcesByAgent, errors, failures } = await collectResources(entries);
                const aggregated = [];
                for (const entry of entries) {
                    if (failures.has(entry.agentName)) {
                        continue;
                    }
                    const resources = resourcesByAgent.get(entry.agentName) || [];
                    for (const resource of resources) {
                        aggregated.push(annotateResource(resource, entry.agentName));
                    }
                }
                return { statusCode: 200, body: { resources: aggregated, errors } };
            }
            case 'tool': {
                const requestedAgent = payload && payload.agent ? String(payload.agent) : null;
                const candidates = requestedAgent
                    ? entries.filter(entry => entry.agentName === requestedAgent)
                    : entries;

                if (requestedAgent && !candidates.length) {
                    return { statusCode: 404, body: { error: `agent '${requestedAgent}' is not registered` } };
                }

                const { toolIndex, errors, failures } = await collectTools(candidates);

                if (requestedAgent && failures.has(requestedAgent)) {
                    return { statusCode: 502, body: { error: failures.get(requestedAgent) } };
                }

                const toolName = payload && (payload.tool || payload.toolName || payload.name)
                    ? String(payload.tool || payload.toolName || payload.name)
                    : null;
                if (!toolName) {
                    return { statusCode: 400, body: { error: 'missing tool name (use tool=<name> or toolName=<name>)' } };
                }

                const matches = toolIndex.get(toolName) || [];
                const resolved = requestedAgent
                    ? matches.find(item => item.entry.agentName === requestedAgent) ?? null
                    : matches[0] ?? null;

                if (!resolved) {
                    if (matches.length > 1) {
                        const agents = matches.map(item => item.entry.agentName);
                        return { statusCode: 409, body: { error: `tool '${toolName}' is provided by multiple agents`, agents } };
                    }
                    return { statusCode: 404, body: { error: `tool '${toolName}' was not found`, errors } };
                }

                if (!requestedAgent && matches.length > 1) {
                    const agents = matches.map(item => item.entry.agentName);
                    return { statusCode: 409, body: { error: `tool '${toolName}' is provided by multiple agents`, agents, errors } };
                }

                const args = {};
                if (payload && typeof payload === 'object') {
                    const argPayload = payload['arguments'];
                    if (argPayload && typeof argPayload === 'object' && !Array.isArray(argPayload)) {
                        Object.assign(args, argPayload);
                    }
                    for (const [key, value] of Object.entries(payload)) {
                        if (['command', 'tool', 'toolName', 'agent', 'arguments', 'name'].includes(key)) continue;
                        args[key] = value;
                    }
                }

                const response = await resolved.entry.client.callTool(toolName, args);
                return {
                    statusCode: 200,
                    body: {
                        result: response,
                        agent: resolved.entry.agentName,
                        tool: toolName,
                        errors
                    }
                };
            }
            case 'resources/read': {
                const uri = payload && typeof payload.uri === 'string' ? payload.uri : null;
                if (!uri) {
                    return { statusCode: 400, body: { error: 'missing uri' } };
                }
                const requestedAgent = payload && payload.agent ? String(payload.agent) : null;
                const candidateEntries = requestedAgent
                    ? entries.filter(entry => entry.agentName === requestedAgent)
                    : entries;
                if (requestedAgent && !candidateEntries.length) {
                    return { statusCode: 404, body: { error: `agent '${requestedAgent}' is not registered` } };
                }
                const { resourcesByAgent, errors, failures } = await collectResources(candidateEntries);
                let resolvedEntry = null;
                for (const entry of candidateEntries) {
                    if (failures.has(entry.agentName)) {
                        continue;
                    }
                    const resources = resourcesByAgent.get(entry.agentName) || [];
                    if (resources.some(resource => resource && resource.uri === uri)) {
                        resolvedEntry = entry;
                        break;
                    }
                }
                if (!resolvedEntry) {
                    if (failures.size && !resourcesByAgent.size) {
                        return { statusCode: 502, body: { error: 'resource lookup failed due to upstream errors', errors } };
                    }
                    return { statusCode: 404, body: { error: `resource '${uri}' was not found`, errors } };
                }
                try {
                    const resource = await resolvedEntry.client.readResource(uri);
                    return { statusCode: 200, body: { resource, agent: resolvedEntry.agentName, errors } };
                } catch (err) {
                    const message = summarizeMcpError(err, 'readResource');
                    return { statusCode: 500, body: { error: message, errors } };
                }
            }
            case 'ping': {
                const requestedAgent = payload && payload.agent ? String(payload.agent) : null;
                if (!requestedAgent) {
                    return { statusCode: 400, body: { error: 'missing agent for ping' } };
                }
                const entry = entries.find(item => item.agentName === requestedAgent) || null;
                if (!entry) {
                    return { statusCode: 404, body: { error: `agent '${requestedAgent}' is not registered` } };
                }
                try {
                    const result = await entry.client.ping();
                    return { statusCode: 200, body: { result: result ?? {}, agent: entry.agentName } };
                } catch (err) {
                    const message = summarizeMcpError(err, 'ping');
                    return { statusCode: 502, body: { error: message } };
                }
            }
            case 'status': {
                return { statusCode: 400, body: { error: 'status command is not supported on aggregated endpoint' } };
            }
            default:
                return { statusCode: 400, body: { error: `unknown command '${command}'` } };
        }
    } catch (err) {
        const message = err && err.message ? err.message : String(err || 'unknown error');
        return { statusCode: 500, body: { error: message } };
    } finally {
        await Promise.all(entries.map(entry => entry.client.close().catch(() => { })));
    }
}

async function handleRouterJsonRpc(req, res, payload) {
    const isBatch = Array.isArray(payload);
    const messages = isBatch ? payload : [payload];
    if (!messages.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Empty request batch' }, id: null }));
        return;
    }

    const headerSessionId = readSessionHeader(req);
    const hasValidSession = headerSessionId && getSession(headerSessionId);
    let sessionIdForResponse = hasValidSession ? headerSessionId : null;

    const responses = [];

    for (const message of messages) {
        if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
            responses.push({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
            continue;
        }

        if (message.method === 'initialize') {
            const newSessionId = startSession();
            sessionIdForResponse = newSessionId;
            responses.push({
                jsonrpc: '2.0',
                id: message.id ?? null,
                result: {
                    protocolVersion: ROUTER_PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                        resources: { listChanged: false }
                    },
                    serverInfo: ROUTER_SERVER_INFO,
                    instructions: ROUTER_INSTRUCTIONS
                }
            });
            continue;
        }

        if (message.method === 'notifications/initialized') {
            if (sessionIdForResponse) {
                getSession(sessionIdForResponse);
            }
            continue;
        }

        const activeSessionId = sessionIdForResponse && getSession(sessionIdForResponse) ? sessionIdForResponse : null;
        if (!activeSessionId) {
            responses.push({
                jsonrpc: '2.0',
                id: message.id ?? null,
                error: { code: -32000, message: 'Missing or invalid MCP session' }
            });
            continue;
        }

        getSession(activeSessionId);

        try {
            let result;
            let rpcResultPayload = null;
            switch (message.method) {
                case 'tools/list':
                    result = await executeRouterCommand('list_tools');
                    if (result.statusCode < 400) {
                        const tools = Array.isArray(result.body?.tools) ? result.body.tools : [];
                        rpcResultPayload = { tools };
                    }
                    break;
                case 'resources/list':
                    result = await executeRouterCommand('list_resources');
                    if (result.statusCode < 400) {
                        const resources = Array.isArray(result.body?.resources) ? result.body.resources : [];
                        rpcResultPayload = { resources };
                    }
                    break;
                case 'tools/call': {
                    const params = message.params && typeof message.params === 'object' ? message.params : {};
                    const argPayload = params['arguments'] && typeof params['arguments'] === 'object' && !Array.isArray(params['arguments'])
                        ? params['arguments']
                        : {};
                    const commandPayload = {
                        arguments: argPayload
                    };
                    if (params.tool !== undefined) {
                        commandPayload.tool = params.tool;
                    }
                    if (typeof params.name === 'string' && !commandPayload.tool) {
                        commandPayload.tool = params.name;
                    }
                    if (params.agent !== undefined) {
                        commandPayload.agent = params.agent;
                    }
                    const metaAgent = params && params._meta && params._meta.router && typeof params._meta.router.agent === 'string'
                        ? params._meta.router.agent
                        : null;
                    if (metaAgent && !commandPayload.agent) {
                        commandPayload.agent = metaAgent;
                    }
                    result = await executeRouterCommand('tool', commandPayload);
                    if (result.statusCode < 400) {
                        rpcResultPayload = result.body?.result;
                    }
                    break;
                }
                case 'resources/read': {
                    const params = message.params && typeof message.params === 'object' ? message.params : {};
                    if (params._meta && params._meta.router && typeof params._meta.router.agent === 'string' && params.agent === undefined) {
                        params.agent = params._meta.router.agent;
                    }
                    result = await executeRouterCommand('resources/read', params);
                    if (result.statusCode < 400) {
                        rpcResultPayload = result.body?.resource;
                    }
                    break;
                }
                case 'ping': {
                    const params = message.params && typeof message.params === 'object' ? message.params : {};
                    if (params._meta && params._meta.router && typeof params._meta.router.agent === 'string' && params.agent === undefined) {
                        params.agent = params._meta.router.agent;
                    }
                    result = await executeRouterCommand('ping', params);
                    if (result.statusCode < 400) {
                        rpcResultPayload = result.body?.result ?? {};
                    }
                    break;
                }
                default:
                    responses.push({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: `Method not found: ${message.method}` } });
                    continue;
            }

            if (result.statusCode >= 400) {
                const messageText = result.body?.error || 'Router error';
                responses.push({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32000, message: messageText } });
            } else {
                responses.push({ jsonrpc: '2.0', id: message.id ?? null, result: rpcResultPayload });
            }
        } catch (err) {
            const messageText = err && err.message ? err.message : String(err || 'unknown error');
            responses.push({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: messageText } });
        }
    }

    const headers = { 'mcp-protocol-version': ROUTER_PROTOCOL_VERSION };
    if (sessionIdForResponse) {
        headers['mcp-session-id'] = sessionIdForResponse;
    }

    if (!responses.length) {
        res.writeHead(204, headers);
        res.end();
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(isBatch ? responses : responses[0]));
}

export async function handleRouterMcp(req, res) {
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, DELETE' });
        res.end(JSON.stringify({ error: 'event_stream_not_supported' }));
        return;
    }

    if (method === 'DELETE') {
        const sessionId = readSessionHeader(req);
        endSession(sessionId);
        res.writeHead(204);
        res.end();
        return;
    }

    if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, DELETE' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
        let payload;
        try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch (_) {
            payload = {};
        }

        try {
            if (isJsonRpcMessage(payload)) {
                await handleRouterJsonRpc(req, res, payload);
                return;
            }

            const command = payload && typeof payload.command === 'string' ? payload.command : '';
            const { statusCode, body } = await executeRouterCommand(command, payload);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        } catch (err) {
            const message = err && err.message ? err.message : String(err || 'unknown error');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
    });
    req.on('error', err => {
        sendJson(res, 500, { error: String(err && err.message || err) });
    });
}

export { ROUTING_FILE };
