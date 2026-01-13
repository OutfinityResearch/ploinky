# cli/server/webchat/strategies/stt/openai-realtime.js - OpenAI Realtime STT

## Overview

Client-side real-time speech-to-text using OpenAI Realtime API. Streams audio via WebSocket for instant transcription with server-side VAD (Voice Activity Detection). Uses ephemeral tokens for secure direct connection to OpenAI.

## Source File

`cli/server/webchat/strategies/stt/openai-realtime.js`

## Constants

```javascript
const STT_ENABLED_KEY = 'vc_realtime_stt_enabled';
const STT_LANG_KEY = 'vc_realtime_stt_lang';
const MAX_RECONNECT_ATTEMPTS = 3;
```

## Internal Functions

### normalizeWhitespace(str)

**Purpose**: Normalizes whitespace in transcript

**Implementation**:
```javascript
function normalizeWhitespace(str) {
    return str.replace(/\s+/g, ' ').trim();
}
```

## Public API

### initRealtimeSpeechToText(elements, options)

**Purpose**: Initializes OpenAI Realtime API-based speech recognition

**Parameters**:
- `elements` (Object):
  - `sttBtn` (HTMLButtonElement): Microphone button
  - `sttStatus` (HTMLElement): Status display
  - `sttLang` (HTMLSelectElement): Language selector
  - `sttEnable` (HTMLInputElement): Enable checkbox
- `options` (Object):
  - `composer` (Object): Message composer instance
  - `purgeTriggerRe` (RegExp): Regex for purge command
  - `sendTriggerRe` (RegExp): Regex for send command
  - `toEndpoint` (Function): Endpoint URL builder
  - `dlog` (Function): Debug logger

**Returns**: (Object) STT control API

## Module State

```javascript
let ws = null;                  // WebSocket connection
let mediaRecorder = null;       // Not used in realtime mode
let audioContext = null;        // AudioContext for processing
let audioWorkletNode = null;    // ScriptProcessor node
let mediaStream = null;         // Microphone stream
let isRecording = false;        // Recording state
let isEnabled = true;           // STT enabled
let sttLanguage = 'en';         // Selected language
let currentTranscript = '';     // Current transcript
let transcriptBuffer = '';      // Accumulated transcript
let reconnectAttempts = 0;      // Reconnect counter
let sessionId = null;           // OpenAI session ID
```

## Support Detection

```javascript
const isSupported = typeof MediaRecorder !== 'undefined' &&
    typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
    typeof WebSocket !== 'undefined';
```

## Key Functions

### connectWebSocket()

**Purpose**: Establishes WebSocket connection to OpenAI Realtime API

**Implementation**:
```javascript
async function connectWebSocket() {
    return new Promise(async (resolve, reject) => {
        try {
            // Request ephemeral token from server
            const tokenUrl = toEndpoint ? toEndpoint('/realtime-token') : '/webchat/realtime-token';

            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to get session token');
            }

            const tokenData = await tokenResponse.json();
            const ephemeralKey = tokenData.client_secret.value;

            // Connect to OpenAI with ephemeral token
            const model = 'gpt-4o-realtime-preview-2024-10-01';
            const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

            ws = new WebSocket(wsUrl, ['realtime', `openai-insecure-api-key.${ephemeralKey}`]);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                reconnectAttempts = 0;
                resolve();
            };

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                handleRealtimeMessage(message);
            };

            ws.onerror = (error) => {
                updateVoiceStatus('Connection error');
                reject(error);
            };

            ws.onclose = () => {
                if (isRecording) {
                    updateVoiceStatus('Disconnected');
                    stopRecording();
                }
                ws = null;
            };
        } catch (error) {
            reject(error);
        }
    });
}
```

### handleRealtimeMessage(message)

**Purpose**: Processes OpenAI Realtime API events

