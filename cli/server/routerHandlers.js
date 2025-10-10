import http from 'http';
import fs from 'fs';
import path from 'path';
import { parse } from 'url';
import { parse as parseQueryString } from 'querystring';

import { sendJson } from './authHandlers.js';
import { createAgentClient } from './AgentClient.js';

const ROUTING_DIR = path.resolve('.ploinky');
const ROUTING_FILE = path.join(ROUTING_DIR, 'routing.json');

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
            res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(err) }));
        });
        upstream.end(data);
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'proxy failure', detail: String(err) }));
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
        res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(err) }));
    });

    req.on('aborted', () => {
        upstream.destroy();
    });

    req.pipe(upstream, { end: true });
}

export function proxyApi(req, res, targetPort, identityHeaders = {}) {
    const method = (req.method || 'GET').toUpperCase();
    const parsed = parse(req.url || '', true);
    const includeSearch = method !== 'GET';
    const agentPath = buildAgentPath(parsed, includeSearch);
    if (method === 'GET') {
        const params = parsed && parsed.query && typeof parsed.query === 'object'
            ? parsed.query
            : parseQueryString(parsed ? parsed.query : '');
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
            res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(err) }));
        });
        upstream.end(data);
    });
    req.on('error', err => {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'request error', detail: String(err) }));
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

export async function handleRouterMcp(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    const parsed = parse(req.url || '', true);

    const sendResponse = (statusCode, body) => {
        try {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        } catch (_) { }
        res.end(JSON.stringify(body));
    };

    const processPayload = async (rawPayload) => {
        const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
        const command = typeof payload.command === 'string' ? payload.command : '';
        const entries = createAgentRouteEntries();
        if (!entries.length) {
            return sendResponse(503, { ok: false, error: 'no MCP agents are registered with the router' });
        }

        const errors = [];
        const toolsByAgent = new Map();
        const toolIndex = new Map();
        const resourcesByAgent = new Map();

        const summarizeMcpError = (err, action) => {
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
        };

        const collectTools = async (selectedEntries) => {
            await Promise.all(selectedEntries.map(async (entry) => {
                try {
                    const tools = await entry.client.listTools();
                    toolsByAgent.set(entry.agentName, tools);
                    for (const tool of tools || []) {
                        const name = tool && tool.name ? String(tool.name) : null;
                        if (!name) continue;
                        if (!toolIndex.has(name)) toolIndex.set(name, []);
                        toolIndex.get(name).push({ entry, tool });
                    }
                } catch (err) {
                    errors.push({ agent: entry.agentName, error: summarizeMcpError(err, 'listTools') });
                }
            }));
        };

        const collectResources = async (selectedEntries) => {
            await Promise.all(selectedEntries.map(async (entry) => {
                try {
                    const resources = await entry.client.listResources();
                    resourcesByAgent.set(entry.agentName, resources);
                } catch (err) {
                    errors.push({ agent: entry.agentName, error: summarizeMcpError(err, 'listResources') });
                }
            }));
        };

        try {
            if (command === 'methods' || command === 'list_tools' || command === 'tools') {
                await collectTools(entries);
                const aggregated = [];
                const emptyAgents = [];
                for (const entry of entries) {
                    if (!toolsByAgent.has(entry.agentName)) continue;
                    const tools = toolsByAgent.get(entry.agentName) || [];
                    if (!tools.length) {
                        emptyAgents.push(entry.agentName);
                        continue;
                    }
                    for (const tool of tools) {
                        aggregated.push({ agent: entry.agentName, ...tool });
                    }
                }
                return sendResponse(200, { ok: true, tools: aggregated, emptyAgents, errors });
            }

            if (command === 'resources' || command === 'list_resources') {
                await collectResources(entries);
                const aggregated = [];
                for (const entry of entries) {
                    const resources = resourcesByAgent.get(entry.agentName) || [];
                    for (const resource of resources || []) {
                        aggregated.push({ agent: entry.agentName, ...resource });
                    }
                }
                return sendResponse(200, { ok: true, resources: aggregated, errors });
            }

            if (command === 'tool') {
                const requestedAgent = payload.agent ? String(payload.agent) : null;
                const candidates = requestedAgent
                    ? entries.filter(entry => entry.agentName === requestedAgent)
                    : entries;

                if (requestedAgent && !candidates.length) {
                    return sendResponse(404, { ok: false, error: `agent '${requestedAgent}' is not registered` });
                }

                await collectTools(candidates);

                const toolName = payload.tool || payload.toolName;
                if (!toolName) {
                    return sendResponse(400, { ok: false, error: 'missing tool name (use tool=<name> or toolName=<name>)' });
                }
                const matches = toolIndex.get(String(toolName)) || [];

                const resolved = requestedAgent
                    ? matches.find(entry => entry.entry.agentName === requestedAgent)
                    : matches[0];

                if (!resolved) {
                    if (matches.length > 1) {
                        const agents = matches.map(m => m.entry.agentName);
                        return sendResponse(409, { ok: false, error: `tool '${toolName}' is provided by multiple agents`, agents });
                    }
                    return sendResponse(404, { ok: false, error: `tool '${toolName}' was not found` });
                }

                if (!requestedAgent && matches.length > 1) {
                    const agents = matches.map(m => m.entry.agentName);
                    return sendResponse(409, { ok: false, error: `tool '${toolName}' is provided by multiple agents`, agents });
                }

                const args = { ...payload };
                delete args.command;
                delete args.tool;
                delete args.toolName;
                delete args.agent;

                const response = await resolved.entry.client.callTool(String(toolName), args);
                return sendResponse(200, {
                    ok: true,
                    agent: resolved.entry.agentName,
                    tool: String(toolName),
                    result: response,
                    errors
                });
            }

            return sendResponse(400, { ok: false, error: `unknown command '${command}'` });
        } catch (err) {
            return sendResponse(500, { ok: false, error: String(err && err.message || err) });
        } finally {
            await Promise.all(entries.map(entry => entry.client.close().catch(() => { })));
        }
    };

    if (method === 'GET') {
        const payload = parsed && parsed.query && typeof parsed.query === 'object' ? parsed.query : {};
        processPayload(payload).catch(() => { });
        return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        let payload = {};
        try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch (_) {
            payload = {};
        }
        processPayload(payload).catch(() => { });
    });
    req.on('error', err => {
        sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
    });
}

export { ROUTING_FILE };
