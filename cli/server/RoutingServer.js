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
import { ensureAuthenticated, ensureAgentAuthenticated, handleAuthRoutes } from './authHandlers.js';
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

if (!global.processKill) {
    global.processKill = function (pid, signal) {
        if (pid === 0 || pid === process.pid || pid === (-process.pid)) {
            console.error("Cannot kill process 0 or self");
            return;
        }
        console.log(`Killing process ${pid} with signal ${signal}`);
        process.kill(pid, signal);
    }
}
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

function proxyAgentTaskStatus(req, res, route, parsedUrl, agentName) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
    }
    const pathWithQuery = `/getTaskStatus${parsedUrl.search || ''}`;
    const upstream = http.request({
        hostname: '127.0.0.1',
        port: route.hostPort,
        path: pathWithQuery,
        method: 'GET',
        headers: { accept: 'application/json' }
    }, upstreamRes => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
    });
    upstream.on('error', err => {
        appendLog('agent_task_proxy_error', { agent: agentName, error: err?.message || String(err) });
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'upstream error', detail: String(err) }));
    });
    upstream.end();
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

    // For /mcps/ routes, check agent auth first, then fall back to user auth
    if (pathname.startsWith('/mcps/') || pathname.startsWith('/mcp/') || pathname === '/mcp') {
        const hasAuthHeader = req.headers?.authorization && typeof req.headers.authorization === 'string';
        if (hasAuthHeader && req.headers.authorization.startsWith('Bearer ')) {
            // Try agent authentication first
            const agentAuthResult = await ensureAgentAuthenticated(req, res, parsedUrl);
            if (agentAuthResult.ok) {
                // Agent authenticated, continue with routing
            } else {
                // Agent auth failed, fall back to user auth
                const authResult = await ensureAuthenticated(req, res, parsedUrl);
                if (!authResult.ok) return;
            }
        } else {
            // No bearer token, use user auth
            const authResult = await ensureAuthenticated(req, res, parsedUrl);
            if (!authResult.ok) return;
        }
    } else {
        // Ensure authenticated for other protected routes
        const authResult = await ensureAuthenticated(req, res, parsedUrl);
        if (!authResult.ok) return;
    }

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
        if (subPath === 'task') {
            proxyAgentTaskStatus(req, res, route, parsedUrl, agent);
            return;
        }
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

    // CRITICAL: Process count monitoring to prevent spawn leaks
    const PROCESS_MONITOR_INTERVAL = 60 * 1000; // 1 minute
    const MAX_SAFE_NODE_PROCESSES = 15;
    const processMonitor = setInterval(() => {
        if (lifecycle.isShuttingDown()) return;

        try {
            const { execSync } = require('child_process');
            const output = execSync('ps aux | grep -E "node|startFlow" | grep -v grep | wc -l', {
                encoding: 'utf8',
                timeout: 5000
            }).trim();
            const nodeProcessCount = parseInt(output, 10);

            if (nodeProcessCount > MAX_SAFE_NODE_PROCESSES) {
                const warning = {
                    level: 'warning',
                    type: 'process_count_alert',
                    nodeProcesses: nodeProcessCount,
                    maxSafe: MAX_SAFE_NODE_PROCESSES,
                    message: 'High number of node processes detected - possible process spawn leak'
                };
                appendLog('process_count_alert', warning);
                console.warn(`[ALERT] ${nodeProcessCount} node processes running (max safe: ${MAX_SAFE_NODE_PROCESSES})`);

                // Log active sessions for debugging
                let totalTabs = 0;
                for (const state of Object.values(globalState)) {
                    if (state.sessions instanceof Map) {
                        for (const session of state.sessions.values()) {
                            if (session.tabs instanceof Map) {
                                totalTabs += session.tabs.size;
                            }
                        }
                    }
                }
                console.warn(`[DEBUG] Active tabs: ${totalTabs}, Sessions: ${globalState.webchat?.sessions.size || 0}`);
            }

            // Log normal process count periodically for trending
            if (nodeProcessCount > 5) {
                appendLog('process_count', { count: nodeProcessCount });
            }
        } catch (err) {
            // Silently fail - don't crash if ps command fails
        }
    }, PROCESS_MONITOR_INTERVAL);

    // Clean up intervals on shutdown
    process.on('beforeExit', () => {
        clearInterval(memoryMonitor);
        clearInterval(processMonitor);
    });
});
