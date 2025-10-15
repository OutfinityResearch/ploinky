import http from 'http';
import fs from 'fs';
import path from 'path';
import { parse } from 'url';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';

import { handleWebTTY } from './handlers/webtty.js';
import { handleWebChat } from './handlers/webchat.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleWebMeet } from './handlers/webmeet.js';
import { handleStatus } from './handlers/status.js';
import { handleBlobs } from './handlers/blobs.js';
import * as staticSrv from './static/index.js';
import { resolveVarValue } from '../services/secretVars.js';
import { configCache } from './configCache.js';
import {
    ensureAuthenticated,
    handleAuthRoutes,
    sendJson,
    getAppName
} from './authHandlers.js';
import {
    appendLog,
    logBootEvent
} from './logger.js';
import {
    loadApiRoutes,
    handleRouterMcp
} from './routerHandlers.js';
import { createAgentClient } from './AgentClient.js';
import { resolveWebchatCommands } from './webchat/commandResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_BROWSER_CLIENT_PATH = path.resolve(__dirname, '../../Agent/client/MCPBrowserClient.js');
const AGENT_PROXY_PROTOCOL_VERSION = '2025-06-18';
const AGENT_PROXY_SERVER_INFO = { name: 'ploinky-router-proxy', version: '1.0.0' };

const agentSessionStore = new Map();
const resolvedWebchatCommands = resolveWebchatCommands();
if (resolvedWebchatCommands.source === 'manifest' && resolvedWebchatCommands.agentName) {
    logBootEvent('webchat_manifest_cli_fallback', { agent: resolvedWebchatCommands.agentName });
}

function readAgentSessionId(req) {
    const value = req.headers['mcp-session-id'];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : null;
}

function isJsonRpcPayload(payload) {
    if (Array.isArray(payload)) {
        return payload.some(item => item && typeof item === 'object' && item.jsonrpc === '2.0');
    }
    return !!(payload && typeof payload === 'object' && payload.jsonrpc === '2.0');
}

let pty = null;
try {
    const ptyModule = await import('node-pty');
    pty = ptyModule.default || ptyModule;
} catch (error) {
    const reason = error?.message || error;
    console.warn('node-pty not found, TTY features will be disabled.');
    if (reason) {
        console.warn(`node-pty load failure: ${reason}`);
    }
    logBootEvent('pty_unavailable', { reason: reason || 'unknown' });
}

async function loadTTYModule(primaryRelative, legacyRelative) {
    try {
        const mod = await import(new URL(primaryRelative, import.meta.url));
        return mod.default || mod;
    } catch (primaryError) {
        if (legacyRelative) {
            try {
                const legacy = await import(new URL(legacyRelative, import.meta.url));
                return legacy.default || legacy;
            } catch (_) { }
        }
        throw primaryError;
    }
}

let webttyTTYModule = {};
if (pty) {
    try {
        webttyTTYModule = await loadTTYModule('./webtty/tty.js', './webtty/webtty-ttyFactory.js');
    } catch (_) {
        console.warn('WebTTY TTY factory unavailable.');
        webttyTTYModule = {};
    }
}

let webchatTTYModule = {};
if (pty) {
    try {
        webchatTTYModule = await loadTTYModule('./webchat/tty.js', './webchat/webchat-ttyFactory.js');
    } catch (_) {
        console.warn('WebChat TTY factory unavailable.');
        webchatTTYModule = {};
    }
}

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

const {
    createTTYFactory: createWebTTYTTYFactory,
    createLocalTTYFactory: createWebTTYLocalFactory
} = webttyTTYModule;
const {
    createTTYFactory: createWebChatTTYFactory,
    createLocalTTYFactory: createWebChatLocalFactory
} = webchatTTYModule;

function buildLocalFactory(createFactoryFn, defaults = {}) {
    if (!pty || !createFactoryFn) return null;
    return createFactoryFn({ ptyLib: pty, workdir: process.cwd(), ...defaults });
}

