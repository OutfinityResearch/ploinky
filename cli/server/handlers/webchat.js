const fs = require('fs');
const path = require('path');
const url = require('url');

const { loadToken, parseCookies, buildCookie, readJsonBody } = require('./common');
const staticSrv = require('../static');

const appName = 'webchat';
const fallbackAppPath = path.join(__dirname, '../', appName);

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
    const sid = cookies.get(`${appName}_sid`);
    return (sid && appState.sessions.has(sid)) ? sid : null;
}

function authorized(req, appState) {
    return !!getSession(req, appState);
}

async function handleAuth(req, res, appConfig, appState) {
    try {
        const token = loadToken(appName);
        const body = await readJsonBody(req);
        if (body && body.token && String(body.token).trim() === token) {
            const sid = require('crypto').randomBytes(16).toString('hex');
            appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
            // Save both session and token in cookies for persistence
            const cookies = [
                buildCookie(`${appName}_sid`, sid, req, `/${appName}`),
                buildCookie(`${appName}_token`, token, req, `/${appName}`, { maxAge: 7 * 24 * 60 * 60 }) // 7 days
            ];
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': cookies
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

function handleWebChat(req, res, appConfig, appState) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    if (pathname === '/auth' && req.method === 'POST') return handleAuth(req, res, appConfig, appState);
    if (pathname === '/whoami') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({ok: authorized(req, appState)}));
    }

    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }
    
    // Check if user has valid token in cookie
    const cookies = parseCookies(req);
    const savedToken = cookies.get(`${appName}_token`);
    const currentToken = loadToken(appName);

    // If saved token matches current token and no session, create a new session
    if (savedToken && savedToken === currentToken && !authorized(req, appState)) {
        const sid = require('crypto').randomBytes(16).toString('hex');
        appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
        // Set session cookie and continue
        res.setHeader('Set-Cookie', buildCookie(`${appName}_sid`, sid, req, `/${appName}`));
        // Mark as authorized for this request
        req.headers.cookie = `${req.headers.cookie || ''}; ${appName}_sid=${sid}`;
    }

    if (!authorized(req, appState)) {
        const html = renderTemplate(['login.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'ChatAgent',
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
        const html = renderTemplate(['chat.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || 'ChatAgent',
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
                res.end('TTY support unavailable. Install node-pty to enable chat sessions.');
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
                res.end('Failed to create chat session: ' + (e?.message || e));
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

    res.writeHead(404); res.end('Not Found in App');
}

module.exports = { handleWebChat };
