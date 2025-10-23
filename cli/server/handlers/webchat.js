import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie } from './common.js';
import * as staticSrv from '../static/index.js';
import { createServerTtsStrategy } from './ttsStrategies/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webchat';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;

const DEFAULT_TTS_PROVIDER = (process.env.WEBCHAT_TTS_PROVIDER || 'openai').trim().toLowerCase();
const DEFAULT_STT_PROVIDER = (process.env.WEBCHAT_STT_PROVIDER || 'browser').trim().toLowerCase();

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
            const cookies = [
                buildCookie(SID_COOKIE, sid, req, `/${appName}`),
                buildCookie(`${appName}_token`, token, req, `/${appName}`, { maxAge: 7 * 24 * 60 * 60 })
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

async function handleTextToSpeech(req, res) {
    let body;
    try {
        body = await readJsonBody(req);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Invalid request body.' }));
        return;
    }

    const textInput = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!textInput) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Missing text for speech synthesis.' }));
        return;
    }

    const strategy = createServerTtsStrategy({ provider: DEFAULT_TTS_PROVIDER });
    if (!strategy || strategy.isAvailable === false) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Text-to-speech unavailable: provider not configured.' }));
        return;
    }

    const trimmedText = typeof strategy.trimText === 'function'
        ? strategy.trimText(textInput)
        : textInput;

    if (!trimmedText) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Unable to generate speech for empty text.' }));
        return;
    }

    const voice = typeof strategy.normalizeVoice === 'function'
        ? strategy.normalizeVoice(body?.voice)
        : body?.voice;
    const speed = typeof strategy.clampSpeed === 'function'
        ? strategy.clampSpeed(body?.speed)
        : Number(body?.speed) || 1;

    try {
        const result = await strategy.synthesize({
            text: trimmedText,
            voice,
            speed
        });
        if (!result || !result.audio) {
            throw new Error('tts_missing_audio');
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ audio: result.audio, contentType: result.contentType || 'audio/mpeg' }));
    } catch (error) {
        const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: error?.message || 'Text-to-speech request failed.', details: error?.details || error?.cause?.message || undefined }));
    }
}

function handleWebChat(req, res, appConfig, appState) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    if (pathname === '/auth' && req.method === 'POST') return handleAuth(req, res, appConfig, appState);
    if (pathname === '/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: authorized(req, appState) }));
    }

    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    const cookies = parseCookies(req);

    if (req.user) {
        ensureAppSession(req, res, appState);
    } else {
        const savedToken = cookies.get(`${appName}_token`);
        const currentToken = loadToken(appName);

        if (savedToken && savedToken === currentToken && !authorized(req, appState)) {
            const sid = crypto.randomBytes(16).toString('hex');
            appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
            appendSetCookie(res, buildCookie(SID_COOKIE, sid, req, `/${appName}`));
            req.headers.cookie = `${req.headers.cookie || ''}; ${appName}_sid=${sid}`;
        }
    }

    if (!authorized(req, appState)) {
        if (req.user) {
            res.writeHead(403);
            return res.end('Access forbidden');
        }
        const html = renderTemplate(['login.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.displayName || appConfig.agentName || '',
            '__DISPLAY_NAME__': appConfig.displayName || appConfig.agentName || 'WebChat',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`,
            '__TTS_PROVIDER__': DEFAULT_TTS_PROVIDER,
            '__STT_PROVIDER__': DEFAULT_STT_PROVIDER
        });
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(html);
        }
        res.writeHead(403); return res.end('Forbidden');
    }

    if (pathname === '/tts' && req.method === 'POST') {
        return handleTextToSpeech(req, res);
    }

    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['chat.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': appConfig.agentName || '',
            '__DISPLAY_NAME__': appConfig.displayName || appConfig.agentName || 'WebChat',
            '__CONTAINER_NAME__': appConfig.containerName || '-',
            '__RUNTIME__': appConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`,
            '__TTS_PROVIDER__': DEFAULT_TTS_PROVIDER,
            '__STT_PROVIDER__': DEFAULT_STT_PROVIDER
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
                // Extract SSO user context if available
                const ssoUser = req.user ? {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    roles: req.user.roles || []
                } : null;

                // Debug: Log SSO user info
                if (process.env.WEBTTY_DEBUG === '1' && ssoUser) {
                    console.log('[webchat] SSO User:', JSON.stringify({
                        username: ssoUser.username,
                        roles: ssoUser.roles,
                        rolesLength: ssoUser.roles?.length
                    }));
                }

                const tty = appConfig.ttyFactory.create(ssoUser);
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

        req.on('close', () => {
            if (tab.tty) {
                if (typeof tab.tty.dispose === 'function') {
                    try { tab.tty.dispose(); } catch (_) { }
                } else if (typeof tab.tty.kill === 'function') {
                    try { tab.tty.kill(); } catch (_) { }
                }
            }
            if (tab.sseRes) {
                try { tab.sseRes.end(); } catch (_) { }
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

    res.writeHead(404); res.end(', Not Found in App');
}

export { handleWebChat };
