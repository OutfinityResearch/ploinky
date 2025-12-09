import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { resolveWebchatCommandsForAgent } from '../webchat/commandResolver.js';
import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie, parseMultipartFormData } from './common.js';
import * as staticSrv from '../static/index.js';
import { createServerTtsStrategy } from './ttsStrategies/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webchat';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;

const DEFAULT_TTS_PROVIDER = (process.env.WEBCHAT_TTS_PROVIDER || 'browser').trim().toLowerCase();
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

async function handleSpeechToText(req, res) {
    let formData;
    try {
        formData = await parseMultipartFormData(req);
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Invalid multipart form data.' }));
        return;
    }

    const audioFile = formData.files?.audio;
    if (!audioFile || !audioFile.data) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Missing audio file.' }));
        return;
    }

    const language = formData.fields?.language || 'en';
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!apiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Speech-to-text unavailable: OpenAI API key not configured.' }));
        return;
    }

    try {
        // Create form data for OpenAI API
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const formParts = [];

        // Add audio file
        formParts.push(`--${boundary}\r\n`);
        formParts.push(`Content-Disposition: form-data; name="file"; filename="${audioFile.filename || 'audio.webm'}"\r\n`);
        formParts.push(`Content-Type: ${audioFile.contentType || 'audio/webm'}\r\n\r\n`);
        formParts.push(audioFile.data);
        formParts.push('\r\n');

        // Add model
        formParts.push(`--${boundary}\r\n`);
        formParts.push(`Content-Disposition: form-data; name="model"\r\n\r\n`);
        formParts.push(process.env.WEBCHAT_STT_MODEL || 'whisper-1');
        formParts.push('\r\n');

        // Add language if specified
        if (language && language !== 'auto') {
            formParts.push(`--${boundary}\r\n`);
            formParts.push(`Content-Disposition: form-data; name="language"\r\n\r\n`);
            formParts.push(language);
            formParts.push('\r\n');
        }

        // End boundary
        formParts.push(`--${boundary}--\r\n`);

        // Concatenate all parts
        const bodyParts = [];
        for (const part of formParts) {
            if (typeof part === 'string') {
                bodyParts.push(Buffer.from(part));
            } else {
                bodyParts.push(part);
            }
        }
        const body = Buffer.concat(bodyParts);

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
        }

        const result = await response.json();

        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ text: result.text || '' }));
    } catch (error) {
        const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            error: error?.message || 'Speech-to-text request failed.',
            details: error?.details || error?.cause?.message || undefined
        }));
    }
}

async function handleRealtimeToken(req, res) {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!apiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'OpenAI API key not configured.' }));
        return;
    }

    try {
        const model = process.env.WEBCHAT_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

        // Simply return the API key as the token for now
        // The browser will connect directly using the API key
        // In production, you'd want to use ephemeral tokens when available
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, private'
        });
        res.end(JSON.stringify({
            client_secret: {
                value: apiKey,
                expires_at: Date.now() + 3600000 // 1 hour
            }
        }));

    } catch (error) {
        const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            error: error?.message || 'Failed to create realtime session.',
            details: error?.details || error?.cause?.message || undefined
        }));
    }
}

