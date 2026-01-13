# cli/server/webchat/strategies/stt/index.js - STT Strategy Factory

## Overview

Factory module for speech-to-text strategies. Provides provider selection with fallback to browser-based speech recognition.

## Source File

`cli/server/webchat/strategies/stt/index.js`

## Dependencies

```javascript
import { initBrowserSpeechToText } from './browser.js';
import { initNoopSpeechToText } from './noop.js';
```

## Constants

```javascript
const PROVIDERS = new Map([
    ['browser', initBrowserSpeechToText],
    ['none', initNoopSpeechToText]
]);
```

## Public API

### createSttInitializer(options)

**Purpose**: Creates STT initializer for specified provider

**Parameters**:
- `options` (Object):
  - `provider` (string): Provider name ('browser', 'none')

**Returns**: (Function) STT initializer function

**Implementation**:
```javascript
export function createSttInitializer({ provider } = {}) {
    const normalized = (provider || '').trim().toLowerCase();
    if (normalized && PROVIDERS.has(normalized)) {
        return PROVIDERS.get(normalized);
    }
    const initializer = PROVIDERS.get('browser') || initNoopSpeechToText;
    return initializer;
}
```

### listAvailableSttProviders()

**Purpose**: Lists available STT provider names

**Returns**: (string[]) Provider names

**Implementation**:
```javascript
export function listAvailableSttProviders() {
    return Array.from(PROVIDERS.keys());
}
```

## Provider Selection Logic

```
┌─────────────────────────────────────────────────────┐
│            STT Provider Selection                   │
├─────────────────────────────────────────────────────┤
│  1. Check if provider specified and valid           │
│     ├── If valid → Return provider initializer      │
│                                                     │
│  2. Fallback chain:                                 │
│     ├── Try 'browser' provider                      │
│     └── Final fallback to 'noop' provider           │
└─────────────────────────────────────────────────────┘
```

## Available Providers

| Provider | Description |
|----------|-------------|
| `browser` | Web Speech API (default) |
| `none` | Disabled/noop |

## Exports

```javascript
export { createSttInitializer, listAvailableSttProviders };
```

## Usage Example

```javascript
import { createSttInitializer, listAvailableSttProviders } from './strategies/stt/index.js';

// List available providers
const providers = listAvailableSttProviders();
console.log(providers);  // ['browser', 'none']

// Get initializer for browser STT
const initStt = createSttInitializer({ provider: 'browser' });

// Initialize with DOM elements
const stt = initStt({
    sttBtn: document.getElementById('micBtn'),
    sttStatus: document.getElementById('sttStatus'),
    sttLang: document.getElementById('langSelect'),
    sttEnable: document.getElementById('sttEnable')
}, {
    composer,
    dlog: console.debug
});
```

## Related Modules

- [server-webchat-strategies-stt-browser.md](./server-webchat-strategies-stt-browser.md) - Browser STT
- [server-webchat-strategies-stt-noop.md](./server-webchat-strategies-stt-noop.md) - Noop STT
- [server-webchat-speech-to-text.md](../../server-webchat-speech-to-text.md) - STT initialization

