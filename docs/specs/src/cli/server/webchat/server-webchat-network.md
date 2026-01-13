# cli/server/webchat/network.js - WebChat Network

## Overview

Client-side network module for WebChat communication. Manages Server-Sent Events (SSE) streaming for receiving server responses, handles command sending via POST requests, and manages file uploads with attachment envelope protocol.

## Source File

`cli/server/webchat/network.js`

## Constants

```javascript
const PROCESS_PREFIX_RE = /^(?:\s*\.+\s*){3,}/;
const ENVELOPE_FLAG = '__webchatMessage';
const ENVELOPE_VERSION = 1;
```

## Internal Functions

### stripCtrlAndAnsi(input)

**Purpose**: Removes control characters and ANSI escape sequences

**Parameters**:
- `input` (string): Raw input string

**Returns**: (string) Cleaned string

**Implementation**:
```javascript
function stripCtrlAndAnsi(input) {
    try {
        let out = input || '';
        // Remove OSC sequences
        out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
        // Remove ANSI escape sequences
        out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        // Remove control characters
        out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
        return out;
    } catch (_) {
        return input;
    }
}
```

### isProcessingChunk(text)

**Purpose**: Detects processing indicator patterns (dots)

**Parameters**:
- `text` (string): Text to check

**Returns**: (boolean) True if processing indicator

**Implementation**:
```javascript
function isProcessingChunk(text) {
    if (!text) return false;
    const trimmed = text.replace(/\s/g, '');
    if (trimmed.length === 0 || !/^[.·…]+$/.test(trimmed)) return false;
    const hasWhitespace = /\s/.test(text);
    return hasWhitespace || trimmed.length > 3;
}
```

### stripProcessingPrefix(text)

**Purpose**: Removes processing prefix from text

**Parameters**:
- `text` (string): Text with possible prefix

**Returns**: (string) Text without prefix

**Implementation**:
```javascript
function stripProcessingPrefix(text) {
    if (!text) return text;
    const match = PROCESS_PREFIX_RE.exec(text);
    if (!match) return text;
    if (match[0].length >= text.length) return '';
    return text.slice(match[0].length);
}
```

### serializeEnvelope(payload)

**Purpose**: Serializes message envelope for transmission

**Parameters**:
- `payload` (Object):
  - `text` (string): Message text
  - `attachments` (Array): Attachment metadata

**Returns**: (string) JSON-serialized envelope

**Envelope Structure**:
```javascript
{
    "__webchatMessage": 1,
    "version": 1,
    "text": "message text",
    "attachments": [
        {
            "id": "attachment-id",
            "filename": "file.pdf",
            "mime": "application/pdf",
            "size": 1024,
            "downloadUrl": "/blobs/123",
            "localPath": "/path/to/file"
        }
    ]
}
```

**Implementation**:
```javascript
function serializeEnvelope({ text = '', attachments = [] } = {}) {
    const normalizedAttachments = Array.isArray(attachments)
        ? attachments.map((raw) => {
            if (!raw || typeof raw !== 'object') return null;
            const record = {
                id: typeof raw.id === 'string' ? raw.id : null,
                filename: typeof raw.filename === 'string' ? raw.filename : null,
                mime: typeof raw.mime === 'string' ? raw.mime : null,
                size: Number.isFinite(raw.size) ? raw.size : null,
                downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : null,
                localPath: typeof raw.localPath === 'string' ? raw.localPath : null
            };
            const hasValue = Object.values(record).some((value) => value !== null);
            return hasValue ? record : null;
        }).filter(Boolean)
        : [];

    return JSON.stringify({
        [ENVELOPE_FLAG]: ENVELOPE_VERSION,
        version: ENVELOPE_VERSION,
        text: typeof text === 'string' ? text : '',
        attachments: normalizedAttachments
    });
}
```

## Public API

### createNetwork(config, callbacks)

**Purpose**: Creates network communication module

**Parameters**:
- `config` (Object):
  - `TAB_ID` (string): Unique tab identifier
  - `toEndpoint` (Function): URL builder
  - `dlog` (Function): Debug logger
  - `showBanner` (Function): Show status banner
  - `hideBanner` (Function): Hide status banner
  - `statusEl` (HTMLElement): Status text element
  - `statusDot` (HTMLElement): Status indicator
  - `agentName` (string): Agent name
- `callbacks` (Object):
  - `addClientMsg` (Function): Add client message
  - `addClientAttachment` (Function): Add attachment message
  - `addServerMsg` (Function): Add server message
  - `showTypingIndicator` (Function): Show typing
  - `hideTypingIndicator` (Function): Hide typing
  - `markUserInputSent` (Function): Mark input sent

**Returns**: (Object) Network API

**Return Structure**:
```javascript
{
    start: Function,           // Start SSE connection
    stop: Function,            // Stop SSE connection
    sendCommand: Function,     // Send text command
    sendAttachments: Function  // Send files with caption
}
```

## Module State

```javascript
let es = null;                    // EventSource instance
let chatBuffer = '';              // Partial message buffer
const pendingEchoes = [];         // Commands awaiting echo suppression
let reconnectAttempts = 0;        // Reconnection attempt counter
let reconnectTimer = null;        // Reconnection timer
let pendingUploads = 0;           // Active upload count
```

## SSE Connection Management

### start()

**Purpose**: Establishes SSE connection

