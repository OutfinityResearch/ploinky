# cli/server/webchat/strategies/tts/index.js - TTS Strategy Factory

## Overview

Factory module for text-to-speech strategies. Provides provider selection with fallback chain from specified provider to browser to OpenAI.

## Source File

`cli/server/webchat/strategies/tts/index.js`

## Dependencies

```javascript
import { createBrowserTtsStrategy } from './browser.js';
import { createOpenAITtsStrategy } from './openai.js';
import { createNoopTtsStrategy } from './noop.js';
```

## Constants

```javascript
const KNOWN_PROVIDERS = new Map([
    ['browser', createBrowserTtsStrategy],
    ['openai', createOpenAITtsStrategy],
    ['none', () => createNoopTtsStrategy()]
]);
```

## Public API

### createTtsStrategy(options)

**Purpose**: Creates TTS strategy for specified provider with fallback

**Parameters**:
- `options` (Object):
  - `provider` (string): Provider name
  - `toEndpoint` (Function): Endpoint URL builder
  - `dlog` (Function): Debug logger

**Returns**: (Object) TTS strategy instance

**Implementation**:
```javascript
export function createTtsStrategy({ provider, toEndpoint, dlog } = {}) {
    const normalized = (provider || '').trim().toLowerCase();

    if (normalized === 'none') {
        return createNoopTtsStrategy();
    }

    const attempts = [];
    if (normalized) {
        attempts.push(normalized);
    }
    if (!attempts.includes('browser')) {
        attempts.push('browser');
    }
    if (!attempts.includes('openai')) {
        attempts.push('openai');
    }

    for (const key of attempts) {
        const factory = KNOWN_PROVIDERS.get(key);
        if (!factory) continue;
        const strategy = factory({ toEndpoint, dlog });
        if (strategy && strategy.isSupported !== false) {
            return strategy;
        }
    }

    return createNoopTtsStrategy();
}
```

### listAvailableTtsProviders()

**Purpose**: Lists available TTS provider names

**Returns**: (string[]) Provider names

**Implementation**:
```javascript
export function listAvailableTtsProviders() {
    return Array.from(KNOWN_PROVIDERS.keys());
}
```

## Provider Selection Logic

```
┌─────────────────────────────────────────────────────┐
│            TTS Provider Selection                   │
├─────────────────────────────────────────────────────┤
│  1. If provider is 'none':                          │
│     └── Return noop strategy                        │
│                                                     │
│  2. Build fallback chain:                           │
│     [specified] → [browser] → [openai]              │
│                                                     │
│  3. Try each in order:                              │
│     ├── Create strategy with factory                │
│     ├── If isSupported !== false → return           │
│     └── Continue to next                            │
│                                                     │
│  4. Final fallback:                                 │
│     └── Return noop strategy                        │
└─────────────────────────────────────────────────────┘
```

## Available Providers

| Provider | Description |
|----------|-------------|
| `browser` | Web Speech Synthesis API |
| `openai` | OpenAI TTS API via server |
| `none` | Disabled/noop |

## TTS Strategy Interface

All strategies implement:

```javascript
{
    id: string,                    // Provider identifier
    label: string,                 // Display name
    isSupported: boolean,          // Support status
    getDefaultVoice(): string,     // Default voice token
    getVoiceOptions(): Promise<Array<{value, label}>>,  // Available voices
    requestSpeech({ text, voice, rate }): Promise<SpeechResult>,
    cancel(): void                 // Cancel playback
}
```

## Exports

```javascript
export { createTtsStrategy, listAvailableTtsProviders };
```

## Usage Example

```javascript
import { createTtsStrategy, listAvailableTtsProviders } from './strategies/tts/index.js';

// List available providers
const providers = listAvailableTtsProviders();
console.log(providers);  // ['browser', 'openai', 'none']

// Create strategy with browser preference
const strategy = createTtsStrategy({
    provider: 'browser',
    toEndpoint: (path) => `/webchat${path}`,
    dlog: console.debug
});

// Use strategy
const voices = await strategy.getVoiceOptions();
const result = await strategy.requestSpeech({
    text: 'Hello world',
    voice: 'Google US English',
    rate: 1.0
});
await result.play();
```

## Related Modules

- [server-webchat-strategies-tts-browser.md](./server-webchat-strategies-tts-browser.md) - Browser TTS
- [server-webchat-strategies-tts-openai.md](./server-webchat-strategies-tts-openai.md) - OpenAI TTS
- [server-webchat-strategies-tts-noop.md](./server-webchat-strategies-tts-noop.md) - Noop TTS
- [server-webchat-text-to-speech.md](../../server-webchat-text-to-speech.md) - TTS initialization

