import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie } from './common.js';
import * as staticSrv from '../static/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webtty';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;

function renderTemplate(filenames, replacements) {
    const target = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, filenames);
    if (!target) return null;
    let html = fs.readFileSync(target, 'utf8');
    for (const [key, value] of Object.entries(replacements || {})) {
        html = html.split(key).join(String(value ?? ''));
    }
    return html;
}

function getSession(req, appState) {
    const cookies = parseCookies(req);
    const sid = cookies.get(SID_COOKIE);
    return (sid && appState.sessions.has(sid)) ? sid : null;
}

function authorized(req, appState) {
    if (req.user) return true;
    return !!getSession(req, appState);
}

async function handleAuth(req, res, appConfig, appState) {
    if (req.user) {
        res.writeHead(400);
        res.end('SSO is enabled; legacy auth disabled.');
        return;
    }
    try {
        const token = loadToken(appName);
        const body = await readJsonBody(req);
        if (body && body.token && String(body.token).trim() === token) {
            const sid = crypto.randomBytes(16).toString('hex');
            appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': buildCookie(SID_COOKIE, sid, req, `/${appName}`)
            });
            res.end(JSON.stringify({ ok: true }));
        } else {
            res.writeHead(403);
            res.end('Forbidden');
        }
    } catch (_) {
        res.writeHead(400);
        res.end('Bad Request');
    }
}


function ensureAppSession(req, res, appState) {
    const cookies = parseCookies(req);
    let sid = cookies.get(SID_COOKIE);
    if (!sid) {
        sid = crypto.randomBytes(16).toString('hex');
        appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
        appendSetCookie(res, buildCookie(SID_COOKIE, sid, req, `/${appName}`));
    } else if (!appState.sessions.has(sid)) {
        appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
    }
    if (!cookies.has(SID_COOKIE)) {
        const existing = req.headers.cookie || '';
        req.headers.cookie = existing ? `${existing}; ${SID_COOKIE}=${sid}` : `${SID_COOKIE}=${sid}`;
    }
    return sid;
}

function handleWebTTY(req, res, appConfig, appState) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    if (pathname === '/auth' && req.method === 'POST') return handleAuth(req, res, appConfig, appState);
    if (pathname === '/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: authorized(req, appState) }));
    }

    if (req.user) {
        ensureAppSession(req, res, appState);
    }

    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    if (!authorized(req, appState)) {
        if (req.user) {
            res.writeHead(403);
            return res.end('Access forbidden');
        }
        const html = renderTemplate(['login.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Router',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
        res.writeHead(403); return res.end('Forbidden');
    }

    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['webtty.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'Router',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
    }

    if (pathname === '/stream') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        if (!session || !tabId) { res.writeHead(400); return res.end(); }

        // CRITICAL FIX: Global limit across ALL sessions to prevent system-wide overload  
        const MAX_GLOBAL_TTYS = 20;
        let globalTabCount = 0;
        for (const sess of appState.sessions.values()) {
            if (sess.tabs instanceof Map) {
                globalTabCount += sess.tabs.size;
            }
        }

        if (globalTabCount >= MAX_GLOBAL_TTYS) {
            res.writeHead(503, {
                'Content-Type': 'text/plain',
                'Retry-After': '30'
            });
            res.end('Server at capacity. Please try again later.');
            return;
        }

        // CRITICAL FIX: Limit concurrent connections per session to prevent process spawn leak
        const MAX_CONCURRENT_TTYS = 3;
        if (session.tabs.size >= MAX_CONCURRENT_TTYS) {
            res.writeHead(429, {
                'Content-Type': 'text/plain',
                'Retry-After': '5'
            });
            res.end('Too many concurrent connections. Please close other tabs or wait.');
            return;
        }

        let tab = session.tabs.get(tabId);

        // CRITICAL FIX: Debounce rapid reconnections
        const now = Date.now();
        const MIN_RECONNECT_INTERVAL_MS = 1000;

        if (tab && tab.lastConnectTime && (now - tab.lastConnectTime) < MIN_RECONNECT_INTERVAL_MS) {
            res.writeHead(429, {
                'Content-Type': 'text/plain',
                'Retry-After': '1'
            });
            res.end('Reconnecting too fast. Please wait.');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'alt-svc': 'clear'  // Force HTTP/2, disable HTTP/3 to prevent QUIC errors
        });
        res.write(': connected\n\n');

        if (!tab) {
            if (!appConfig.ttyFactory) {
                res.writeHead(503);
                res.end('TTY support unavailable. Install node-pty to enable console sessions.');
                return;
            }
            try {
                const tty = appConfig.ttyFactory.create();
                tab = {
                    tty,
                    sseRes: res,
                    lastConnectTime: now,
                    createdAt: now,
                    pid: tty.pid || null,
                    cleanupTimer: null
                };
                session.tabs.set(tabId, tab);
                tty.onOutput((data) => {
                    if (tab.sseRes) {
                        tab.sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
                    }
                });
                tty.onClose(() => {
                    if (tab.sseRes) {
                        tab.sseRes.write('event: close\n');
                        tab.sseRes.write('data: {}\n\n');
                    }
                    if (tab.cleanupTimer) {
                        clearTimeout(tab.cleanupTimer);
                        tab.cleanupTimer = null;
                    }
                });

            } catch (e) {
                res.writeHead(500);
                res.end('Failed to create TTY: ' + (e?.message || e));
                return;
            }
        } else {
            tab.sseRes = res;
            tab.lastConnectTime = now;
        }

        req.on('close', () => {
            if (tab.cleanupTimer) {
                clearTimeout(tab.cleanupTimer);
                tab.cleanupTimer = null;
            }

            if (tab.tty) {
                const pid = tab.pid || tab.tty.pid;

                if (typeof tab.tty.dispose === 'function') {
                    try { tab.tty.dispose(); } catch (_) { }
                } else if (typeof tab.tty.kill === 'function') {
                    try { tab.tty.kill(); } catch (_) { }
                }

                // CRITICAL FIX: Force kill lingering processes
                if (pid) {
                    setTimeout(() => {
                        try {
                            global.processKill(pid, 0);
                            global.processKill(pid, 'SIGKILL');
                            console.warn(`[webtty] Force killed lingering process ${pid}`);
                        } catch (_) { }
                    }, 2000);
                }
            }

            tab.sseRes = null;

            if (session.tabs && session.tabs instanceof Map) {
                session.tabs.delete(tabId);
            }
        });
        return;
    }

    if (pathname === '/input' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        const tab = session && session.tabs.get(tabId);
        if (!tab) { res.writeHead(400); return res.end(); }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try { tab.tty.write(body); } catch (_) { }
            res.writeHead(204); res.end();
        });
        return;
    }

    if (pathname === '/resize' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.searchParams.get('tabId');
        const tab = session && session.tabs.get(tabId);
        if (!tab) { res.writeHead(400); return res.end(); }
        readJsonBody(req)
            .then(({ cols, rows }) => {
                try { tab.tty.resize?.(cols, rows); } catch (_) { }
                res.writeHead(204); res.end();
            })
            .catch(() => { res.writeHead(400); res.end(); });
        return;
    }

    res.writeHead(404); res.end('Not Found in App');
}

export { handleWebTTY };