function handleWebChat(req, res, appConfig, appState) {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';
    const agentOverrideRaw = parsedUrl.searchParams.get('agent') || '';
    const agentOverride = agentOverrideRaw.trim();
    let effectiveConfig = appConfig;
    let agentQuery = '';

    if (agentOverride) {
        const overrideCommands = resolveWebchatCommandsForAgent(agentOverride);
        if (!overrideCommands) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Agent not found or not enabled.');
            return;
        }
        if (typeof appConfig.getFactoryForCommands !== 'function') {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Dynamic agent selection unavailable.');
            return;
        }
        const overrideConfig = appConfig.getFactoryForCommands(overrideCommands);
        if (!overrideConfig || !overrideConfig.ttyFactory) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Unable to start agent session.');
            return;
        }
        effectiveConfig = overrideConfig;
        agentQuery = `agent=${encodeURIComponent(overrideCommands.agentName || agentOverride)}`;
    }

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
            '__AGENT_NAME__': effectiveConfig.displayName || effectiveConfig.agentName || '',
            '__DISPLAY_NAME__': effectiveConfig.displayName || effectiveConfig.agentName || 'WebChat',
            '__RUNTIME__': effectiveConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`,
            '__TTS_PROVIDER__': DEFAULT_TTS_PROVIDER,
            '__STT_PROVIDER__': DEFAULT_STT_PROVIDER,
            '__AGENT_QUERY__': agentQuery
        });
        if (html) {
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            return res.end(html);
        }
        res.writeHead(403); return res.end('Forbidden');
    }

    if (pathname === '/tts' && req.method === 'POST') {
        return handleTextToSpeech(req, res);
    }

    if (pathname === '/stt' && req.method === 'POST') {
        return handleSpeechToText(req, res);
    }

    if (pathname === '/realtime-token' && req.method === 'POST') {
        return handleRealtimeToken(req, res);
    }

    if (pathname === '/' || pathname === '/index.html') {
        const html = renderTemplate(['chat.html', 'index.html'], {
            '__ASSET_BASE__': `/${appName}/assets`,
            '__AGENT_NAME__': effectiveConfig.agentName || '',
            '__DISPLAY_NAME__': effectiveConfig.displayName || effectiveConfig.agentName || 'WebChat',
            '__RUNTIME__': effectiveConfig.runtime || 'local',
            '__REQUIRES_AUTH__': 'true',
            '__BASE_PATH__': `/${appName}`,
            '__TTS_PROVIDER__': DEFAULT_TTS_PROVIDER,
            '__STT_PROVIDER__': DEFAULT_STT_PROVIDER,
            '__AGENT_QUERY__': agentQuery
        });
        if (html) {
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
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

        // CRITICAL FIX: Debounce rapid reconnections to prevent connection storms
        const now = Date.now();
        const MIN_RECONNECT_INTERVAL_MS = 1000; // 1 second

        if (tab && tab.lastConnectTime && (now - tab.lastConnectTime) < MIN_RECONNECT_INTERVAL_MS) {
            res.writeHead(429, {
                'Content-Type': 'text/plain',
                'Retry-After': '1'
            });
            res.end('Reconnecting too fast. Please wait.');
            return;
        }

        if (!tab && !effectiveConfig.ttyFactory) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('TTY support unavailable. Install node-pty to enable chat sessions.');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'x-accel-buffering': 'no',
            'alt-svc': 'clear'  // Force HTTP/2, disable HTTP/3 to prevent QUIC errors
        });
        res.write(': connected\n\n');

        const KEEPALIVE_INTERVAL_MS = 15000;
        let keepaliveTimer = null;

        const startKeepalive = () => {
            if (keepaliveTimer || !Number.isFinite(KEEPALIVE_INTERVAL_MS) || KEEPALIVE_INTERVAL_MS <= 0) {
                return;
            }
            keepaliveTimer = setInterval(() => {
                try {
                    res.write(': keepalive\n\n');
                } catch (_) {
                    clearInterval(keepaliveTimer);
                    keepaliveTimer = null;
                }
            }, KEEPALIVE_INTERVAL_MS);
            keepaliveTimer.unref?.();
        };

        startKeepalive();

        if (!tab) {
            try {
                // Extract SSO user context if available
                const ssoUser = req.user ? {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    roles: req.user.roles || [],
                    sessionId: req.sessionId || null
                } : null;

                // Debug: Log SSO user info
                if (process.env.WEBTTY_DEBUG === '1' && ssoUser) {
                    console.log('[webchat] SSO User:', JSON.stringify({
                        username: ssoUser.username,
                        roles: ssoUser.roles,
                        rolesLength: ssoUser.roles?.length
                    }));
                }

                const tty = effectiveConfig.ttyFactory.create(ssoUser);
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
                    // Clear force kill timer since process closed normally
                    if (tab.cleanupTimer) {
                        clearTimeout(tab.cleanupTimer);
                        tab.cleanupTimer = null;
                    }
                });

            } catch (e) {
                res.writeHead(500);
                res.end('Failed to create chat session: ' + (e?.message || e));
                return;
            }
        } else {
            // Reusing existing tab
            tab.sseRes = res;
            tab.lastConnectTime = now;
        }

        req.on('close', () => {
            const pid = tab.pid || tab.tty?.pid;
            console.log(`[webchat] Connection closed for tab ${tabId}, tty pid=${pid}`);

            if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
            }
            // Clear the force kill timer
            if (tab.cleanupTimer) {
                clearTimeout(tab.cleanupTimer);
                tab.cleanupTimer = null;
            }

            // Clean up TTY process
            if (tab.tty) {
                console.log(`[webchat] Disposing TTY for tab ${tabId}`);

                if (typeof tab.tty.dispose === 'function') {
                    try { tab.tty.dispose(); console.log(`[webchat] dispose() called for pid ${pid}`); } catch (e) { console.error(`[webchat] dispose error: ${e?.message}`); }
                } else if (typeof tab.tty.kill === 'function') {
                    try { tab.tty.kill(); console.log(`[webchat] kill() called for pid ${pid}`); } catch (e) { console.error(`[webchat] kill error: ${e?.message}`); }
                }

                // CRITICAL FIX: Ensure process is actually killed
                if (pid) {
                    setTimeout(() => {
                        try {
                            // Check if process still exists and force kill
                            global.processKill(pid, 0); // Test if process exists
                            global.processKill(pid, 'SIGKILL'); // Force kill
                            console.warn(`[webchat] Force killed lingering process ${pid}`);
                        } catch (_) {
                            // Process already dead, good
                            console.log(`[webchat] Process ${pid} already dead`);
                        }
                    }, 2000); // Wait 2 seconds then force kill if still alive
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
