# cli/server/webchat/strategies/tts/openai.js - OpenAI TTS Strategy

## Overview

Text-to-speech strategy using OpenAI TTS API via server proxy. Requests speech synthesis from server, receives base64-encoded audio, and plays via Audio element.

## Source File

`cli/server/webchat/strategies/tts/openai.js`

## Dependencies

```javascript
import { DEFAULT_VOICE, VOICE_OPTIONS } from './voices.js';
```

## Public API

### createOpenAITtsStrategy(options)

**Purpose**: Creates OpenAI TTS strategy instance

**Parameters**:
- `options` (Object):
  - `toEndpoint` (Function): Endpoint URL builder (required)
  - `dlog` (Function): Debug logger

**Returns**: (Object|null) TTS strategy or null if toEndpoint not provided

**Return Structure**:
```javascript
{
    id: 'openai',
    label: 'OpenAI',
    isSupported: true,
    getDefaultVoice: Function,
    getVoiceOptions: Function,
    requestSpeech: Function,
    cancel: Function
}
```

## Strategy Methods

### requestSpeech({ text, voice, rate })

**Purpose**: Requests speech synthesis from server

**Parameters**:
- `text` (string): Text to speak
- `voice` (string): Voice name
- `rate` (number): Playback speed

**Returns**: (Promise<SpeechResult>) Speech result with URL

**Implementation**:
```javascript
async function requestSpeech({ text, voice, rate }) {
    const payload = {
        text,
        voice: voice || DEFAULT_VOICE,
        speed: rate
    };
    const response = await fetch(toEndpoint('tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let details = '';
        try {
            const data = await response.json();
            details = data?.error || '';
        } catch (_) {
            details = await response.text();
        }
        const error = new Error(details || 'Text-to-speech request failed.');
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    if (!data?.audio) {
        throw new Error('Text-to-speech response missing audio payload.');
    }

    try {
        const bytes = base64ToUint8Array(data.audio);
        const mime = data.contentType || 'audio/mpeg';
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        return {
            url,
            mime,
            cleanup() {
                try {
                    URL.revokeObjectURL(url);
                } catch (_) {}
            }
        };
    } catch (error) {
        dlog('tts decode error', error);
        throw new Error('Failed to decode audio response.');
    }
}
```

### base64ToUint8Array(base64)

**Purpose**: Converts base64 string to Uint8Array

**Implementation**:
```javascript
function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
```

### getDefaultVoice()

**Purpose**: Returns default voice

**Returns**: (string) Default voice ('alloy')

### getVoiceOptions()

**Purpose**: Returns available voice options

**Returns**: (Promise<Array>) Voice options from voices.js

### cancel()

**Purpose**: No-op (server-side, no active playback to cancel)

## Server Endpoint

| Endpoint | Method | Content-Type |
|----------|--------|--------------|
| `/webchat/tts` | POST | application/json |

**Request Body**:
```json
{
    "text": "Text to speak",
    "voice": "alloy",
    "speed": 1.0
}
```

**Response**:
```json
{
    "audio": "base64-encoded-audio-data",
    "contentType": "audio/mpeg"
}
```

## Speech Result Interface

```javascript
{
    url: string,      // Blob URL for audio
    mime: string,     // MIME type
    cleanup: Function // Revokes blob URL
}
```

## Error Handling

| Condition | Error |
|-----------|-------|
| Response not OK | Error with details from response |
| Missing audio | "Text-to-speech response missing audio payload." |
| Decode failure | "Failed to decode audio response." |

Error objects include `status` property from HTTP response.

## Requirement

Returns `null` if `toEndpoint` function is not provided (OpenAI TTS requires server proxy for API key security).

## Export

```javascript
export { createOpenAITtsStrategy };
```

## Related Modules

- [server-webchat-strategies-tts-index.md](./server-webchat-strategies-tts-index.md) - TTS factory
- [server-webchat-strategies-tts-voices.md](./server-webchat-strategies-tts-voices.md) - Voice options
- [server-handlers-webchat.md](../../../handlers/server-handlers-webchat.md) - TTS endpoint

