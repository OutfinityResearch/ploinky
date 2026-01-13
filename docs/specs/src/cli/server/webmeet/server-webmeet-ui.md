# cli/server/webmeet/webmeet-ui.js - WebMeet UI Controller

## Overview

Client-side UI controller for WebMeet. Manages DOM element references, renders state to UI components, handles theme and language selection, and provides banner notifications.

## Source File

`cli/server/webmeet/webmeet-ui.js`

## Constants

```javascript
const commonLanguages = [
    'en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES',
    'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR',
    'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'
];
```

## DOM Elements

```javascript
const elements = {
    body: document.body,
    statusText: query('statusText'),
    statusDot: document.querySelector('.wa-status-dot'),
    participantsToggle: query('participantsToggle'),
    participantsPanel: query('participantsPanel'),
    participantsList: query('vc_participants_list'),
    videoTitle: query('vc_video_title'),
    videoHint: query('vc_video_hint'),
    videoPreview: query('vc_video_preview'),
    videoShell: document.querySelector('.wa-video-shell'),
    sttBtn: query('sttBtn'),
    sttStatus: query('sttStatus'),
    sttEnable: query('sttEnable'),
    sttLang: query('sttLang'),
    themeSelect: query('themeSelect'),
    muteBtn: query('vc_mute_btn'),
    cameraBtn: query('vc_camera_btn'),
    screenBtn: query('vc_screen_btn'),
    deafenBtn: query('vc_deafen_btn'),
    micBtn: query('vc_mic_btn'),
    textarea: query('cmd'),
    sendBtn: query('send'),
    banner: query('connBanner'),
    bannerText: query('bannerText'),
    screenOverlay: query('screenOverlay'),
    screenOverlayVideo: query('screenOverlayVideo'),
    screenOverlayClose: query('screenOverlayClose'),
    screenOverlayTitle: query('screenOverlayTitle')
};
```

## Public API

### init(options)

**Purpose**: Initializes UI controller with callbacks

**Parameters**:
- `options` (Object):
  - `participantSelect` (Function): Callback for participant selection
  - `participantsToggle` (Function): Callback for panel toggle

**Returns**: (Object) DOM elements reference

**Implementation**:
```javascript
function init({ participantSelect, participantsToggle }) {
    onParticipantSelect = participantSelect || (() => {});
    onParticipantsToggle = participantsToggle || (() => {});

    // Query and store DOM elements
    Object.assign(elements, { ... });

    // Populate language selector
    populateSpeechLanguages();

    // Set up event listeners
    // - participantsToggle click
    // - participantsList click delegation
    // - videoShell click for overlay
    // - screenOverlay close handlers

    return elements;
}
```

### render(state)

**Purpose**: Renders state to all UI components

**Parameters**:
- `state` (Object): Full application state

**Implementation**:
```javascript
function render(state) {
    document.body.setAttribute('data-theme', state.theme || 'light');
    renderStatus(state);
    renderParticipants(state);
    renderButtons(state);
    renderVoice(state);
    renderVideo(state);
    renderBanner(state);
}
```

### setVideoStream(stream)

**Purpose**: Sets video preview stream

**Parameters**:
- `stream` (MediaStream|null): Video stream

### showBanner(text, type)

**Purpose**: Shows temporary notification banner

**Parameters**:
- `text` (string): Banner text
- `type` (string): 'ok' or 'err'

**Implementation**:
```javascript
function showBanner(text, type) {
    elements.bannerText.textContent = text;
    elements.banner.className = 'wa-connection-banner show';
    if (type === 'ok') elements.banner.classList.add('success');
    else if (type === 'err') elements.banner.classList.add('error');
    setTimeout(() => {
        elements.banner?.classList.remove('show', 'success', 'error');
    }, 1200);
}
```

## Render Functions

### renderStatus(state)

**Purpose**: Updates connection status display

**Status Messages**:
- Disconnected: "offline"
- Connected, not joined: "Connected — enter email to join"
- Self speaking: "online — You are speaking"
- No speaker: "online — Nobody is speaking"
- Other speaking: "online — {name} is speaking"

### renderParticipants(state)

**Purpose**: Renders participant list with queue and media indicators

**Indicators**:
- ✋ - Raised hand (in queue)
- 🔊 - Currently speaking
- 🖥️ - Sharing screen

### renderButtons(state)

**Purpose**: Updates button states and disabled status

**Buttons**:
- `micBtn` - Hand raise/lower
- `muteBtn` - Mute/unmute
- `cameraBtn` - Camera on/off
- `screenBtn` - Screen share on/off
- `deafenBtn` - Deafen/undeafen
- `sttBtn` - Speech recognition

### renderVoice(state)

**Purpose**: Updates STT status display

### renderVideo(state)

**Purpose**: Refreshes video preview

### renderBanner(state)

**Purpose**: Renders banner from state (if present)

## Language Population

```javascript
function populateSpeechLanguages() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const voiceLangs = voices.map((v) => v.lang).filter(Boolean);
    const langs = Array.from(new Set([...voiceLangs, ...commonLanguages]))
        .sort((a, b) => {
            // Prioritize English
            const aEn = a.startsWith('en-');
            const bEn = b.startsWith('en-');
            if (aEn && !bEn) return -1;
            if (!aEn && bEn) return 1;
            return a.localeCompare(b);
        });
    // Populate sttLang select
}
```

## Global Export

```javascript
window.WebMeetUI = {
    init,
    render,
    setVideoStream,
    showBanner,
    elements
};
```

## Related Modules

- [server-webmeet-store.md](./server-webmeet-store.md) - State management
- [server-webmeet-client.md](./server-webmeet-client.md) - Client logic
- [server-webmeet-media.md](./server-webmeet-media.md) - Media controls

