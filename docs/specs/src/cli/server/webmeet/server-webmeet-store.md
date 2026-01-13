# cli/server/webmeet/webmeet-store.js - WebMeet State Store

## Overview

Client-side state management store for WebMeet. Provides centralized state with subscription-based updates, path-based patching, and functional update patterns.

## Source File

`cli/server/webmeet/webmeet-store.js`

## State Structure

```javascript
const state = {
    connected: false,           // SSE connection status
    joined: false,              // Meeting joined status
    participants: [],           // Meeting participants
    queue: [],                  // Speaker queue
    currentSpeaker: null,       // Current speaker ID
    myEmail: '',                // User's email
    handRaised: false,          // Hand raised status
    isMuted: true,              // Microphone muted
    cameraOn: false,            // Camera active
    isDeafened: false,          // Deafened (mute others)
    selectedParticipant: null,  // Selected participant for preview
    screenOn: false,            // Screen sharing active
    remoteMedia: {},            // Remote media tracks by peer
    theme: 'light',             // UI theme
    stt: {                      // Speech-to-text state
        supported: boolean,     // Browser support
        enabled: boolean,       // User enabled
        active: boolean,        // Currently active
        listening: boolean,     // Listening status
        status: 'Off',          // Status text
        lang: 'en-GB'           // Language code
    }
};
```

## Initialization

```javascript
const initialLang = (() => {
    try { return localStorage.getItem('vc_stt_lang') || 'en-GB'; }
    catch (_) { return 'en-GB'; }
})();

const initialTheme = (() => {
    try { return localStorage.getItem('webmeet_theme') || 'light'; }
    catch (_) { return 'light'; }
})();

const sttSupported = typeof (window.SpeechRecognition ||
    window.webkitSpeechRecognition) === 'function';
const sttEnabled = localStorage.getItem('vc_stt_enabled') !== 'false';
```

## Public API

### getState()

**Purpose**: Returns current state object

**Returns**: (Object) State object

### setState(patch)

**Purpose**: Merges patch into state and notifies subscribers

**Parameters**:
- `patch` (Object): Properties to merge

**Implementation**:
```javascript
function setState(patch) {
    Object.assign(state, patch);
    notify();
}
```

### update(updater)

**Purpose**: Functional state update with immutable pattern

**Parameters**:
- `updater` (Function): (currentState) => newState

**Implementation**:
```javascript
function update(updater) {
    if (typeof updater === 'function') {
        const next = updater({ ...state });
        if (next && typeof next === 'object') {
            Object.assign(state, next);
            notify();
        }
    }
}
```

### patchPath(path, value)

**Purpose**: Updates nested state by dot-notation path

**Parameters**:
- `path` (string): Dot-notation path (e.g., 'stt.status')
- `value` (any): New value

**Implementation**:
```javascript
function patchPath(path, value) {
    const keys = path.split('.');
    let target = state;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (!(key in target)) target[key] = {};
        target = target[key];
    }
    target[keys[keys.length - 1]] = value;
    notify();
}
```

### subscribe(fn)

**Purpose**: Subscribes to state changes

**Parameters**:
- `fn` (Function): Callback receiving state

**Returns**: (Function) Unsubscribe function

**Implementation**:
```javascript
function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}
```

## Notification System

```javascript
const subscribers = new Set();

function notify() {
    for (const fn of subscribers) {
        try { fn(state); }
        catch (err) { console.error('[WebMeetStore] subscriber error', err); }
    }
}
```

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `vc_stt_lang` | STT language preference |
| `vc_stt_enabled` | STT enabled state |
| `webmeet_theme` | UI theme preference |

## Global Export

```javascript
window.WebMeetStore = {
    getState,
    setState,
    update,
    patchPath,
    subscribe
};
```

## Usage Example

```javascript
const store = window.WebMeetStore;

// Get current state
const state = store.getState();

// Simple state update
store.setState({ connected: true });

// Functional update (immutable pattern)
store.update((state) => ({
    participants: [...state.participants, newParticipant]
}));

// Nested path update
store.patchPath('stt.status', 'Listening...');

// Subscribe to changes
const unsubscribe = store.subscribe((state) => {
    console.log('State changed:', state);
});

// Cleanup
unsubscribe();
```

## Related Modules

- [server-webmeet-client.md](./server-webmeet-client.md) - Client integration
- [server-webmeet-ui.md](./server-webmeet-ui.md) - UI rendering
- [server-webmeet-media.md](./server-webmeet-media.md) - Media controls

