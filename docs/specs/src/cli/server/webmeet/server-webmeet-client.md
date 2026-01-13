# cli/server/webmeet/webmeet-client.js - WebMeet Client

## Overview

Client-side meeting client for WebMeet. Manages SSE connection for real-time events, chat messaging, participant management, speaker queue, and WebRTC coordination. Main orchestrator for the meeting UI.

## Source File

`cli/server/webmeet/webmeet-client.js`

## Constants

```javascript
const TAB_ID = (() => {
    try {
        let v = sessionStorage.getItem('vc_tab');
        if (!v) {
            v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
            sessionStorage.setItem('vc_tab', v);
        }
        return v;
    } catch (_) {
        return String(Math.random()).slice(2);
    }
})();

const EMAIL_KEY = 'webmeet_saved_email';
```

## Module State

```javascript
let es = null;              // EventSource
let pingTimer = null;       // Keep-alive timer
let broadcasting = false;   // Currently broadcasting audio
```

## Email Persistence

```javascript
function getStoredEmail() {
    try {
        return localStorage.getItem(EMAIL_KEY) ||
               localStorage.getItem('vc_email') || '';
    } catch (_) { return ''; }
}

function storeEmail(val) {
    try {
        localStorage.setItem(EMAIL_KEY, val || '');
        localStorage.setItem('vc_email', val || '');
    } catch (_) {}
}
```

## Speaking Control

### beginSpeaking(targets, options)

**Purpose**: Activates speaking mode

```javascript
function beginSpeaking(targets, { notify = true } = {}) {
    setLiveTargets(Array.isArray(targets) ? targets : []);
    broadcasting = true;
    store?.setState?.({ handRaised: false });
    unmuteForSpeaking();
    if (notify) {
        window.WebMeetUI?.showBanner?.("It's your turn to speak", 'ok');
    }
}
```

### finishSpeaking()

**Purpose**: Deactivates speaking mode

```javascript
function finishSpeaking() {
    if (broadcasting) {
        setLiveTargets([]);
    }
    broadcasting = false;
    muteForIdle();
}
```

## Chat Functions

### createMessageBubble(msg, isSelf)

**Purpose**: Creates chat message DOM element

**Features**:
- ANSI stripping
- URL linkification
- Long message truncation (600 chars) with "View more"
- TTS button for incoming messages
- Moderator/forbidden/moderated styling

### renderChatMessage(msg)

**Purpose**: Appends message to chat list

### sendTextMessage(text)

**Purpose**: Sends chat message via action endpoint

```javascript
function sendTextMessage(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    renderChatMessage({
        from: store.getState().myEmail || 'me',
        text: trimmed,
        ts: Date.now(),
        tabId: TAB_ID
    });
    postAction({
        type: 'chat',
        text: trimmed,
        from: store.getState().myEmail || TAB_ID
    });
}
```

## Server Communication

### postAction(payload)

**Purpose**: Sends action to server

```javascript
async function postAction(payload) {
    const body = { ...payload, tabId: TAB_ID };
    try {
        const res = await fetch('action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    } catch (err) {
        console.error('[WebMeet] action failed', err);
        return { ok: false, error: err.message };
    }
}
```

### handleJoin(email)

**Purpose**: Joins meeting with email

```javascript
function handleJoin(email) {
    const trimmed = (email || '').trim();
    if (!trimmed || !/\S+@\S+\.\S+/.test(trimmed)) {
        window.WebMeetUI.showBanner('Enter a valid email to join', 'err');
        return;
    }
    storeEmail(trimmed);
    store.setState({ myEmail: trimmed });
    postAction({ type: 'hello', email: trimmed, name: trimmed }).then((res) => {
        if (res?.ok === false) {
            window.WebMeetUI.showBanner('Join failed, try again', 'err');
            return;
        }
        store.setState({ joined: true });
        window.WebMeetUI.showBanner('Joined meeting', 'ok');
    });
}
```

## SSE Connection

### connectSSE()

**Purpose**: Establishes SSE event stream

```javascript
function connectSSE() {
    if (es) return;
    es = new EventSource(`events?tabId=${encodeURIComponent(TAB_ID)}`);

    es.addEventListener('open', async () => {
        store.setState({ connected: true });
        WebMeetUI.showBanner('Connected', 'ok');
        // Auto-join if email saved
        const saved = getStoredEmail();
        if (saved) handleJoin(saved);
        // Start ping timer
        pingTimer = setInterval(() => {
            postAction({ type: 'ping' }).then((res) => {
                if (res?.ok === false) handleDisconnect();
            });
        }, 30000);
    });

    // Attach event handlers for:
    // init, participant_join, participant_leave, queue,
    // current_speaker, chat, chat_private, signal, start_speaking
}
```

### handleSseMessage(type, data)

**Purpose**: Processes SSE event by type

**Event Types**:
| Event | Action |
|-------|--------|
| `init` | Initialize participants, queue, speaker, history |
| `participant_join` | Add participant to list |
| `participant_leave` | Remove participant, cleanup peer |
| `queue` | Update speaker queue |
| `current_speaker` | Update speaker, begin/finish speaking |
| `start_speaking` | Begin speaking with targets |
| `chat` / `chat_private` | Render message, handle speak command |
| `signal` | Forward to WebRTC |

### handleDisconnect()

**Purpose**: Handles disconnection cleanup

```javascript
function handleDisconnect() {
    store.setState({
        connected: false,
        joined: false,
        participants: [],
        queue: [],
        currentSpeaker: null,
        isMuted: true,
        cameraOn: false,
        handRaised: false,
        selectedParticipant: null
    });
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    WebMeetUI.showBanner('Disconnected', 'err');
    finishSpeaking();
    window.WebMeetWebRTC?.stopMic();
    window.WebMeetMedia?.setCamera(false);
    window.WebMeetMedia?.setScreenShare(false);
    window.WebMeetMedia?.stopRecognition?.();
}
```

## Initialization

```javascript
window.addEventListener('DOMContentLoaded', () => {
    initDomRefs();
    window.webMeetDemo?.init(chatList);
    uiElements = WebMeetUI.init({ participantSelect, participantsToggle });
    WebMeetMedia.init({ store, ui: WebMeetUI, tabId: TAB_ID });
    initEvents();
    handleButtonBindings();
    restoreEmail();
    store.subscribe(handleStoreUpdate);
    handleStoreUpdate(store.getState());
    connectSSE();
});
```

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `events?tabId=<id>` | GET (SSE) | Event stream |
| `action` | POST | Send actions |

## Action Types

| Type | Description |
|------|-------------|
| `hello` | Join meeting |
| `chat` | Send message |
| `ping` | Keep-alive |
| `signal` | WebRTC signaling |
| `wantToSpeak` | Raise hand |
| `endSpeak` | Lower hand |

## Global Export

```javascript
window.WebMeetClient = {
    postAction,
    connect: connectSSE,
    disconnect: disconnectSSE
};

window.webMeetClient = window.WebMeetClient;
```

## Related Modules

- [server-webmeet-store.md](./server-webmeet-store.md) - State management
- [server-webmeet-ui.md](./server-webmeet-ui.md) - UI rendering
- [server-webmeet-media.md](./server-webmeet-media.md) - Media controls
- [server-webmeet-webrtc-room.md](./server-webmeet-webrtc-room.md) - WebRTC