function getWebttyFactory() {
    return configCache.getOrCreate(
        'webtty',
        () => ({
            shell: resolveVarValue('WEBTTY_SHELL'),
            command: process.env.WEBTTY_COMMAND || '',
            container: process.env.WEBTTY_CONTAINER || 'ploinky_interactive'
        }),
        (config) => {
            if (!pty) {
                logBootEvent('webtty_factory_disabled', { reason: 'pty_unavailable' });
                return { factory: null, label: '-', runtime: 'disabled' };
            }
            if (createWebTTYLocalFactory) {
                const command = config.shell || config.command;
                const factory = buildLocalFactory(createWebTTYLocalFactory, { command });
                if (factory) {
                    logBootEvent('webtty_local_process_factory_ready', { command: command || null });
                }
                return {
                    factory,
                    label: command ? command : 'local shell',
                    runtime: 'local'
                };
            }
            if (createWebTTYTTYFactory) {
                const factory = createWebTTYTTYFactory({ ptyLib: pty, runtime: 'docker', containerName: config.container });
                logBootEvent('webtty_container_factory_ready', { containerName: config.container });
                return {
                    factory,
                    label: config.container,
                    runtime: 'docker'
                };
            }
            logBootEvent('webtty_factory_disabled', { reason: 'no_factory_available' });
            return { factory: null, label: '-', runtime: 'disabled' };
        }
    );
}

function getWebchatFactory() {
    return configCache.getOrCreate(
        'webchat',
        () => ({
            container: process.env.WEBCHAT_CONTAINER || 'ploinky_chat',
            hostCommand: resolvedWebchatCommands.host,
            containerCommand: resolvedWebchatCommands.container,
            source: resolvedWebchatCommands.source
        }),
        (config) => {
            if (!pty) {
                logBootEvent('webchat_factory_disabled', { reason: 'pty_unavailable' });
                return { factory: null, label: '-', runtime: 'disabled' };
            }
            if (createWebChatLocalFactory) {
                const command = config.hostCommand;
                const factory = buildLocalFactory(createWebChatLocalFactory, { command });
                if (factory) {
                    logBootEvent('webchat_local_process_factory_ready', {
                        command: command || null,
                        source: config.source
                    });
                }
                return {
                    factory,
                    label: command ? command : 'local shell',
                    runtime: 'local'
                };
            }
            if (createWebChatTTYFactory) {
                const entry = config.containerCommand;
                const factory = createWebChatTTYFactory({ ptyLib: pty, runtime: 'docker', containerName: config.container, entry });
                logBootEvent('webchat_container_factory_ready', {
                    containerName: config.container,
                    command: entry || null,
                    source: config.source
                });
                return {
                    factory,
                    label: config.container,
                    runtime: 'docker'
                };
            }
            logBootEvent('webchat_factory_disabled', { reason: 'no_factory_available' });
            return { factory: null, label: '-', runtime: 'disabled' };
        }
    );
}

const PID_FILE = process.env.PLOINKY_ROUTER_PID_FILE || null;

function ensurePidFile() {
    if (!PID_FILE) return;
    try {
        fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
        fs.writeFileSync(PID_FILE, String(process.pid));
    } catch (_) { }
}

function clearPidFile() {
    if (!PID_FILE) return;
    try { fs.unlinkSync(PID_FILE); }
    catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.warn(`Failed to remove router pid file: ${PID_FILE}`);
        }
    }
}

ensurePidFile();
process.on('exit', clearPidFile);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
    process.on(sig, () => {
        clearPidFile();
        process.exit(0);
    });
}

const config = {
    get webtty() {
        const factory = getWebttyFactory();
        return {
            ttyFactory: factory.factory,
            agentName: 'Router',
            containerName: factory.label,
            runtime: factory.runtime
        };
    },
    get webchat() {
        const factory = getWebchatFactory();
        const appName = getAppName(); // Always get fresh APP_NAME
        return {
            ttyFactory: factory.factory,
            agentName: appName || 'ChatAgent',
            containerName: factory.label,
            runtime: factory.runtime
        };
    },
    dashboard: {
        agentName: 'Dashboard',
        containerName: '-',
        runtime: 'local'
    },
    webmeet: {
        agentName: 'WebMeet',
        containerName: '-',
        runtime: 'local'
    },
    status: {
        agentName: 'Status',
        containerName: '-',
        runtime: 'local'
    }
};

