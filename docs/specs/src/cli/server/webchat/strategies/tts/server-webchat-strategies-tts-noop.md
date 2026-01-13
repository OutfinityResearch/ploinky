# cli/server/webchat/strategies/tts/noop.js - Noop TTS Strategy

## Overview

No-operation text-to-speech strategy. Returns disabled stub implementation when TTS is not available or explicitly disabled.

## Source File

`cli/server/webchat/strategies/tts/noop.js`

## Public API

### createNoopTtsStrategy()

**Purpose**: Creates disabled TTS strategy instance

**Returns**: (Object) Stub TTS strategy

**Implementation**:
```javascript
export function createNoopTtsStrategy() {
    return {
        id: 'none',
        label: 'Disabled',
        isSupported: false,
        getDefaultVoice() {
            return null;
        },
        async getVoiceOptions() {
            return [];
        },
        async requestSpeech() {
            throw new Error('Text-to-speech is not available.');
        },
        cancel() {}
    };
}
```

## Strategy Interface

| Property/Method | Value/Behavior |
|-----------------|----------------|
| `id` | 'none' |
| `label` | 'Disabled' |
| `isSupported` | false |
| `getDefaultVoice()` | returns null |
| `getVoiceOptions()` | returns empty array |
| `requestSpeech()` | throws Error |
| `cancel()` | no-op |

## Error Message

When `requestSpeech()` is called:
```
"Text-to-speech is not available."
```

## Export

```javascript
export { createNoopTtsStrategy };
```

## Usage

The noop strategy is used when:
1. Provider is explicitly set to 'none'
2. No supported providers are available
3. TTS is disabled by configuration
4. Final fallback in provider selection chain

## Related Modules

- [server-webchat-strategies-tts-index.md](./server-webchat-strategies-tts-index.md) - TTS factory

