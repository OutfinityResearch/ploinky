import { randomUUID } from 'node:crypto';
import { sendJson, ensureAuthenticated } from '../authHandlers.js';
import { createAgentClient } from '../AgentClient.js';
import { waitForAgentReady } from '../utils/agentReadiness.js';
import {
    buildFirstPartyInvocation,
    buildDelegatedInvocation,
    resolveProviderForConsumerAlias
} from './secureWire.js';
import { getAgentDescriptorByPrincipal } from '../../services/capabilityRegistry.js';

const AGENT_PROXY_PROTOCOL_VERSION = '2025-06-18';
const AGENT_PROXY_SERVER_INFO = { name: 'ploinky-router-proxy', version: '1.0.0' };
const PLOINKY_AUTH_INFO_HEADER = 'x-ploinky-auth-info';
const INVOCATION_TOKEN_HEADER = 'x-ploinky-invocation';
const CALLER_ASSERTION_HEADER = 'x-ploinky-caller-assertion';

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

function encodeAuthInfoHeader(authInfo = null) {
    if (!authInfo || typeof authInfo !== 'object') return '';
    try {
        return Buffer.from(JSON.stringify(authInfo), 'utf8').toString('base64');
    } catch {
        return '';
    }
}

function isSecureWireEnabled() {
    const flag = String(process.env.PLOINKY_SECURE_WIRE || '').trim().toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off') return false;
    return true;
}

function isLegacyCompatibilityAllowed() {
    const flag = String(process.env.PLOINKY_SECURE_WIRE_STRICT || '').trim().toLowerCase();
    // When STRICT is 1/true/on, we stop emitting the legacy blob. Default:
    // emit both during migration so old agents keep working.
    if (flag === '1' || flag === 'true' || flag === 'on') return false;
    return true;
}

function resolveProviderAgentRef(agentName) {
    // agentName is typically the short route name. Find the full repo/agent
    // reference so the capability registry can resolve principal/contract.
    try {
        const descriptor = getAgentDescriptorByPrincipal(`agent:${agentName}`);
        if (descriptor) return descriptor.agentRef;
    } catch (_) {}
    return agentName;
}

function buildCallerAssertionInputs(req) {
    const rawAssertion = req.headers?.[CALLER_ASSERTION_HEADER] || req.headers?.[CALLER_ASSERTION_HEADER.toLowerCase()];
    if (typeof rawAssertion === 'string' && rawAssertion) {
        return { callerAssertionToken: rawAssertion.trim() };
    }
    return null;
}