**Implementation** (embedded in onmessage):
```javascript
// Session created - configure session
if (message.type === 'session.created') {
    sessionId = message.session?.id || null;
    ws.send(JSON.stringify({
        type: 'session.update',
        session: {
            type: 'realtime',
            instructions: 'You are a transcription assistant. Only transcribe what the user says.',
            input_audio_transcription: {
                model: 'gpt-4o-mini-transcribe'
            },
            turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
            }
        }
    }));
}

// Transcription completed
if (message.type === 'conversation.item.input_audio_transcription.completed') {
    const text = normalizeWhitespace(message.transcript || '');
    if (text) {
        transcriptBuffer += (transcriptBuffer ? ' ' : '') + text;
        currentTranscript = transcriptBuffer;
        appendVoiceText(text, false);

        // Check for send trigger
        if (sendTriggerRe && sendTriggerRe.test(text)) {
            if (composer && typeof composer.sendMessage === 'function') {
                composer.sendMessage();
            }
            resetTranscriptState();
        }
    }
}

// Speech detected
if (message.type === 'input_audio_buffer.speech_started') {
    updateVoiceStatus('Listening...');
}

// Speech ended - commit buffer
if (message.type === 'input_audio_buffer.speech_stopped') {
    updateVoiceStatus('Processing...');
    ws.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
    }));
}
```

### startRecording()

**Purpose**: Starts real-time audio streaming

**Implementation**:
```javascript
async function startRecording() {
    if (isRecording || !isSupported) return;

    try {
        updateVoiceStatus('Connecting...');

        // Connect WebSocket
        await connectWebSocket();

        // Get microphone access
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 24000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Create AudioContext for processing
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 24000
        });
        const source = audioContext.createMediaStreamSource(mediaStream);

        // Create ScriptProcessor for audio chunks
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

        processor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);

                // Convert Float32Array to Int16Array (PCM16)
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Send as base64
                const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(pcm16.buffer)));
                ws.send(JSON.stringify({
                    type: 'input_audio_buffer.append',
                    audio: base64
                }));
            }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        audioWorkletNode = processor;

        isRecording = true;
        setMicVisual(true);
        updateVoiceStatus('Listening... (speak naturally)');
    } catch (error) {
        if (error.name === 'NotAllowedError') {
            updateVoiceStatus('Mic access denied');
        } else {
            updateVoiceStatus('Failed to start');
        }
        stopRecording();
    }
}
```

### stopRecording()

**Purpose**: Stops real-time streaming and cleanup

**Implementation**:
```javascript
function stopRecording() {
    if (!isRecording) return;

    // Close WebSocket
    if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stop' }));
        }
        ws.close();
        ws = null;
    }
    sessionId = null;

    // Stop audio processing
    if (audioWorkletNode) {
        audioWorkletNode.disconnect();
        audioWorkletNode = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    isRecording = false;
    setMicVisual(false);
    updateVoiceStatus('Ready (Real-time)');
}
```

## Audio Configuration

| Option | Value |
|--------|-------|
| `channelCount` | 1 (mono) |
| `sampleRate` | 24000 Hz |
| `echoCancellation` | true |
| `noiseSuppression` | true |
| `autoGainControl` | true |

## OpenAI Realtime API Events

| Event Type | Direction | Description |
|------------|-----------|-------------|
| `session.created` | receive | Session established |
| `session.update` | send | Configure session |
| `session.updated` | receive | Configuration confirmed |
| `input_audio_buffer.append` | send | Stream audio chunk |
| `input_audio_buffer.commit` | send | Request transcription |
| `input_audio_buffer.speech_started` | receive | VAD detected speech |
| `input_audio_buffer.speech_stopped` | receive | VAD detected silence |
| `conversation.item.input_audio_transcription.completed` | receive | Final transcript |
| `conversation.item.input_audio_transcription.failed` | receive | Transcription error |
| `error` | receive | API error |

## Session Configuration

```javascript
{
    type: 'realtime',
    instructions: 'You are a transcription assistant. Only transcribe what the user says.',
    input_audio_transcription: {
        model: 'gpt-4o-mini-transcribe'
    },
    turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
    }
}
```

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webchat/realtime-token` | POST | Get ephemeral token |

## WebSocket Protocol

- URL: `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`
- Subprotocols: `['realtime', 'openai-insecure-api-key.{ephemeralKey}']`
- Binary type: `arraybuffer`

## Audio Format

- PCM16 (signed 16-bit integers)
- Base64 encoded for JSON transport
- Sample rate: 24000 Hz
- Mono channel

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `vc_realtime_stt_enabled` | STT enabled state |
| `vc_realtime_stt_lang` | Selected language |

## Export

```javascript
export { initRealtimeSpeechToText };
```

## Related Modules

- [server-webchat-strategies-stt-index.md](./server-webchat-strategies-stt-index.md) - STT factory
- [server-handlers-webchat.md](../../../handlers/server-handlers-webchat.md) - Token endpoint

