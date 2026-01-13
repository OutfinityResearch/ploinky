# cli/server/webchat/textToSpeech.js - WebChat Text-to-Speech

## Overview

Client-side text-to-speech module for WebChat. Manages voice synthesis with queuing, preference persistence, voice selection, and rate control. Supports multiple TTS providers through a strategy pattern.

## Source File

`cli/server/webchat/textToSpeech.js`

## Dependencies

```javascript
import { createTtsStrategy } from './strategies/tts/index.js';
```

## Constants

```javascript
const TTS_ENABLED_KEY = 'vc_tts_enabled';
const TTS_VOICE_KEY = 'vc_tts_voice';
const TTS_RATE_KEY = 'vc_tts_rate';

const MAX_QUEUE_LENGTH = 8;
const MAX_TEXT_LENGTH = 4000;
const DEFAULT_MODEL_SPEED = 1;
```

## Internal Functions

### clampRate(value)

**Purpose**: Clamps rate value between 0.5 and 2.0

**Parameters**:
- `value` (number): Rate value

**Returns**: (number) Clamped rate

**Implementation**:
```javascript
function clampRate(value) {
    if (!Number.isFinite(value)) return DEFAULT_MODEL_SPEED;
    return Math.min(2, Math.max(0.5, value));
}
```

### safeSetText(el, text)

**Purpose**: Safely sets element text content

**Parameters**:
- `el` (HTMLElement): Target element
- `text` (string): Text content

**Implementation**:
```javascript
function safeSetText(el, text) {
    if (!el) return;
    try {
        el.textContent = text;
    } catch (_) { }
}
```

## Public API

### initTextToSpeech(elements, options)

**Purpose**: Initializes text-to-speech functionality

**Parameters**:
- `elements` (Object):
  - `ttsEnable` (HTMLInputElement): Enable checkbox
  - `ttsVoice` (HTMLSelectElement): Voice selector
  - `ttsRate` (HTMLInputElement): Rate slider
  - `ttsRateValue` (HTMLElement): Rate display
- `options` (Object):
  - `dlog` (Function): Debug logger
  - `toEndpoint` (Function): Endpoint builder
  - `provider` (string): TTS provider name

**Returns**: (Object) TTS API

**Return Structure**:
```javascript
{
    handleServerOutput: Function,  // Process server text for speech
    cancel: Function               // Stop all playback
}
```

## Module State

```javascript
const state = {
    enabled: false,           // TTS enabled
    voice: string,            // Selected voice
    rate: number,             // Playback rate
    queue: [],                // Text queue
    playing: boolean,         // Currently playing
    currentAudio: Audio,      // Current audio element
    currentStop: Function,    // Stop current playback
    currentCleanup: Function, // Cleanup function
    lastSpokenText: string,   // Last spoken text
    disableOnError: boolean   // Disabled due to error
};
```

## Preference Persistence

### persistEnabled()

**Purpose**: Saves enabled state to localStorage

**Implementation**:
```javascript
function persistEnabled() {
    try {
        localStorage.setItem(TTS_ENABLED_KEY, state.enabled ? 'true' : 'false');
    } catch (_) { }
}
```

### persistVoice()

**Purpose**: Saves voice selection to localStorage

### persistRate()

**Purpose**: Saves rate setting to localStorage

### loadPreferences()

**Purpose**: Loads preferences from localStorage

**Implementation**:
```javascript
function loadPreferences() {
    // Always start disabled
    state.enabled = false;
    try {
        localStorage.setItem(TTS_ENABLED_KEY, 'false');
    } catch (_) { }

    // Load voice preference
    try {
        const storedVoice = localStorage.getItem(TTS_VOICE_KEY);
        if (storedVoice) state.voice = storedVoice;
    } catch (_) { }

    // Load rate preference
    try {
        const storedRate = parseFloat(localStorage.getItem(TTS_RATE_KEY));
        if (Number.isFinite(storedRate)) state.rate = clampRate(storedRate);
    } catch (_) {
        state.rate = DEFAULT_MODEL_SPEED;
    }
}
```

## Voice Management

### refreshVoiceOptions()

**Purpose**: Refreshes available voice options from strategy

**Implementation**:
```javascript
async function refreshVoiceOptions() {
    if (!ttsVoice) return;
    try {
        const options = await strategy.getVoiceOptions?.();
        voiceOptions = Array.isArray(options) && options.length ? options : [];
    } catch (error) {
        dlog('tts voice options error', error);
        voiceOptions = [];
    }

    // Fallback to default voice
    if (!voiceOptions.length) {
        const fallback = strategy.getDefaultVoice ? strategy.getDefaultVoice() : null;
        if (fallback) {
            voiceOptions = [{ value: fallback, label: fallback }];
        }
    }

    // Populate select element
    ttsVoice.innerHTML = '';
    voiceOptions.forEach((option) => {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label || option.value;
        ttsVoice.appendChild(node);
    });

    // Validate current selection
    const hasStoredVoice = voiceOptions.some((opt) => opt.value === state.voice);
    if (!hasStoredVoice) {
        const defaultVoice = strategy.getDefaultVoice ? strategy.getDefaultVoice() : null;
        state.voice = defaultVoice || voiceOptions[0]?.value || null;
    }
    ttsVoice.value = state.voice || '';
    persistVoice();
}
```