function buildInvocationContextForProviderCall({ req, agentName, toolName, toolArgs }) {
    if (!isSecureWireEnabled()) return null;
    const providerAgentRef = resolveProviderAgentRef(agentName);
    const bodyObject = { tool: toolName, arguments: toolArgs || {} };
    const delegatedUser = req.user && typeof req.user === 'object'
        ? {
            id: req.user.id || '',
            username: req.user.username || req.user.name || req.user.email || '',
            email: req.user.email || '',
            roles: Array.isArray(req.user.roles) ? [...req.user.roles] : []
        }
        : null;

    const assertionInput = buildCallerAssertionInputs(req);
    if (assertionInput?.callerAssertionToken) {
        return buildDelegatedInvocation({
            callerAssertionToken: assertionInput.callerAssertionToken,
            bodyObject,
            providerAgentRef,
            tool: toolName,
            delegatedUser
        });
    }
    return buildFirstPartyInvocation({
        providerAgentRef,
        tool: toolName,
        bodyObject,
        delegatedUser,
        sessionId: req.sessionId,
        // Scope/binding remain empty for direct browser/first-party calls
        // (provider is expected to accept them based on audience + signed
        // first-party issuer when no binding is involved).
        scope: []
    });
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

    // Build the shared legacy auth blob (used only during migration when
    // PLOINKY_SECURE_WIRE_STRICT is not set). Downstream providers must not
    // treat this as a trust source once secure mode is enforced.
    let legacyAuthHeaders = null;
    if (req.user && typeof req.user === 'object' && isLegacyCompatibilityAllowed()) {
        const authInfo = {
            user: {
                id: req.user.id || '',
                username: req.user.username || req.user.name || req.user.email || '',
                email: req.user.email || '',
                roles: Array.isArray(req.user.roles) ? [...req.user.roles] : [],
            },
            sessionId: req.sessionId || '',
        };
        const encoded = encodeAuthInfoHeader(authInfo);
        if (encoded) {
            legacyAuthHeaders = { [PLOINKY_AUTH_INFO_HEADER]: encoded };
        }
    }

    function buildRequestHeadersForToolCall(toolName, toolArgs) {
        const headers = legacyAuthHeaders ? { ...legacyAuthHeaders } : {};
        const ctx = buildInvocationContextForProviderCall({
            req,
            agentName,
            toolName,
            toolArgs: toolArgs || {}
        });
        if (ctx?.token) {
            headers[INVOCATION_TOKEN_HEADER] = ctx.token;
        }
        return Object.keys(headers).length ? headers : null;
    }

    const listHeaders = legacyAuthHeaders ? { ...legacyAuthHeaders } : null;
    const agentClient = createAgentClient(baseUrl, listHeaders ? { requestHeaders: listHeaders } : undefined);
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
                    ? { ...argPayload }
                    : {};

                // Mint a router-signed invocation token scoped to this tool call
                // and open a short-lived client with that token in the header.
                const toolHeaders = buildRequestHeadersForToolCall(name, args);
                const toolClient = createAgentClient(baseUrl, toolHeaders ? { requestHeaders: toolHeaders } : undefined);

                try {
                    if (req.user && typeof req.user === 'object' && isLegacyCompatibilityAllowed()) {
                        // Transitional: keep _meta.auth during migration for old tool
                        // wrappers that still read it. This will be removed once all
                        // providers verify invocation tokens.
                        const authMeta = {
                            user: {
                                id: req.user.id || '',
                                username: req.user.username || req.user.name || req.user.email || '',
                                email: req.user.email || '',
                                roles: Array.isArray(req.user.roles) ? [...req.user.roles] : [],
                            },
                            sessionId: req.sessionId || '',
                        };
                        const nextMeta = args._meta && typeof args._meta === 'object' ? { ...args._meta } : {};
                        nextMeta.auth = authMeta;
                        args._meta = nextMeta;

                        const nextParams = args.params && typeof args.params === 'object' && !Array.isArray(args.params)
                            ? { ...args.params }
                            : {};
                        const nextParamsMeta = nextParams._meta && typeof nextParams._meta === 'object'
                            ? { ...nextParams._meta }
                            : {};
                        nextParamsMeta.auth = authMeta;
                        nextParams._meta = nextParamsMeta;
                        args.params = nextParams;
                    }
                    const result = await toolClient.callTool(name, args);
                    sendResponse(200, { jsonrpc: '2.0', id: message.id ?? null, result }, sessionIdHeader);
                } finally {
                    await toolClient.close().catch(() => {});
                }
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
async function handleAgentMcpRequest(req, res, route, agentName) {
    const method = (req.method || 'GET').toUpperCase();
    const hasCallerAssertion = typeof req.headers?.[CALLER_ASSERTION_HEADER] === 'string'
        || typeof req.headers?.[CALLER_ASSERTION_HEADER.toLowerCase()] === 'string';

    // Defensive auth attach for browser MCP calls. The router should already do this,
    // but the proxy must not rely on auth context being pre-populated if cookies exist.
    if (!req.agent && !req.user && !hasCallerAssertion) {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const authResult = await ensureAuthenticated(req, res, parsedUrl);
        if (!authResult.ok) {
            return;
        }
    }

    // Check agent authorization if agent authentication was used
    if (req.agent) {
        const allowedTargets = req.agent.allowedTargets || [];
        const isAllowed = allowedTargets.includes('*') || allowedTargets.includes(agentName);
        if (!isAllowed) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'forbidden',
                detail: `Agent '${req.agent.name}' is not authorized to access agent '${agentName}'`
            }));
            return;
        }
    }

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

        const isJsonRpc = isJsonRpcPayload(payload);
        const isReady = await waitForAgentReady(route, {
            timeoutMs: 5000,
            intervalMs: 125,
            probeTimeoutMs: 250
        });
        if (!isReady) {
            if (isJsonRpc) {
                const message = Array.isArray(payload) ? payload[0] : payload;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message?.id ?? null,
                    error: {
                        code: -32000,
                        message: `Agent '${agentName}' is still starting. Try again in a moment.`
                    }
                }));
                return;
            }
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'agent_not_ready',
                detail: `Agent '${agentName}' is still starting.`
            }));
            return;
        }

        try {
            if (isJsonRpc) {
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
