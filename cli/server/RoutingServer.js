import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Handler imports
import { handleWebTTY } from './handlers/webtty.js';
import { handleWebChat } from './handlers/webchat.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleWebMeet } from './handlers/webmeet.js';
import { handleStatus } from './handlers/status.js';
import { handleBlobs } from './handlers/blobs.js';
import * as staticSrv from './static/index.js';

// Authentication and routing
import { ensureAuthenticated, handleAuthRoutes } from './authHandlers.js';
import { loadApiRoutes, handleRouterMcp } from './routerHandlers.js';

// Logging
import { appendLog, logBootEvent, logMemoryUsage } from './utils/logger.js';

// New modular components
import { agentSessionStore, handleAgentMcpRequest } from './mcp-proxy/index.js';
import { initializeTTYFactories, createServiceConfig } from './utils/ttyFactories.js';
import { setupProcessLifecycle } from './utils/processLifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_BROWSER_CLIENT_PATH = path.resolve(__dirname, '../../Agent/client/MCPBrowserClient.js');

// Initialize TTY factories
const { getWebttyFactory, getWebchatFactory } = await initializeTTYFactories();

// Create service configuration
const config = createServiceConfig(getWebttyFactory, getWebchatFactory);

// Global state for all services
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

/**
 * Serve MCP Browser Client
 */
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

/**
 * Main request processor
 */
async function processRequest(req, res) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname || '/';
    appendLog('http_request', { method: req.method, path: pathname });

    // Health check endpoint (no auth required)
    if (pathname === '/health') {
        const memUsage = process.memoryUsage();
        const healthData = {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            pid: process.pid,
            memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                rssMB: Math.round(memUsage.rss / 1024 / 1024),
                heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024)
            },
            activeSessions: {
                webtty: globalState.webtty.sessions.size,
                webchat: globalState.webchat.sessions.size,
                dashboard: globalState.dashboard.sessions.size,
                webmeet: globalState.webmeet.sessions.size,
                status: globalState.status.sessions.size,
                agent: agentSessionStore.size
            }
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
    }

    // MCP Browser Client
    if (pathname === '/MCPBrowserClient.js') {
        serveMcpBrowserClient(req, res);
        return;
    }

    // Authentication routes
    if (pathname.startsWith('/auth/')) {
        const handled = await handleAuthRoutes(req, res, parsedUrl);
        if (handled) return;
    }

    // Ensure authenticated for protected routes
    const authResult = await ensureAuthenticated(req, res, parsedUrl);
    if (!authResult.ok) return;

    // Route to appropriate handler
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
        // Agent MCP routing
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
        // Static file serving
        if (staticSrv.serveAgentStaticRequest(req, res)) return;
        if (staticSrv.serveStaticRequest(req, res)) return;

        res.writeHead(404);
        return res.end('Not Found');
    }
}

/**
 * Create and configure HTTP server
 */
const server = http.createServer((req, res) => {
    processRequest(req, res).catch(err => {
        appendLog('request_error', { error: err?.message || String(err) });
        if (!res.headersSent) {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
            } catch (_) {
                try { res.end(); } catch (_) { }
            }
        } else {
            try { res.end(); } catch (_) { }
        }
    });
});

// Setup process lifecycle management
const lifecycle = setupProcessLifecycle(server, globalState, agentSessionStore);

// Server error handlers
server.on('error', (error) => {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
    console.error('[FATAL] Server error:', error);
    appendLog('server_error', { error: error.message, code: error.code, port });

    if (error.code === 'EADDRINUSE') {
        console.error(`[FATAL] Port ${port} is already in use`);
        process.exit(2);
    } else if (error.code === 'EACCES') {
        console.error(`[FATAL] Permission denied for port ${port}`);
        process.exit(2);
    } else {
        lifecycle.gracefulShutdown('server_error', 1);
    }
});

server.on('clientError', (error, socket) => {
    appendLog('client_error', {
        error: error.message,
        code: error.code,
        remoteAddress: socket.remoteAddress
    });

    if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
});

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
server.listen(port, () => {
    console.log(`[RoutingServer] Ploinky server running on http://127.0.0.1:${port}`);
    console.log('  Dashboard: /dashboard');
    console.log('  WebTTY:    /webtty');
    console.log('  WebChat:   /webchat');
    console.log('  WebMeet:   /webmeet');
    console.log('  Status:    /status');
    console.log('  Health:    /health');
    appendLog('server_start', { port });
    logBootEvent('server_listening', { port });

    // Log initial memory usage
    logMemoryUsage();

    // Periodic memory usage logging (every 5 minutes)
    const MEMORY_LOG_INTERVAL = 5 * 60 * 1000;
    const memoryMonitor = setInterval(() => {
        if (!lifecycle.isShuttingDown()) {
            logMemoryUsage();
        }
    }, MEMORY_LOG_INTERVAL);

    // Clean up interval on shutdown
    process.on('beforeExit', () => {
        clearInterval(memoryMonitor);
    });
});