## Playback Control

### stopCurrentPlayback()

**Purpose**: Stops current audio playback

**Implementation**:
```javascript
function stopCurrentPlayback() {
    if (state.currentCleanup) {
        try { state.currentCleanup(); } catch (_) { }
        state.currentCleanup = null;
    }
    if (state.currentStop) {
        try { state.currentStop(); } catch (_) { }
        state.currentStop = null;
    }
    if (state.currentAudio) {
        try { state.currentAudio.pause(); } catch (_) { }
        state.currentAudio = null;
    }
}
```

### stopAll()

**Purpose**: Stops all playback and clears queue

**Implementation**:
```javascript
function stopAll() {
    clearQueue();
    stopCurrentPlayback();
    state.playing = false;
    if (typeof strategy.cancel === 'function') {
        try { strategy.cancel(); } catch (_) { }
    }
}
```

### setEnabled(value)

**Purpose**: Sets TTS enabled state

**Parameters**:
- `value` (boolean): Enabled state

**Implementation**:
```javascript
function setEnabled(value) {
    state.enabled = Boolean(value);
    if (ttsEnable) ttsEnable.checked = state.enabled;
    persistEnabled();
    if (!state.enabled) {
        stopAll();
        state.lastSpokenText = '';
    }
}
```

## Queue Management

### enqueueSpeech(text)

**Purpose**: Adds text to speech queue

**Parameters**:
- `text` (string): Text to speak

**Implementation**:
```javascript
function enqueueSpeech(text) {
    if (!state.enabled || state.disableOnError) return;
    const source = (text || '').trim();
    if (!source) return;

    const trimmed = typeof strategy.trimText === 'function'
        ? strategy.trimText(source)
        : source;
    if (!trimmed) return;

    const delta = trimmed.length > MAX_TEXT_LENGTH
        ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}…`
        : trimmed;
    if (delta === state.lastSpokenText) return;

    state.queue.push(delta);
    if (state.queue.length > MAX_QUEUE_LENGTH) {
        state.queue.splice(0, state.queue.length - MAX_QUEUE_LENGTH);
    }
    processQueue();
}
```

### processQueue()

**Purpose**: Processes queued text for speech

**Implementation**:
```javascript
async function processQueue() {
    if (processing || !state.enabled || state.disableOnError) return;
    if (!state.queue.length) return;

    processing = true;
    while (state.queue.length && state.enabled && !state.disableOnError) {
        const text = state.queue.shift();
        if (!text) continue;

        try {
            const result = await strategy.requestSpeech({
                text,
                voice: state.voice,
                rate: state.rate
            });

            if (!result) throw new Error('tts_missing_audio');
            state.lastSpokenText = text;
            state.currentCleanup = result.cleanup || null;

            if (typeof result.play === 'function') {
                state.currentStop = result.stop || null;
                await result.play();
            } else if (result.url) {
                await playAudioUrl(result.url);
            }

            if (state.currentCleanup) {
                state.currentCleanup();
                state.currentCleanup = null;
            }
        } catch (error) {
            dlog('tts request error', error);
            if (error?.status === 503) {
                state.disableOnError = true;
                setEnabled(false);
                if (ttsEnable) {
                    ttsEnable.disabled = true;
                    ttsEnable.title = 'Text-to-speech unavailable.';
                }
            }
            break;
        }
    }
    processing = false;
}
```

## Public Methods

### handleServerOutput(text)

**Purpose**: Processes server output for speech

**Parameters**:
- `text` (string): Server response text

**Implementation**:
```javascript
function handleServerOutput(text) {
    if (!state.enabled || state.disableOnError) return;
    enqueueSpeech(text);
}
```

### cancel()

**Purpose**: Cancels all TTS activity

**Implementation**:
```javascript
function cancel() {
    stopAll();
    if (typeof unsubscribeVoiceEvents === 'function') {
        try { unsubscribeVoiceEvents(); } catch (_) { }
    }
}
```

## Event Handlers

```javascript
if (ttsEnable) {
    ttsEnable.addEventListener('change', () => {
        setEnabled(ttsEnable.checked);
    });
}

if (ttsVoice) {
    ttsVoice.addEventListener('change', () => {
        state.voice = ttsVoice.value || null;
        persistVoice();
    });
}

if (ttsRate) {
    const handleRateChange = () => {
        const parsed = parseFloat(ttsRate.value);
        state.rate = clampRate(parsed);
        ttsRate.value = String(state.rate);
        updateRateLabel();
        persistRate();
    };
    ttsRate.addEventListener('input', handleRateChange);
    ttsRate.addEventListener('change', handleRateChange);
}
```

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `vc_tts_enabled` | TTS enabled state |
| `vc_tts_voice` | Selected voice |
| `vc_tts_rate` | Playback rate |

## Export

```javascript
export function initTextToSpeech(elements, options) { ... }
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-messages.md](./server-webchat-messages.md) - Message handling
- [server-webchat-strategies-tts.md](./strategies/server-webchat-strategies-tts.md) - TTS strategies

