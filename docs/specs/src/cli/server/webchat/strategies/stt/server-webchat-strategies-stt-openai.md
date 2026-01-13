# cli/server/webchat/strategies/stt/openai.js - OpenAI Whisper STT

## Overview

Client-side speech-to-text using OpenAI Whisper API. Records audio in the browser using MediaRecorder, then sends to server for transcription. Supports multiple languages and provides push-to-talk recording.

## Source File

`cli/server/webchat/strategies/stt/openai.js`

## Constants

```javascript
const STT_ENABLED_KEY = 'vc_openai_stt_enabled';
const STT_LANG_KEY = 'vc_openai_stt_lang';
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

### initOpenAISpeechToText(elements, options)

**Purpose**: Initializes OpenAI Whisper-based speech recognition

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

**Return Structure**:
```javascript
{
    isSupported: boolean,
    resetTranscriptState: Function,
    stop: Function
}
```

## Module State

```javascript
let mediaRecorder = null;       // MediaRecorder instance
let audioChunks = [];           // Recorded audio chunks
let isRecording = false;        // Recording state
let mediaStream = null;         // Media stream
let transcriptBuffer = '';      // Accumulated transcript
let isEnabled = true;           // STT enabled (default on first use)
let sttLanguage = 'en';         // Selected language
```

## Support Detection

```javascript
const isSupported = typeof MediaRecorder !== 'undefined' &&
    typeof navigator?.mediaDevices?.getUserMedia === 'function';
```

## Key Functions

### sendAudioForTranscription(audioBlob)

**Purpose**: Sends recorded audio to server for Whisper transcription

**Implementation**:
```javascript
async function sendAudioForTranscription(audioBlob) {
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        formData.append('language', sttLanguage);

        const url = toEndpoint ? toEndpoint('/stt') : '/webchat/stt';

        updateVoiceStatus('Transcribing...');
        dlog('[stt] Sending audio for transcription');

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Transcription failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.text) {
            const normalizedText = normalizeWhitespace(data.text);
            transcriptBuffer = normalizedText;
            appendVoiceText(normalizedText);

            // Check for send trigger
            if (sendTriggerRe && sendTriggerRe.test(normalizedText)) {
                if (composer && typeof composer.sendMessage === 'function') {
                    composer.sendMessage();
                }
                resetTranscriptState();
            }

            updateVoiceStatus('Ready');
        }
    } catch (error) {
        dlog('[stt] Transcription error:', error);
        updateVoiceStatus(`Error: ${error.message}`);
    }
}
```

### startRecording()

**Purpose**: Starts audio recording from microphone

**Implementation**:
```javascript
async function startRecording() {
    if (isRecording || !isSupported) return;

    try {
        updateVoiceStatus('Requesting mic...');

        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // Select codec
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }

        audioChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                await sendAudioForTranscription(audioBlob);
            }

            // Cleanup
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
                mediaStream = null;
            }

            audioChunks = [];
            isRecording = false;
            setMicVisual(false);
        };

        mediaRecorder.onerror = (event) => {
            dlog('[stt] MediaRecorder error:', event.error);
            updateVoiceStatus('Recording error');
            stopRecording();
        };

        mediaRecorder.start();
        isRecording = true;
        setMicVisual(true);
        updateVoiceStatus('Recording...');
    } catch (error) {
        dlog('[stt] Error starting recording:', error);
        updateVoiceStatus('Mic access denied');

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        isRecording = false;
        setMicVisual(false);
    }
}
```

### stopRecording()

**Purpose**: Stops current recording

**Implementation**:
```javascript
function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}
```

### toggleRecording()

**Purpose**: Toggles recording state or enables STT

## Audio Configuration

| Option | Value |
|--------|-------|
| `channelCount` | 1 (mono) |
| `sampleRate` | 16000 Hz |
| `echoCancellation` | true |
| `noiseSuppression` | true |

## Supported MIME Types

| Priority | MIME Type |
|----------|-----------|
| 1 | `audio/webm;codecs=opus` |
| 2 | `audio/webm` |

## Supported Languages

```javascript
const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'nl', name: 'Dutch' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' }
];
```

## Server Endpoint

| Endpoint | Method | Content-Type |
|----------|--------|--------------|
| `/webchat/stt` | POST | multipart/form-data |

**Request FormData**:
- `audio`: Blob (recording.webm)
- `language`: string (language code)

**Response**:
```json
{
    "text": "transcribed text"
}
```

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `vc_openai_stt_enabled` | STT enabled state |
| `vc_openai_stt_lang` | Selected language |

## Export

```javascript
export { initOpenAISpeechToText };
```

## Related Modules

- [server-webchat-strategies-stt-index.md](./server-webchat-strategies-stt-index.md) - STT factory
- [server-handlers-webchat.md](../../../handlers/server-handlers-webchat.md) - Server STT handler

