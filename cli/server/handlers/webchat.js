import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { resolveWebchatCommandsForAgent } from '../webchat/commandResolver.js';
import { parseCookies, buildCookie, appendSetCookie, parseMultipartFormData } from './common.js';
import * as staticSrv from '../static/index.js';
import { createServerTtsStrategy } from './ttsStrategies/index.js';
import {
    appendMessage as appendTranscriptMessage,
    appendToMessage as appendTranscriptToMessage,
    closeConversation as closeTranscriptConversation,
    createConversation as createTranscriptConversation,
    setTurnRating as setTranscriptTurnRating,
} from '../utils/transcriptStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webchat';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;

const DEFAULT_TTS_PROVIDER = (process.env.WEBCHAT_TTS_PROVIDER || 'browser').trim().toLowerCase();
const DEFAULT_STT_PROVIDER = (process.env.WEBCHAT_STT_PROVIDER || 'browser').trim().toLowerCase();
const PROCESS_PREFIX_RE = /^(?:\s*\.+\s*){3,}/;

function renderTemplate(filenames, replacements) {
    const target = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, filenames);
    if (!target) return null;
    let html = fs.readFileSync(target, 'utf8');
    for (const [key, value] of Object.entries(replacements || {})) {
        html = html.split(key).join(String(value ?? ''));
    }
    return html;
}

function stripCtrlAndAnsi(input) {
    try {
        let out = input || '';
        out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
        out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
        return out;
    } catch (_) {
        return input;
    }
}

function isProcessingChunk(text) {
    if (!text) {
        return false;
    }
    const trimmed = text.replace(/\s/g, '');
    if (trimmed.length === 0 || !/^[.·…]+$/.test(trimmed)) {
        return false;
    }
    const hasWhitespace = /\s/.test(text);
    return hasWhitespace || trimmed.length > 3;
}

function stripProcessingPrefix(text) {
    if (!text) {
        return text;
    }
    const match = PROCESS_PREFIX_RE.exec(text);
    if (!match) {
        return text;
    }
    if (match[0].length >= text.length) {
        return '';
    }
    return text.slice(match[0].length);
}

function looksLikeEnvelopeEcho(text) {
    const normalized = String(text || '').trim();
    return normalized.includes('"__webchatMessage"')
        && normalized.includes('"version"')
        && normalized.includes('"text"')
        && normalized.includes('"attachments"');
}

function parseInputEnvelope(rawBody) {
    const fallbackText = typeof rawBody === 'string' ? rawBody : '';
    try {
        const parsed = JSON.parse(fallbackText);
        if (parsed && parsed.__webchatMessage && typeof parsed === 'object') {
            return {
                text: typeof parsed.text === 'string' ? parsed.text : '',
                attachments: Array.isArray(parsed.attachments) ? parsed.attachments : []
            };
        }
    } catch (_) {
        // Fall back to plain text input.
    }
    return { text: fallbackText, attachments: [] };
}

function buildTranscriptContext(req, appState, tabId) {
    const sid = getSession(req, appState) || '';
    return {
        authMode: req.authMode || (req.user ? 'user' : 'anonymous'),
        sessionId: sid,
        userId: req.user?.id || '',
        tabId
    };
}

function handleTranscriptAssistantLine(tab, rawLine) {
    if (!tab?.transcript) {
        return null;
    }
    const transcript = tab.transcript;
    const originalText = typeof rawLine === 'string' ? rawLine : String(rawLine || '');
    if (!originalText) {
        return null;
    }
    if (isProcessingChunk(originalText)) {
        return null;
    }
    const stripped = stripProcessingPrefix(originalText);
    const normalized = stripped.trim();
    if (!normalized || looksLikeEnvelopeEcho(normalized)) {
        return null;
    }
    const pendingEcho = String(transcript.lastClientText || '').trim();
    if (pendingEcho && normalized === pendingEcho) {
        transcript.lastClientText = '';
        return null;
    }
    try {
        let messageId = transcript.lastAssistantMessageId || null;
        let append = false;
        if (!transcript.userInputSent && transcript.lastAssistantMessageId) {
            const appended = appendTranscriptToMessage(transcript.conversationId, transcript.lastAssistantMessageId, stripped);
            if (!appended) {
                const created = appendTranscriptMessage(transcript.conversationId, {
                    role: 'assistant',
                    text: stripped,
                    metadata: {
                        promptMessageId: transcript.lastUserMessageId || null,
                        turnId: transcript.currentTurnId || null
                    }
                });
                transcript.lastAssistantMessageId = created.messageId;
                messageId = created.messageId;
                append = false;
            } else {
                messageId = transcript.lastAssistantMessageId;
                append = true;
            }
        } else {
            const created = appendTranscriptMessage(transcript.conversationId, {
                role: 'assistant',
                text: stripped,
                metadata: {
                    promptMessageId: transcript.lastUserMessageId || null,
                    turnId: transcript.currentTurnId || null
                }
            });
            transcript.lastAssistantMessageId = created.messageId;
            messageId = created.messageId;
            append = false;
        }
        transcript.userInputSent = false;
        return messageId ? { messageId, append } : null;
    } catch (_) {
        // Transcript capture must never break live chat.
        return null;
    }
}

