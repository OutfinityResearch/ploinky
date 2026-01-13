# cli/server/webmeet/webmeet-media.js - WebMeet Media Controller

## Overview

Client-side media controller for WebMeet. Manages camera, screen sharing, microphone muting, speech-to-text dictation, remote media streams, and video preview with overlay support.

## Source File

`cli/server/webmeet/webmeet-media.js`

## Module State

```javascript
const remoteStreams = new Map();  // peerId -> { camera, screen }
let store;                        // State store reference
let ui;                           // UI module reference
let tabId = null;                 // Local tab ID
let sttRecognition = null;        // SpeechRecognition instance
let finalSegments = [];           // STT final segments
let interimTranscript = '';       // STT interim text
let localCameraTrack = null;      // Local camera track
let localCameraStream = null;     // Local camera stream
let localScreenTrack = null;      // Local screen track
let localScreenStream = null;     // Local screen stream
let previewPeer = 'self';         // Current preview peer
let previewKind = 'none';         // Preview type: camera/screen/none
let overlayPeer = null;           // Fullscreen overlay peer

const SpeechRecognitionClass = window.SpeechRecognition ||
    window.webkitSpeechRecognition;
```

## Public API

### init(options)

**Purpose**: Initializes media controller

**Parameters**:
- `options` (Object):
  - `store` (Object): State store
  - `ui` (Object): UI module
  - `tabId` (string): Local tab ID

### setMuted(nextMuted)

**Purpose**: Sets microphone mute state

**Returns**: (Promise<boolean>) Unmuted state

**Implementation**:
```javascript
async function setMuted(nextMuted) {
    if (!window.webMeetWebRTC) return false;
    await ensureBaseStream();
    if (!nextMuted) {
        await window.webMeetWebRTC.goLive();
        window.webMeetWebRTC.resumeBroadcast();
    } else {
        window.webMeetWebRTC.pauseBroadcast();
    }
    store.setState({ isMuted: nextMuted });
    return !nextMuted;
}
```

### setCamera(on)

**Purpose**: Enables/disables camera

**Implementation**:
```javascript
async function setCamera(on) {
    if (on) await enableCamera();
    else await disableCamera();
}

async function enableCamera() {
    await ensureBaseStream();
    if (localCameraTrack && store.getState().cameraOn) return;
    const stream = await navigator.mediaDevices.getUserMedia({
        video: true, audio: false
    });
    localCameraTrack = stream.getVideoTracks()[0];
    localCameraStream = new MediaStream([localCameraTrack]);
    await window.webMeetWebRTC.enableCamera(localCameraTrack);
    store.setState({ cameraOn: true });
    if (tabId) updateRemoteMedia(tabId, 'camera', true);
    registerLocalTrack(localCameraTrack, 'camera');
    refreshPreview();
}
```

### setScreenShare(on)

**Purpose**: Enables/disables screen sharing

### setDeafened(deafened)

**Purpose**: Sets deafen state (mute remote audio)

**Implementation**:
```javascript
function setDeafened(deafened) {
    store.setState({ isDeafened: deafened });
    window.webMeetWebRTC?.muteAllRemoteAudio(deafened);
    if (deafened) voiceStatus('Deafened');
    else voiceStatus(store.getState().stt.active ? 'Listening…' : status);
}
```

### toggleDictation(sendFn)

**Purpose**: Toggles speech-to-text dictation

**Parameters**:
- `sendFn` (Function): Message send callback

### stopRecognition()

**Purpose**: Stops STT recognition

### handleRemoteStream(peerId, stream, kind)

**Purpose**: Registers remote media stream

**Implementation**:
```javascript
function handleRemoteStream(peerId, stream, suppliedKind) {
    if (!stream?.getVideoTracks?.().length) return;
    const kind = suppliedKind || determineStreamKind(stream);
    const entry = resolveRemoteEntry(peerId);
    entry[kind] = stream;
    updateRemoteMedia(peerId, kind, true);
    registerRemoteCleanup(stream, peerId, kind);
    if (overlayPeer === peerId && kind === 'screen') {
        showScreenOverlay(peerId);
    }
    refreshPreview();
}
```