**Implementation**:
```javascript
function start() {
    dlog('SSE connecting');
    showBanner('Connecting…');
    try {
        es?.close?.();
    } catch (_) { }

    es = new EventSource(toEndpoint(`stream?tabId=${TAB_ID}`));

    es.onopen = () => {
        reconnectAttempts = 0;
        hideTypingIndicator(true);
        if (statusEl) statusEl.textContent = 'online';
        if (statusDot) {
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
        }
        showBanner('Connected', 'ok');
        setTimeout(() => hideBanner(), 800);
    };

    es.onerror = () => {
        hideTypingIndicator(true);
        if (statusEl) statusEl.textContent = 'offline';
        if (statusDot) {
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
        }
        try { es.close(); } catch (_) { }

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // Exponential backoff with jitter
        reconnectAttempts++;
        const baseDelay = 1000;
        const maxDelay = 60000;
        const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;

        if (reconnectAttempts > 1) {
            showBanner(`Reconnecting in ${Math.ceil(totalDelay / 1000)}s (attempt ${reconnectAttempts})...`);
        }

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            try { start(); } catch (error) { dlog('SSE restart error', error); }
        }, totalDelay);
    };

    es.onmessage = (event) => {
        try {
            const text = JSON.parse(event.data);
            chatBuffer += stripCtrlAndAnsi(text);
            pushSrvFromBuffer();
        } catch (error) {
            dlog('term write error', error);
        }
    };
}
```

### stop()

**Purpose**: Closes SSE connection

**Implementation**:
```javascript
function stop() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectAttempts = 0;
    if (!es) return;
    try { es.close(); } catch (_) { }
    es = null;
}
```

## Message Handling

### handleServerChunk(raw)

**Purpose**: Processes incoming server data chunk

**Parameters**:
- `raw` (string): Raw server data

**Implementation**:
```javascript
function handleServerChunk(raw) {
    if (raw === undefined || raw === null) return;
    let text = String(raw);
    if (!text) return;

    // Handle processing indicators
    if (isProcessingChunk(text)) {
        showTypingIndicator();
        return;
    }

    const stripped = stripProcessingPrefix(text);
    const normalized = stripped.trim();

    // Filter envelope echoes
    if (normalized.includes('"__webchatMessage"') &&
        normalized.includes('"version"') &&
        normalized.includes('"text"') &&
        normalized.includes('"attachments"')) {
        return;
    }

    // Suppress expected echoes
    if (normalized && pendingEchoes.length) {
        const expected = pendingEchoes[0];
        if (normalized === expected) {
            pendingEchoes.shift();
            return;
        }
    }

    if (stripped !== text) showTypingIndicator();
    if (!stripped.trim()) return;
    if (pendingUploads === 0) hideTypingIndicator();
    addServerMsg(stripped);
}
```

## Command Sending

### sendCommand(cmd)

**Purpose**: Sends text command to server

**Parameters**:
- `cmd` (string): Command text

**Returns**: (boolean) Always true

**Implementation**:
```javascript
function sendCommand(cmd) {
    const message = typeof cmd === 'string' ? cmd : '';
    addClientMsg(message);
    postEnvelope({ text: message });
    return true;
}
```

### postEnvelope(payload)

**Purpose**: Posts envelope to server

**Parameters**:
- `payload` (Object): Message payload

**Implementation**:
```javascript
function postEnvelope(payload = {}) {
    const text = typeof payload.text === 'string' ? payload.text : '';
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const serialized = serializeEnvelope({ text, attachments });
    const trimmedEnvelope = serialized.trim();
    const trimmedText = text.trim();

    // Track expected echoes for suppression
    if (trimmedEnvelope) {
        pendingEchoes.push(trimmedEnvelope);
        pendingEchoes.push(serialized);
        pendingEchoes.push(`${serialized}\n`);
    }
    if (trimmedText) {
        pendingEchoes.push(trimmedText);
    }
    if (pendingEchoes.length > 25) {
        pendingEchoes.splice(0, pendingEchoes.length - 25);
    }

    markUserInputSent();

    return fetch(toEndpoint(`input?tabId=${TAB_ID}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `${serialized}\n`
    }).catch((error) => {
        dlog('chat error', error);
        if (pendingUploads === 0) hideTypingIndicator(true);
        addServerMsg('[input error]');
        showBanner('Chat error', 'err');
        throw error;
    });
}
```

## File Upload

### uploadAttachment(filePayload, caption)

**Purpose**: Uploads single file attachment

**Parameters**:
- `filePayload` (Object): File data
- `caption` (string): Optional caption

**Returns**: (Promise<Object>) Upload result

### sendAttachments(fileSelections, caption)

**Purpose**: Uploads multiple attachments with caption

**Parameters**:
- `fileSelections` (Array): Selected files
- `caption` (string): Caption for first file

**Implementation**:
```javascript
function sendAttachments(fileSelections, caption) {
    const selections = Array.isArray(fileSelections) ? fileSelections : [];
    const text = typeof caption === 'string' ? caption : '';

    if (!selections.length) {
        if (text.trim()) sendCommand(text);
        return;
    }

    const uploads = selections.map((selection, index) =>
        uploadAttachment(selection, index === 0 ? text : '')
    );

    Promise.allSettled(uploads).then((results) => {
        const attachments = [];
        let hasSuccess = false;

        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
                hasSuccess = true;
                attachments.push(result.value);
            }
        });

        const trimmedText = text.trim();
        if (!hasSuccess && !trimmedText) return;

        postEnvelope({ text, attachments });
    });
}
```

## Reconnection Strategy

| Attempt | Base Delay | Max Delay | Jitter |
|---------|------------|-----------|--------|
| 1 | 1s | 60s | 0-1s |
| 2 | 2s | 60s | 0-1s |
| 3 | 4s | 60s | 0-1s |
| 4 | 8s | 60s | 0-1s |
| 5 | 16s | 60s | 0-1s |
| 6+ | 32s-60s | 60s | 0-1s |

## Export

```javascript
export function createNetwork(config, callbacks) { ... }
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-messages.md](./server-webchat-messages.md) - Message rendering
- [server-handlers-webchat.md](../handlers/server-handlers-webchat.md) - Server handler

