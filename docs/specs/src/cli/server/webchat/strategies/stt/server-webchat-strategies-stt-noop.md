# cli/server/webchat/strategies/stt/noop.js - Noop STT Strategy

## Overview

No-operation speech-to-text strategy. Disables all STT controls and returns a stub API. Used when STT is not available or explicitly disabled.

## Source File

`cli/server/webchat/strategies/stt/noop.js`

## Public API

### initNoopSpeechToText(elements)

**Purpose**: Initializes disabled STT state

**Parameters**:
- `elements` (Object):
  - `sttBtn` (HTMLButtonElement): Microphone button
  - `sttStatus` (HTMLElement): Status display
  - `sttEnable` (HTMLInputElement): Enable checkbox

**Returns**: (Object) Stub STT API

**Return Structure**:
```javascript
{
    isSupported: false,
    resetTranscriptState: Function,  // No-op
    stop: Function                   // No-op
}
```

**Implementation**:
```javascript
export function initNoopSpeechToText(elements = {}) {
    const {
        sttBtn,
        sttStatus,
        sttEnable
    } = elements;

    if (sttEnable) {
        sttEnable.checked = false;
        sttEnable.disabled = true;
    }
    if (sttBtn) {
        sttBtn.disabled = true;
        sttBtn.setAttribute('aria-disabled', 'true');
    }
    if (sttStatus) {
        sttStatus.textContent = 'Unavailable';
    }

    return {
        isSupported: false,
        resetTranscriptState: () => {},
        stop: () => {}
    };
}
```

## Element State

| Element | State |
|---------|-------|
| `sttEnable` | Unchecked, disabled |
| `sttBtn` | Disabled, aria-disabled=true |
| `sttStatus` | "Unavailable" |

## Export

```javascript
export { initNoopSpeechToText };
```

## Usage

The noop strategy is used when:
1. Provider is explicitly set to 'none'
2. No supported providers are available
3. STT is disabled by configuration

## Related Modules

- [server-webchat-strategies-stt-index.md](./server-webchat-strategies-stt-index.md) - STT factory