const globalState = {
    webtty: { sessions: new Map() },
    webchat: { sessions: new Map() },
    dashboard: { sessions: new Map() },
    webmeet: {
        sessions: new Map(),
        participants: new Map(),
        chatHistory: [],
        privateHistory: new Map(),
        nextMsgId: 1,
        queue: [],
        currentSpeaker: null
    },
    status: { sessions: new Map() }
};

function serveMcpBrowserClient(req, res) {
    let stats;
    try {
        stats = fs.statSync(MCP_BROWSER_CLIENT_PATH);
        if (!stats.isFile()) throw new Error('not a file');
    } catch (err) {
        appendLog('mcp_client_missing', { error: err?.message || String(err) });
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    appendLog('mcp_client_request', { method: req.method });
    res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Length': stats.size
    });

    if (req.method === 'HEAD') {
        res.end();
        return;
    }

    const stream = fs.createReadStream(MCP_BROWSER_CLIENT_PATH);
    stream.on('error', err => {
        appendLog('mcp_client_stream_error', { error: err?.message || String(err) });
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
    });
    stream.pipe(res);
}

async function processRequest(req, res) {
    const parsedUrl = parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    appendLog('http_request', { method: req.method, path: pathname });

    if (pathname === '/MCPBrowserClient.js') {
        serveMcpBrowserClient(req, res);
        return;
    }

    if (pathname.startsWith('/auth/')) {
        const handled = await handleAuthRoutes(req, res, parsedUrl);
        if (handled) return;
    }

    const authResult = await ensureAuthenticated(req, res, parsedUrl);
    if (!authResult.ok) return;

    if (pathname.startsWith('/webtty')) {
        return handleWebTTY(req, res, config.webtty, globalState.webtty);
    } else if (pathname.startsWith('/webchat')) {
        return handleWebChat(req, res, config.webchat, globalState.webchat);
    } else if (pathname.startsWith('/dashboard')) {
        return handleDashboard(req, res, config.dashboard, globalState.dashboard);
    } else if (pathname.startsWith('/webmeet')) {
        return handleWebMeet(req, res, config.webmeet, globalState.webmeet);
    } else if (pathname.startsWith('/status')) {
        return handleStatus(req, res, config.status, globalState.status);
    } else if (pathname.startsWith('/blobs')) {
        return handleBlobs(req, res);
    } else if (pathname === '/mcp' || pathname === '/mcp/') {
        return handleRouterMcp(req, res);
    } else if (pathname.startsWith('/mcps/') || pathname.startsWith('/mcp/')) {
        const apiRoutes = loadApiRoutes();
        const parts = pathname.split('/');
        const agent = parts[2];
        if (!agent) {
            res.writeHead(404);
            return res.end('API Route not found');
        }

        const route = apiRoutes[agent];
        if (!route || !route.hostPort) {
            res.writeHead(404);
            return res.end('API Route not found');
        }

        const subPath = parts.slice(3).join('/');
        if (subPath === 'mcp' || subPath.startsWith('mcp/')) {
            handleAgentMcpRequest(req, res, route, agent);
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found. Use /mcps/<agent>/mcp for MCP access.' }));
        return;
    } else {
        if (staticSrv.serveAgentStaticRequest(req, res)) return;
        if (staticSrv.serveStaticRequest(req, res)) return;
        res.writeHead(404);
        return res.end('Not Found');
    }
}

const server = http.createServer((req, res) => {
    processRequest(req, res).catch(err => {
        appendLog('request_error', { error: err?.message || String(err) });
        if (!res.headersSent) {
            try { sendJson(res, 500, { ok: false, error: 'internal_error' }); } catch (_) {
                try { res.end(); } catch (_) { }
            }
        } else {
            try { res.end(); } catch (_) { }
        }
    });
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
server.listen(port, () => {
    console.log(`[RoutingServer] Ploinky server running on http://127.0.0.1:${port}`);
    console.log('  Dashboard: /dashboard');
    console.log('  WebTTY:    /webtty');
    console.log('  WebChat:   /webchat');
    console.log('  WebMeet:   /webmeet');
    console.log('  Status:    /status');
    appendLog('server_start', { port });
    logBootEvent('server_listening', { port });
});
