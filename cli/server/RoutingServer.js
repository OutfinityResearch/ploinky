import http from 'http';
import fs from 'fs';
import path from 'path';
import { parse } from 'url';
import { fileURLToPath } from 'url';

import { handleWebTTY } from './handlers/webtty.js';
import { handleWebChat } from './handlers/webchat.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleWebMeet } from './handlers/webmeet.js';
import { handleStatus } from './handlers/status.js';
import { handleBlobs } from './handlers/blobs.js';
import * as staticSrv from './static/index.js';
import { resolveVarValue } from '../services/secretVars.js';
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
    proxyMcpPassthrough,
    handleRouterMcp
} from './routerHandlers.js';
import { createAgentClient } from './AgentClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_BROWSER_CLIENT_PATH = path.resolve(__dirname, '../../Agent/client/MCPBrowserClient.js');

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

const webttyFactory = (() => {
    if (!pty) {
        logBootEvent('webtty_factory_disabled', { reason: 'pty_unavailable' });
        return { factory: null, label: '-', runtime: 'disabled' };
    }
    if (createWebTTYLocalFactory) {
        const secretShell = resolveVarValue('WEBTTY_SHELL');
        const command = secretShell || process.env.WEBTTY_COMMAND || '';
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
        const containerName = process.env.WEBTTY_CONTAINER || 'ploinky_interactive';
        const factory = createWebTTYTTYFactory({ ptyLib: pty, runtime: 'docker', containerName });
        logBootEvent('webtty_container_factory_ready', { containerName });
        return {
            factory,
            label: containerName,
            runtime: 'docker'
        };
    }
    logBootEvent('webtty_factory_disabled', { reason: 'no_factory_available' });
    return { factory: null, label: '-', runtime: 'disabled' };
})();

const webchatFactory = (() => {
    if (!pty) {
        logBootEvent('webchat_factory_disabled', { reason: 'pty_unavailable' });
        return { factory: null, label: '-', runtime: 'disabled' };
    }
    if (createWebChatLocalFactory) {
        const secretCommand = resolveVarValue('WEBCHAT_COMMAND');
        const command = secretCommand || process.env.WEBCHAT_COMMAND || '';
        const factory = buildLocalFactory(createWebChatLocalFactory, { command });
        if (factory) {
            logBootEvent('webchat_local_process_factory_ready', { command: command || null });
        }
        return {
            factory,
            label: command ? command : 'local shell',
            runtime: 'local'
        };
    }
    if (createWebChatTTYFactory) {
        const containerName = process.env.WEBCHAT_CONTAINER || 'ploinky_chat';
        const factory = createWebChatTTYFactory({ ptyLib: pty, runtime: 'docker', containerName });
        logBootEvent('webchat_container_factory_ready', { containerName });
        return {
            factory,
            label: containerName,
            runtime: 'docker'
        };
    }
    logBootEvent('webchat_factory_disabled', { reason: 'no_factory_available' });
    return { factory: null, label: '-', runtime: 'disabled' };
})();

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

const envAppName = getAppName();

const config = {
    webtty: {
        ttyFactory: webttyFactory.factory,
        agentName: 'Router',
        containerName: webttyFactory.label,
        runtime: webttyFactory.runtime
    },
    webchat: {
        ttyFactory: webchatFactory.factory,
        agentName: envAppName || 'ChatAgent',
        containerName: webchatFactory.label,
        runtime: webchatFactory.runtime
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
        const isMcpPassthrough = subPath === 'mcp' || subPath.startsWith('mcp/');
        if (isMcpPassthrough) {
            const agentPath = subPath.length ? `/${subPath}` : '/mcp';
            proxyMcpPassthrough(req, res, Number(route.hostPort), agentPath);
            return;
        }

        const method = (req.method || 'GET').toUpperCase();
        const baseUrl = `http://127.0.0.1:${route.hostPort}/mcp`;
        const agentClient = createAgentClient(baseUrl);

        const finish = async (payload) => {
            try {
                const command = (payload && payload.command) ? String(payload.command) : '';
                if (command === 'methods') {
                    const tools = await agentClient.listTools();
                    const names = tools.map(t => t.name || t.title || '');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(names));
                }
                if (command === 'status') {
                    try {
                        const rr = await agentClient.readResource('health://status');
                        let ok = true;
                        const text = rr.contents && rr.contents[0] && rr.contents[0].text;
                        if (text) { try { ok = !!(JSON.parse(text).ok); } catch (_) { } }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: ok }));
                    } catch (_) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: true }));
                    }
                }

                if (payload && payload.tool) {
                    const toolName = String(payload.tool);
                    const { tool, command: _command, ...args } = payload;
                    const result = await agentClient.callTool(toolName, args);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: true, result }));
                }

                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: 'unknown command' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
            } finally {
                await agentClient.close().catch(() => { });
            }
        };

        if (method === 'GET') {
            const parsedQuery = parsedUrl && parsedUrl.query && typeof parsedUrl.query === 'object' ? parsedUrl.query : {};
            return void finish(parsedQuery);
        }

        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { payload = {}; }
            void finish(payload);
        });
        req.on('error', err => {
            sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
        });
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
