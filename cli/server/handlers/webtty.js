import fs from 'fs';
import path from 'path';
import { parse } from 'url';
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
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    if (pathname === '/auth' && req.method === 'POST') return handleAuth(req, res, appConfig, appState);
    if (pathname === '/whoami') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({ok: authorized(req, appState)}));
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
            res.writeHead(200, {'Content-Type': 'text/html'});
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
            res.writeHead(200, {'Content-Type': 'text/html'});
            return res.end(html);
        }
    }
    
    if (pathname === '/stream') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.query.tabId;
        if (!session || !tabId) { res.writeHead(400); return res.end(); }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache' });
        res.write(': connected\n\n');

        let tab = session.tabs.get(tabId);
        if (!tab) {
            if (!appConfig.ttyFactory) {
                res.writeHead(503);
                res.end('TTY support unavailable. Install node-pty to enable console sessions.');
                return;
            }
            try {
                const tty = appConfig.ttyFactory.create();
                tab = { tty, sseRes: res };
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
                });
            } catch (e) {
                res.writeHead(500);
                res.end('Failed to create TTY: ' + (e?.message || e));
                return;
            }
        } else {
            tab.sseRes = res;
        }

        req.on('close', () => { tab.sseRes = null; });
        return;
    }

    if (pathname === '/input' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.query.tabId;
        const tab = session && session.tabs.get(tabId);
        if (!tab) { res.writeHead(400); return res.end(); }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => { 
            try { tab.tty.write(body); } catch(_) {}
            res.writeHead(204); res.end(); 
        });
        return;
    }

    if (pathname === '/resize' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.query.tabId;
        const tab = session && session.tabs.get(tabId);
        if (!tab) { res.writeHead(400); return res.end(); }
        readJsonBody(req)
            .then(({ cols, rows }) => {
                try { tab.tty.resize?.(cols, rows); } catch (_) {}
                res.writeHead(204); res.end();
            })
            .catch(() => { res.writeHead(400); res.end(); });
        return;
    }

    res.writeHead(404); res.end('Not Found in App');
}

export { handleWebTTY };