function captureTranscriptOutput(tab, data) {
    if (!tab?.transcript) {
        return [];
    }
    const transcript = tab.transcript;
    transcript.buffer += stripCtrlAndAnsi(String(data ?? ''));
    const lines = transcript.buffer.split(/\r?\n/);
    transcript.buffer = lines.pop() ?? '';
    const events = [];
    for (const line of lines) {
        const meta = handleTranscriptAssistantLine(tab, line);
        if (meta?.messageId) {
            events.push(meta);
        }
    }
    return events;
}

function flushTranscriptOutput(tab) {
    if (!tab?.transcript?.buffer) {
        return;
    }
    const tail = stripCtrlAndAnsi(tab.transcript.buffer);
    tab.transcript.buffer = '';
    if (tail.trim() && !isProcessingChunk(tail)) {
        handleTranscriptAssistantLine(tab, tail);
    }
}

function getSession(req, appState) {
    const cookies = parseCookies(req);
    const sid = cookies.get(SID_COOKIE);
    return (sid && appState.sessions.has(sid)) ? sid : null;
}

function authorized(req) {
    return Boolean(req?.user);
}

function redirectToRouterLogin(req, res, parsedUrl, agentOverride = '') {
    const returnTo = `${parsedUrl.pathname || `/${appName}/`}${parsedUrl.search || ''}`;
    const params = new URLSearchParams({ returnTo });
    if (agentOverride) {
        params.set('agent', agentOverride);
    }
    res.writeHead(302, {
        Location: `/auth/login?${params.toString()}`,
        'Cache-Control': 'no-store'
    });
    res.end('Authentication required');
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

function forceKillPid(pid, tabId) {
    if (!pid || typeof global.processKill !== 'function') {
        return;
    }
    setTimeout(() => {
        try {
            global.processKill(pid, 0);
            global.processKill(pid, 'SIGKILL');
            console.warn(`[webchat] Force killed lingering process ${pid} for tab ${tabId}`);
        } catch (_) {
            console.log(`[webchat] Process ${pid} already dead for tab ${tabId}`);
        }
    }, 2000);
}

function disposeTab(tab, tabId, session) {
    if (!tab) {
        return;
    }
    const pid = tab.pid || tab.tty?.pid;
    if (tab.disposed) {
        if (session?.tabs instanceof Map) {
            session.tabs.delete(tabId);
        }
        return;
    }
    tab.disposed = true;

    if (tab.cleanupTimer) {
        clearTimeout(tab.cleanupTimer);
        tab.cleanupTimer = null;
    }

    if (tab.tty) {
        flushTranscriptOutput(tab);
        console.log(`[webchat] Disposing TTY for tab ${tabId}`);
        if (typeof tab.tty.dispose === 'function') {
            try {
                tab.tty.dispose();
                console.log(`[webchat] dispose() called for pid ${pid}`);
            } catch (error) {
                console.error(`[webchat] dispose error: ${error?.message}`);
            }
        } else if (typeof tab.tty.kill === 'function') {
            try {
                tab.tty.kill();
                console.log(`[webchat] kill() called for pid ${pid}`);
            } catch (error) {
                console.error(`[webchat] kill error: ${error?.message}`);
            }
        }
        tab.tty = null;
        forceKillPid(pid, tabId);
    }

    if (tab.sseRes) {
        try {
            tab.sseRes.end();
        } catch (_) {
            // Ignore disconnect write failures
        }
    }
    tab.sseRes = null;

    if (session?.tabs instanceof Map) {
        session.tabs.delete(tabId);
    }

    if (tab.transcript?.conversationId) {
        try {
            closeTranscriptConversation(tab.transcript.conversationId);
        } catch (_) {
            // Ignore transcript finalization errors.
        }
    }
}

function buildLogoutRedirect(agentQuery) {
    return agentQuery ? `/${appName}/?${agentQuery}` : `/${appName}/`;
}

function buildSsoLogoutRedirect(agentQuery) {
    const loggedOut = '/auth/logged-out';
    return `/auth/logout?returnTo=${encodeURIComponent(loggedOut)}`;
}

function handleLogout(req, res, appState, agentQuery) {
    const sid = getSession(req, appState);
    const session = sid ? appState.sessions.get(sid) : null;

    if (session?.tabs instanceof Map) {
        for (const [tabId, tab] of session.tabs.entries()) {
            disposeTab(tab, tabId, session);
        }
    }

    if (sid) {
        appState.sessions.delete(sid);
    }

    const cookies = [
        buildCookie(SID_COOKIE, '', req, `/${appName}`, { maxAge: 0 })
    ];

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': cookies,
        'Cache-Control': 'no-store'
    });
    const redirect = req.user
        ? buildSsoLogoutRedirect(agentQuery)
        : buildLogoutRedirect(agentQuery);
    res.end(JSON.stringify({
        ok: true,
        redirect
    }));
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

