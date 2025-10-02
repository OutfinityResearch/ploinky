import http from 'http';
import fs from 'fs';
import path from 'path';
import { parse } from 'url';
import { parse as parseQueryString } from 'querystring';
import { fileURLToPath } from 'url';

import { handleWebTTY } from './handlers/webtty.js';
import { handleWebChat } from './handlers/webchat.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleWebMeet } from './handlers/webmeet.js';
import { handleStatus } from './handlers/status.js';
import { handleBlobs } from './handlers/blobs.js';
import * as staticSrv from './static/index.js';
import { resolveVarValue } from '../services/secretVars.js';
import { createAgentClient } from './AgentClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pty = null;
try {
  const ptyModule = await import('node-pty');
  pty = ptyModule.default || ptyModule;
} catch {
  console.warn('node-pty not found, TTY features will be disabled.');
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
      } catch (_) {}
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
  if (!pty) return { factory: null, label: '-', runtime: 'disabled' };
  if (createWebTTYLocalFactory) {
    const secretShell = resolveVarValue('WEBTTY_SHELL');
    const command = secretShell || process.env.WEBTTY_COMMAND || '';
    return {
      factory: buildLocalFactory(createWebTTYLocalFactory, { command }),
      label: command ? command : 'local shell',
      runtime: 'local'
    };
  }
  if (createWebTTYTTYFactory) {
    const containerName = process.env.WEBTTY_CONTAINER || 'ploinky_interactive';
    return {
      factory: createWebTTYTTYFactory({ ptyLib: pty, runtime: 'docker', containerName }),
      label: containerName,
      runtime: 'docker'
    };
  }
  return { factory: null, label: '-', runtime: 'disabled' };
})();

const webchatFactory = (() => {
  if (!pty) return { factory: null, label: '-', runtime: 'disabled' };
  if (createWebChatLocalFactory) {
    const secretCommand = resolveVarValue('WEBCHAT_COMMAND');
    const command = secretCommand || process.env.WEBCHAT_COMMAND || '';
    return {
      factory: buildLocalFactory(createWebChatLocalFactory, { command }),
      label: command ? command : 'local shell',
      runtime: 'local'
    };
  }
  if (createWebChatTTYFactory) {
    const containerName = process.env.WEBCHAT_CONTAINER || 'ploinky_chat';
    return {
      factory: createWebChatTTYFactory({ ptyLib: pty, runtime: 'docker', containerName }),
      label: containerName,
      runtime: 'docker'
    };
  }
  return { factory: null, label: '-', runtime: 'disabled' };
})();

const ROUTING_DIR = path.resolve('.ploinky');
const ROUTING_FILE = path.join(ROUTING_DIR, 'routing.json');
const LOG_DIR = path.join(ROUTING_DIR, 'logs');
const LOG_PATH = path.join(LOG_DIR, 'router.log');
const PID_FILE = process.env.PLOINKY_ROUTER_PID_FILE || null;

function ensurePidFile() {
    if (!PID_FILE) return;
    try {
        fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
        fs.writeFileSync(PID_FILE, String(process.pid));
    } catch (_) {}
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

// --- General Utils ---
function appendLog(type, data) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const rec = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n';
    fs.appendFileSync(LOG_PATH, rec);
  } catch (_) {}
}

// --- Config ---
function loadApiRoutes() {
  try {
    return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')).routes || {};
  } catch (_) {
    return {};
  }
}

const envAppName = (() => {
    const secretName = resolveVarValue('APP_NAME');
    const fromSecrets = secretName && String(secretName).trim();
    if (fromSecrets) return fromSecrets;
    const raw = process.env.APP_NAME;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed.length ? trimmed : null;
})();

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

// --- State ---
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

// --- API Proxy ---
function buildAgentPath(parsedUrl, includeSearch = true) {
    if (!parsedUrl || typeof parsedUrl !== 'object') return '/mcp';
    const pathname = parsedUrl.pathname && parsedUrl.pathname !== '/' ? parsedUrl.pathname : '';
    const search = includeSearch && parsedUrl.search ? parsedUrl.search : '';
    return `/mcp${pathname}${search}`;
}

