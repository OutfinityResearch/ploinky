import { randomUUID } from 'node:crypto';
import { sendJson } from '../authHandlers.js';
import { createAgentClient } from '../AgentClient.js';

const AGENT_PROXY_PROTOCOL_VERSION = '2025-06-18';
const AGENT_PROXY_SERVER_INFO = { name: 'ploinky-router-proxy', version: '1.0.0' };

// Session store for agent MCP connections
const agentSessionStore = new Map();

/**
 * Read MCP session ID from request headers
 */
function readAgentSessionId(req) {
    const value = req.headers['mcp-session-id'];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : null;
}

/**
 * Check if payload is a JSON-RPC request
 */
function isJsonRpcPayload(payload) {
    if (Array.isArray(payload)) {
        return payload.some(item => item && typeof item === 'object' && item.jsonrpc === '2.0');
    }
    return !!(payload && typeof payload === 'object' && payload.jsonrpc === '2.0');
}

/**
 * Handle JSON-RPC requests to agent MCP endpoints
 */
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

    const headersForSession = (sessionId) => {
        const headers = { 'mcp-protocol-version': AGENT_PROXY_PROTOCOL_VERSION };
        if (sessionId) headers['mcp-session-id'] = sessionId;
        return headers;
    };

    const sendResponse = (statusCode, body, sessionId) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headersForSession(sessionId) });
        res.end(JSON.stringify(body));
    };

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

    if (message.method === 'notifications/initialized') {
        const responseHeaders = headersForSession(sessionEntry ? sessionIdHeader : null);
        res.writeHead(204, responseHeaders);
        res.end();
        return;
    }

    if (!sessionEntry || sessionEntry.agentName !== agentName) {
        sendResponse(200, {
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32000, message: 'Missing or invalid MCP session' }
        }, null);
        return;
    }

    const agentClient = createAgentClient(baseUrl);
    try {
        switch (message.method) {
            case 'tools/list': {
                const tools = await agentClient.listTools();
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result: { tools } }, sessionIdHeader);
                break;
            }
            case 'resources/list': {
                const resources = await agentClient.listResources();
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result: { resources } }, sessionIdHeader);
                break;
            }
            case 'tools/call': {
                const params = message.params && typeof message.params === 'object' ? message.params : {};
                const name = typeof params.name === 'string' ? params.name : typeof params.tool === 'string' ? params.tool : null;
                if (!name) {
                    sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32602, message: 'Missing tool name' } }, sessionIdHeader);
                    break;
                }
                const argPayload = params && typeof params === 'object' ? params['arguments'] : null;
                const args = argPayload && typeof argPayload === 'object' && !Array.isArray(argPayload)
                    ? argPayload
                    : {};
                const result = await agentClient.callTool(name, args);
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result }, sessionIdHeader);
                break;
            }
            case 'resources/read': {
                const params = message.params && typeof message.params === 'object' ? message.params : {};
                const uri = typeof params.uri === 'string' ? params.uri : null;
                if (!uri) {
                    sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32602, message: 'Missing resource uri' } }, sessionIdHeader);
                    break;
                }
                const result = await agentClient.readResource(uri);
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result }, sessionIdHeader);
                break;
            }
            case 'ping': {
                await agentClient.ping();
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result: {} }, sessionIdHeader);
                break;
            }
            default:
                sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: `Method not found: ${message.method}` } }, sessionIdHeader);
        }
    } catch (err) {
        const messageText = err && err.message ? err.message : String(err || 'unknown error');
        sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32000, message: messageText } }, sessionIdHeader);
    } finally {
        await agentClient.close().catch(() => { });
    }
}

/**
 * Handle HTTP requests to agent MCP endpoints
 */
function handleAgentMcpRequest(req, res, route, agentName) {
    const method = (req.method || 'GET').toUpperCase();

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
            if (isJsonRpcPayload(payload)) {
                await handleAgentJsonRpc(req, res, route, agentName, payload);
                return;
            }

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unsupported request for agent MCP proxy' }));
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

export {
    agentSessionStore,
    handleAgentMcpRequest,
    readAgentSessionId,
    isJsonRpcPayload,
    handleAgentJsonRpc
};