### handlePeerClosed(peerId, opts)

**Purpose**: Cleans up peer media on disconnect

### selectParticipant(id)

**Purpose**: Selects participant for video preview

### showScreenOverlay(peerId)

**Purpose**: Shows fullscreen screen share overlay

### hideScreenOverlay()

**Purpose**: Hides screen share overlay

### openPreviewOverlay()

**Purpose**: Opens overlay for current preview

### refreshPreview()

**Purpose**: Updates video preview based on state

## STT Dictation

```javascript
function startRecognition(sendFn) {
    if (!SpeechRecognitionClass || !store.getState().stt.enabled) return;
    if (sttRecognition) return;

    const { stt } = store.getState();
    sttRecognition = new SpeechRecognitionClass();
    sttRecognition.lang = stt.lang || 'en-GB';
    sttRecognition.continuous = true;
    sttRecognition.interimResults = true;
    finalSegments = [];
    interimTranscript = '';

    sttRecognition.onresult = (event) => {
        interimTranscript = '';
        let triggerSend = false;
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const transcript = (res[0]?.transcript || '').trim();
            if (res.isFinal) {
                finalSegments.push(transcript);
                if (/\bsend\b/i.test(finalSegments.join(' '))) {
                    triggerSend = true;
                }
            } else {
                interimTranscript += ' ' + transcript;
            }
        }
        if (triggerSend) handleDictationSend(sendFn);
        if (ui?.elements?.textarea) {
            ui.elements.textarea.value = currentTranscript();
        }
    };

    sttRecognition.start();
    updateSttState({ listening: true, active: true });
    voiceStatus('Listening…');
}
```

## Stream Kind Detection

```javascript
function determineStreamKind(stream) {
    const track = stream?.getVideoTracks?.[0];
    if (!track) return 'camera';
    const settings = track.getSettings ? track.getSettings() : {};
    const label = track.label || '';
    if (settings.displaySurface ||
        /screen|window|display|monitor/i.test(label)) {
        return 'screen';
    }
    return 'camera';
}
```

## Preview Management

```javascript
function refreshPreview() {
    const state = store.getState();
    if (!ui) return;

    // Priority 1: Selected participant
    if (state.selectedParticipant) {
        const entry = resolveRemoteEntry(state.selectedParticipant);
        if (entry.screen) {
            setPreview(entry.screen, 'screen', state.selectedParticipant);
        } else if (entry.camera) {
            setPreview(entry.camera, 'camera', state.selectedParticipant);
        } else {
            setPreview(null, 'none', state.selectedParticipant);
        }
        return;
    }

    // Priority 2: Self screen share
    if (state.screenOn && localScreenStream) {
        setPreview(localScreenStream, 'screen', 'self');
    }
    // Priority 3: Self camera
    else if (state.cameraOn && localCameraStream) {
        setPreview(localCameraStream, 'camera', 'self');
    }
    // Default: No preview
    else {
        setPreview(null, 'none', 'self');
    }
}
```

## Global Export

```javascript
window.WebMeetMedia = {
    init,
    refreshPreview,
    setMuted,
    setCamera,
    setScreenShare,
    setDeafened,
    toggleDictation,
    stopRecognition,
    handleRemoteStream,
    handlePeerClosed,
    selectParticipant,
    showScreenOverlay,
    hideScreenOverlay,
    openPreviewOverlay
};
```

## Related Modules

- [server-webmeet-store.md](./server-webmeet-store.md) - State management
- [server-webmeet-ui.md](./server-webmeet-ui.md) - UI rendering
- [server-webmeet-webrtc-room.md](./server-webmeet-webrtc-room.md) - WebRTC

