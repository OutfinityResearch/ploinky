# cli/server/handlers/webchat.js - WebChat Handler

## Overview

Handles HTTP requests for the WebChat web application. Provides chat interface with SSE streaming, text-to-speech, speech-to-text, and real-time voice capabilities. Supports per-agent chat sessions with session management and TTY process limits.

## Source File

`cli/server/handlers/webchat.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { resolveWebchatCommandsForAgent } from '../webchat/commandResolver.js';
import { loadToken, parseCookies, buildCookie, readJsonBody, appendSetCookie, parseMultipartFormData } from './common.js';
import * as staticSrv from '../static/index.js';
import { createServerTtsStrategy } from './ttsStrategies/index.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appName = 'webchat';
const fallbackAppPath = path.join(__dirname, '../', appName);
const SID_COOKIE = `${appName}_sid`;

const DEFAULT_TTS_PROVIDER = (process.env.WEBCHAT_TTS_PROVIDER || 'browser').trim().toLowerCase();
const DEFAULT_STT_PROVIDER = (process.env.WEBCHAT_STT_PROVIDER || 'browser').trim().toLowerCase();
```

## Internal Functions

### renderTemplate(filenames, replacements)

**Purpose**: Renders HTML template with variable substitution

**Parameters**:
- `filenames` (string[]): Template filenames to try
- `replacements` (Object): Key-value replacements

**Returns**: (string|null) Rendered HTML or null

**Implementation**:
```javascript
function renderTemplate(filenames, replacements) {
    const target = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, filenames);
    if (!target) return null;
    let html = fs.readFileSync(target, 'utf8');
    for (const [key, value] of Object.entries(replacements || {})) {
        html = html.split(key).join(String(value ?? ''));
    }
    return html;
}
```

### getSession(req, appState)

**Purpose**: Gets session ID from cookie if valid

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `appState` (Object): Application state with sessions Map

**Returns**: (string|null) Session ID or null

### authorized(req, appState)

**Purpose**: Checks if request is authorized

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `appState` (Object): Application state

**Returns**: (boolean) True if authorized (SSO user or valid session)

### handleAuth(req, res, appConfig, appState)

**Purpose**: Handles legacy token authentication (disabled when SSO enabled)

**Behavior**:
- Returns 400 if SSO is enabled
- Validates token from request body
- Creates new session on success

### ensureAppSession(req, res, appState)

**Purpose**: Ensures app session exists for SSO users

**Returns**: (string) Session ID

**Implementation**:
```javascript
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
```

### handleTextToSpeech(req, res)

**Purpose**: Server-side text-to-speech synthesis

**Method**: POST `/webchat/tts`

**Request Body**:
```json
{
    "text": "Text to synthesize",
    "voice": "optional voice name",
    "speed": 1.0
}
```

**Response**:
```json
{
    "audio": "base64 encoded audio",
    "contentType": "audio/mpeg"
}
```

**Implementation**:
```javascript
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
    const voice = typeof strategy.normalizeVoice === 'function'
        ? strategy.normalizeVoice(body?.voice)
        : body?.voice;
    const speed = typeof strategy.clampSpeed === 'function'
        ? strategy.clampSpeed(body?.speed)
        : Number(body?.speed) || 1;

    try {
        const result = await strategy.synthesize({ text: trimmedText, voice, speed });
        if (!result || !result.audio) {
            throw new Error('tts_missing_audio');
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ audio: result.audio, contentType: result.contentType || 'audio/mpeg' }));
    } catch (error) {
        const status = error?.status && Number.isInteger(error.status) ? error.status : 502;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: error?.message || 'Text-to-speech request failed.' }));
    }
}
```

### handleSpeechToText(req, res)

**Purpose**: Server-side speech-to-text transcription using OpenAI Whisper

**Method**: POST `/webchat/stt`

**Request**: Multipart form data with `audio` file field

**Response**:
```json
{
    "text": "Transcribed text"
}
```

**Environment Variables**:
- `OPENAI_API_KEY`: Required for Whisper API
- `WEBCHAT_STT_MODEL`: Model to use (default: 'whisper-1')

**Implementation**:
```javascript
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

    // Build multipart form for OpenAI API
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    // ... form construction and API call

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
    });

    const result = await response.json();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ text: result.text || '' }));
}
```

### handleRealtimeToken(req, res)

**Purpose**: Returns token for OpenAI Realtime API access

**Method**: POST `/webchat/realtime-token`

**Response**:
```json
{
    "client_secret": {
        "value": "api_key",
        "expires_at": 1234567890
    }
}
```

**Environment Variables**:
- `OPENAI_API_KEY`: API key to return
- `WEBCHAT_REALTIME_MODEL`: Model name (default: 'gpt-4o-realtime-preview-2024-12-17')

## Public API

### handleWebChat(req, res, appConfig, appState)

**Purpose**: Main request handler for webchat routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `appConfig` (Object): App configuration with ttyFactory
- `appState` (Object): Application state with sessions Map

**Routes**:

