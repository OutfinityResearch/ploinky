# cli/server/webchat/speechToText.js - WebChat Speech-to-Text

## Overview

Client-side speech-to-text initialization module for WebChat. Provides a factory function that initializes the appropriate STT strategy based on configuration. Supports multiple STT providers through a strategy pattern.

## Source File

`cli/server/webchat/speechToText.js`

## Dependencies

```javascript
import { createSttInitializer } from './strategies/stt/index.js';
```

## Public API

### initSpeechToText(elements, options)

**Purpose**: Initializes speech-to-text functionality

**Parameters**:
- `elements` (Object): DOM elements for STT UI (see strategies)
- `options` (Object):
  - `provider` (string): STT provider name
  - Additional strategy-specific options

**Returns**: (Object) STT API

**Return Structure (Success)**:
```javascript
{
    isSupported: boolean,
    resetTranscriptState: Function,
    stop: Function,
    // Strategy-specific methods
}
```

**Return Structure (Error/Unsupported)**:
```javascript
{
    isSupported: false,
    resetTranscriptState: () => {},
    stop: () => {}
}
```

**Implementation**:
```javascript
export function initSpeechToText(elements = {}, options = {}) {
    const initializer = createSttInitializer({ provider: options.provider });
    try {
        return initializer(elements, options);
    } catch (error) {
        console.error('[webchat] stt initialization error:', error);
        return {
            isSupported: false,
            resetTranscriptState: () => {},
            stop: () => {}
        };
    }
}
```

## Strategy Selection

The `createSttInitializer` function selects the appropriate STT strategy based on the provider option. Available strategies are defined in `./strategies/stt/index.js`.

## Common Element Parameters

Elements typically passed to STT initialization:

| Element | Purpose |
|---------|---------|
| `sttBtn` | Microphone button |
| `sttStatus` | Status indicator |
| `sttLang` | Language selector |
| `sttEnable` | Enable checkbox |
| `settingsBtn` | Settings button |
| `settingsPanel` | Settings panel |

## Common Option Parameters

Options typically passed to STT initialization:

| Option | Type | Description |
|--------|------|-------------|
| `composer` | Object | Composer module for text insertion |
| `purgeTriggerRe` | RegExp | Pattern to trigger purge |
| `sendTriggerRe` | RegExp | Pattern to trigger send |
| `dlog` | Function | Debug logger |
| `provider` | string | STT provider identifier |

## Export

```javascript
export function initSpeechToText(elements, options) { ... }
```

## Usage Example

```javascript
import { initSpeechToText } from './speechToText.js';

const stt = initSpeechToText({
    sttBtn: document.getElementById('sttBtn'),
    sttStatus: document.getElementById('sttStatus'),
    sttLang: document.getElementById('sttLang'),
    sttEnable: document.getElementById('sttEnable'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel')
}, {
    composer,
    purgeTriggerRe: /\bpurge\b/i,
    sendTriggerRe: /\bsend\b/i,
    dlog: (...args) => console.log('[stt]', ...args),
    provider: 'webspeech'
});

if (stt.isSupported) {
    console.log('Speech-to-text is available');
}

// Reset transcript state
stt.resetTranscriptState();

// Stop listening
stt.stop();
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-composer.md](./server-webchat-composer.md) - Text composition
- [server-webchat-strategies-stt.md](./strategies/server-webchat-strategies-stt.md) - STT strategies