async function handleWebChat(req, res, appConfig, appState) {
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

    if (pathname === '/auth' && req.method === 'POST') {
        res.writeHead(410, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({
            ok: false,
            error: 'surface_token_auth_removed',
            detail: 'Use the router login page.'
        }));
    }
    if (pathname === '/logout' && req.method === 'POST') return handleLogout(req, res, appState, agentQuery);
    if (pathname === '/whoami') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: authorized(req) }));
    }

    if (pathname === '/feedback' && req.method === 'POST') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        let body;
        try {
            body = await readJsonBody(req);
        } catch (_) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
        }
        const tabId = String(body?.tabId || '').trim();
        const messageId = String(body?.messageId || '').trim();
        const rating = body?.rating === 'up' || body?.rating === 'down' ? body.rating : null;
        const tab = session?.tabs?.get(tabId);
        if (!tab?.transcript?.conversationId || !messageId) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'message_not_found' }));
        }
        try {
            const updated = setTranscriptTurnRating(tab.transcript.conversationId, messageId, rating);
            if (!updated) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: 'message_not_found' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ ok: true }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: error?.message || 'feedback_failed' }));
        }
    }

    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    if (req.user) {
        ensureAppSession(req, res, appState);
    }

    if (!authorized(req)) {
        return redirectToRouterLogin(req, res, parsedUrl, agentOverride);
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
            res.end(effectiveConfig.unavailableReason || 'TTY support unavailable. Install node-pty to enable chat sessions.');
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
                const ssoUser = req.user && req.authMode === 'sso' ? {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    roles: req.user.roles || [],
                    sessionId: req.sessionId || null
                } : null;

                let transcript = null;
                try {
                    const transcriptContext = buildTranscriptContext(req, appState, tabId);
                    const createdTranscript = createTranscriptConversation({
                        agentName: effectiveConfig.agentName || effectiveConfig.displayName || 'webchat',
                        runtime: effectiveConfig.runtime || 'local',
                        authMode: transcriptContext.authMode,
                        sessionId: transcriptContext.sessionId,
                        userId: transcriptContext.userId,
                        tabId: transcriptContext.tabId
                    });
                    transcript = {
                        conversationId: createdTranscript.conversationId,
                        buffer: '',
                        lastClientText: '',
                        userInputSent: false,
                        lastAssistantMessageId: null,
                        lastUserMessageId: null,
                        currentTurnId: null
                    };
                } catch (_) {
                    transcript = null;
                }

                const tty = effectiveConfig.ttyFactory.create(ssoUser);
                tab = {
                    tty,
                    sseRes: res,
                    lastConnectTime: now,
                    createdAt: now,
                    pid: tty.pid || null,
                    cleanupTimer: null,
                    transcript
                };
                session.tabs.set(tabId, tab);

                tty.onOutput((data) => {
                    const transcriptEvents = captureTranscriptOutput(tab, data);
                    if (tab.sseRes) {
                        tab.sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
                        for (const meta of transcriptEvents) {
                            tab.sseRes.write('event: message-meta\n');
                            tab.sseRes.write(`data: ${JSON.stringify(meta)}\n\n`);
                        }
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
                    // Ensure tab resources are fully released so the next reconnect
                    // creates a fresh TTY session instead of writing into a dead process.
                    disposeTab(tab, tabId, session);
                });

            } catch (e) {
                console.error(`[webchat] Failed to create chat session: ${e?.message || e}`);
                if (!res.headersSent) {
                    res.writeHead(500);
                }
                try { res.end('Failed to create chat session: ' + (e?.message || e)); } catch (_) { }
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
            disposeTab(tab, tabId, session);
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
            try {
                const envelope = parseInputEnvelope(body);
                if (tab.transcript && (String(envelope.text || '').trim() || (Array.isArray(envelope.attachments) && envelope.attachments.length))) {
                    const turnId = crypto.randomUUID();
                    const created = appendTranscriptMessage(tab.transcript.conversationId, {
                        role: 'user',
                        text: envelope.text,
                        attachments: envelope.attachments,
                        metadata: {
                            turnId
                        }
                    });
                    tab.transcript.lastClientText = String(envelope.text || '');
                    tab.transcript.userInputSent = true;
                    tab.transcript.lastAssistantMessageId = null;
                    tab.transcript.lastUserMessageId = created.messageId;
                    tab.transcript.currentTurnId = turnId;
                }
            } catch (_) {
                // Ignore transcript capture errors.
            }
            try { tab.tty.write(body); } catch (_) { }
            res.writeHead(204); res.end();
        });
        return;
    }

    res.writeHead(404); res.end(', Not Found in App');
}

export { handleWebChat };