function postJsonToAgent(targetPort, payload, res, agentPath) {
    try {
        const data = Buffer.from(JSON.stringify(payload || {}));
        const opts = {
            hostname: '127.0.0.1',
            port: targetPort,
            path: agentPath && agentPath.length ? agentPath : '/mcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
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

function proxyApi(req, res, targetPort) {
    const method = (req.method || 'GET').toUpperCase();
    const parsed = parse(req.url || '', true);
    const includeSearch = method !== 'GET';
    const agentPath = buildAgentPath(parsed, includeSearch);
    if (method === 'GET') {
        const params = parsed && parsed.query && typeof parsed.query === 'object'
            ? parsed.query
            : parseQueryString(parsed ? parsed.query : '');
        return postJsonToAgent(targetPort, params, res, agentPath);
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
                'Content-Length': data.length
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

function createAgentRouteEntries() {
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

async function handleRouterMcp(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    const parsed = parse(req.url || '', true);

    const sendJson = (statusCode, body) => {
        try {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        } catch (_) {}
        res.end(JSON.stringify(body));
    };

    const processPayload = async (rawPayload) => {
        const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
        const command = typeof payload.command === 'string' ? payload.command : '';
        const entries = createAgentRouteEntries();
        if (!entries.length) {
            return sendJson(503, { ok: false, error: 'no MCP agents are registered with the router' });
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
                for (const entry of entries) {
                    const tools = toolsByAgent.get(entry.agentName) || [];
                    for (const tool of tools) {
                        aggregated.push({ agent: entry.agentName, ...tool });
                    }
                }
                return sendJson(200, { ok: true, tools: aggregated, errors });
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
                return sendJson(200, { ok: true, resources: aggregated, errors });
            }

            if (command === 'tool') {
                const requestedAgent = payload.agent ? String(payload.agent) : null;
                const candidates = requestedAgent
                    ? entries.filter(entry => entry.agentName === requestedAgent)
                    : entries;

                if (requestedAgent && !candidates.length) {
                    return sendJson(404, { ok: false, error: `agent '${requestedAgent}' is not registered` });
                }

                await collectTools(candidates);

                const toolName = payload.tool || payload.toolName;
                if (!toolName) {
                    return sendJson(400, { ok: false, error: 'missing tool name (use tool=<name> or toolName=<name>)' });
                }
                const matches = toolIndex.get(String(toolName)) || [];

                const resolved = requestedAgent
                    ? matches.find(entry => entry.entry.agentName === requestedAgent)
                    : matches[0];

                if (!resolved) {
                    if (matches.length > 1) {
                        const agents = matches.map(m => m.entry.agentName);
                        return sendJson(409, { ok: false, error: `tool '${toolName}' is provided by multiple agents`, agents });
                    }
                    return sendJson(404, { ok: false, error: `tool '${toolName}' was not found` });
                }

                if (!requestedAgent && matches.length > 1) {
                    const agents = matches.map(m => m.entry.agentName);
                    return sendJson(409, { ok: false, error: `tool '${toolName}' is provided by multiple agents`, agents });
                }

                const args = { ...payload };
                delete args.command;
                delete args.tool;
                delete args.toolName;
                delete args.agent;

                const response = await resolved.entry.client.callTool(String(toolName), args);
                return sendJson(200, {
                    ok: true,
                    agent: resolved.entry.agentName,
                    tool: String(toolName),
                    result: response,
                    errors
                });
            }

            return sendJson(400, { ok: false, error: `unknown command '${command}'` });
        } catch (err) {
            return sendJson(500, { ok: false, error: String(err && err.message || err) });
        } finally {
            await Promise.all(entries.map(entry => entry.client.close().catch(() => {})));
        }
    };

    if (method === 'GET') {
        const payload = parsed && parsed.query && typeof parsed.query === 'object' ? parsed.query : {};
        processPayload(payload).catch(() => {});
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
        processPayload(payload).catch(() => {});
    });
    req.on('error', err => {
        sendJson(500, { ok: false, error: String(err && err.message || err) });
    });
}

// --- Main Server ---
const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url);
    const pathname = parsedUrl.pathname;
    appendLog('http_request', { method: req.method, path: pathname });

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
        // MCP-aware invocation via AgentClient abstraction
        const apiRoutes = loadApiRoutes();
        const parts = pathname.split('/');
        const agent = parts[2];
        if (!agent) { res.writeHead(404); return res.end('API Route not found'); }

        const route = apiRoutes[agent];
        if (!route || !route.hostPort) { res.writeHead(404); return res.end('API Route not found'); }

        const baseUrl = `http://127.0.0.1:${route.hostPort}/mcp`;
        // Cache per-request; could be memoized globally if needed
        const agentClient = createAgentClient(baseUrl);

        const method = (req.method || 'GET').toUpperCase();
        const parsed = parse(req.url || '', true);

        const finish = async (payload) => {
            try {
                // Commands mapping
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
                        // Prefer ok from resource body if JSON
                        let ok = true;
                        const text = rr.contents && rr.contents[0] && rr.contents[0].text;
                        if (text) { try { ok = !!(JSON.parse(text).ok); } catch (_) {} }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: ok }));
                    } catch (_) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ ok: true }));
                    }
                }

                // Default: if 'tool' specified, call it with provided args
                if (payload && payload.tool) {
                    const toolName = String(payload.tool);
                    const { tool, command, ...args } = payload; // strip command fields
                    const result = await agentClient.callTool(toolName, args);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: true, result }));
                }

                // Unknown command
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: 'unknown command' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
            } finally {
                await agentClient.close().catch(() => {});
            }
        };

        if (method === 'GET') {
            const q = parsed && parsed.query && typeof parsed.query === 'object' ? parsed.query : {};
            return void finish(q);
        }

        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            let payload = {};
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { payload = {}; }
            void finish(payload);
        });
        return;
    } else {
        // 1) Try agent-specific static routing: /<agent>/<path>
        if (staticSrv.serveAgentStaticRequest(req, res)) return;
        // 2) Fallback to static agent root
        if (staticSrv.serveStaticRequest(req, res)) return;
        res.writeHead(404); return res.end('Not Found');
    }
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
});
