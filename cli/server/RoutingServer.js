const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
// Handlers for each application
const { handleWebTTY } = require('./handlers/webtty.js');
const { handleWebChat } = require('./handlers/webchat.js');
const { handleDashboard } = require('./handlers/dashboard.js');
const { handleWebMeet } = require('./handlers/webmeet.js');
const { handleStatus } = require('./handlers/status.js');
const staticSrv = require('./static');

// TTY dependencies
const pty = (() => { try { return require('node-pty'); } catch { console.warn('node-pty not found, TTY features will be disabled.'); return null; } })();
function loadTTYFactory(modulePath, legacyPath) {
  try {
    return require(modulePath);
  } catch (err) {
    if (legacyPath) {
      try { return require(legacyPath); } catch (_) {}
    }
    throw err;
  }
}

const webttyTTYModule = pty
  ? (() => {
      try { return loadTTYFactory('./webtty/tty.js', './webtty/webtty-ttyFactory.js'); }
      catch (_) { console.warn('WebTTY TTY factory unavailable.'); return {}; }
    })()
  : {};

const webchatTTYModule = pty
  ? (() => {
      try { return loadTTYFactory('./webchat/tty.js', './webchat/webchat-ttyFactory.js'); }
      catch (_) { console.warn('WebChat TTY factory unavailable.'); return {}; }
    })()
  : {};

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

const { resolveVarValue } = require('../services/secretVars');

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
    if (!parsedUrl || typeof parsedUrl !== 'object') return '/api';
    const pathname = parsedUrl.pathname && parsedUrl.pathname !== '/' ? parsedUrl.pathname : '';
    const search = includeSearch && parsedUrl.search ? parsedUrl.search : '';
    return `/api${pathname}${search}`;
}

function postJsonToAgent(targetPort, payload, res, agentPath) {
    try {
        const data = Buffer.from(JSON.stringify(payload || {}));
        const opts = {
            hostname: '127.0.0.1',
            port: targetPort,
            path: agentPath && agentPath.length ? agentPath : '/api',
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
    const parsed = url.parse(req.url || '', true);
    const includeSearch = method !== 'GET';
    const agentPath = buildAgentPath(parsed, includeSearch);
    if (method === 'GET') {
        const params = parsed && parsed.query && typeof parsed.query === 'object'
            ? parsed.query
            : querystring.parse(parsed ? parsed.query : '');
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

// --- Main Server ---
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
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
    } else if (pathname.startsWith('/apis/') || pathname.startsWith('/api/')) {
        const apiRoutes = loadApiRoutes();
        const parts = pathname.split('/');
        const agent = parts[2];
        if (!agent) {
            res.writeHead(404); return res.end('API Route not found');
        }
        const route = apiRoutes[agent];
        if (route && route.hostPort) {
            const prefix = pathname.startsWith('/apis/') ? '/apis' : '/api';
            const base = `${prefix}/${agent}`;
            let suffix = req.url.slice(base.length) || '';
            if (!suffix) {
                req.url = '/';
            } else {
                if (!suffix.startsWith('/')) suffix = `/${suffix}`;
                req.url = suffix;
            }
            return proxyApi(req, res, route.hostPort);
        }
        res.writeHead(404); return res.end('API Route not found');
    } else {
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