| Path | Method | Description |
|------|--------|-------------|
| `/webchat/auth` | POST | Legacy token authentication |
| `/webchat/whoami` | GET | Check authorization status |
| `/webchat/assets/*` | GET | Static assets |
| `/webchat/tts` | POST | Text-to-speech synthesis |
| `/webchat/stt` | POST | Speech-to-text transcription |
| `/webchat/realtime-token` | POST | Get Realtime API token |
| `/webchat/` | GET | Main chat interface |
| `/webchat/stream` | GET | SSE stream for chat output |
| `/webchat/input` | POST | Send input to chat |

**Agent Override**:
Supports `?agent=<name>` query parameter to connect to specific agent.

**Connection Limits**:
- `MAX_GLOBAL_TTYS = 20`: Maximum total TTY processes
- `MAX_CONCURRENT_TTYS = 3`: Maximum per session
- `MIN_RECONNECT_INTERVAL_MS = 1000`: Reconnection debounce

**SSE Stream Implementation**:
```javascript
// /webchat/stream handler
if (pathname === '/stream') {
    const sid = getSession(req, appState);
    const session = appState.sessions.get(sid);
    const tabId = parsedUrl.searchParams.get('tabId');
    if (!session || !tabId) { res.writeHead(400); return res.end(); }

    // Global limit check
    const MAX_GLOBAL_TTYS = 20;
    let globalTabCount = 0;
    for (const sess of appState.sessions.values()) {
        if (sess.tabs instanceof Map) {
            globalTabCount += sess.tabs.size;
        }
    }
    if (globalTabCount >= MAX_GLOBAL_TTYS) {
        res.writeHead(503, { 'Retry-After': '30' });
        res.end('Server at capacity. Please try again later.');
        return;
    }

    // Per-session limit
    const MAX_CONCURRENT_TTYS = 3;
    if (session.tabs.size >= MAX_CONCURRENT_TTYS) {
        res.writeHead(429, { 'Retry-After': '5' });
        res.end('Too many concurrent connections.');
        return;
    }

    // Reconnection debounce
    let tab = session.tabs.get(tabId);
    const now = Date.now();
    if (tab && tab.lastConnectTime && (now - tab.lastConnectTime) < 1000) {
        res.writeHead(429, { 'Retry-After': '1' });
        res.end('Reconnecting too fast.');
        return;
    }

    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'x-accel-buffering': 'no',
        'alt-svc': 'clear'
    });
    res.write(': connected\n\n');

    // Create or reuse TTY
    if (!tab) {
        const ssoUser = req.user ? {
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            roles: req.user.roles || [],
            sessionId: req.sessionId || null
        } : null;

        const tty = effectiveConfig.ttyFactory.create(ssoUser);
        tab = {
            tty,
            sseRes: res,
            lastConnectTime: now,
            createdAt: now,
            pid: tty.pid || null
        };
        session.tabs.set(tabId, tab);

        tty.onOutput((data) => {
            if (tab.sseRes) {
                tab.sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        });
        tty.onClose(() => {
            if (tab.sseRes) {
                tab.sseRes.write('event: close\ndata: {}\n\n');
            }
        });
    } else {
        tab.sseRes = res;
        tab.lastConnectTime = now;
    }

    // Cleanup on disconnect
    req.on('close', () => {
        if (tab.tty) {
            if (typeof tab.tty.dispose === 'function') {
                tab.tty.dispose();
            }
            // Force kill lingering processes after 2s
            if (tab.pid) {
                setTimeout(() => {
                    try {
                        global.processKill(tab.pid, 'SIGKILL');
                    } catch (_) { }
                }, 2000);
            }
        }
        session.tabs.delete(tabId);
    });
}
```

**Template Variables**:
- `__ASSET_BASE__`: Base path for assets
- `__AGENT_NAME__`: Agent identifier
- `__DISPLAY_NAME__`: Display name for UI
- `__RUNTIME__`: Runtime type (local/container)
- `__REQUIRES_AUTH__`: Whether auth is required
- `__BASE_PATH__`: Base URL path
- `__TTS_PROVIDER__`: TTS provider name
- `__STT_PROVIDER__`: STT provider name
- `__AGENT_QUERY__`: Agent query string

## Exports

```javascript
export { handleWebChat };
```

## Session State Structure

```javascript
{
    sessions: Map {
        'session_id': {
            tabs: Map {
                'tab_id': {
                    tty: TTYProcess,
                    sseRes: ServerResponse,
                    lastConnectTime: number,
                    createdAt: number,
                    pid: number,
                    cleanupTimer: Timer
                }
            },
            createdAt: number
        }
    }
}
```

## Usage Example

```javascript
import { handleWebChat } from './handlers/webchat.js';

const appState = {
    sessions: new Map()
};

const appConfig = {
    ttyFactory: {
        create: (ssoUser) => {
            // Create PTY process
            return { onOutput, onClose, write, dispose, pid };
        }
    },
    agentName: 'my-agent',
    displayName: 'My Agent'
};

// In request handler
if (req.url.startsWith('/webchat')) {
    handleWebChat(req, res, appConfig, appState);
}
```

## Related Modules

- [server-handlers-common.md](./server-handlers-common.md) - HTTP utilities
- [server-static-index.md](../static/server-static-index.md) - Static file serving
- [server-webchat-command-resolver.md](../webchat/server-webchat-command-resolver.md) - Agent resolution
- [server-tts-strategies.md](../webchat/strategies/tts/server-tts-strategies.md) - TTS providers
