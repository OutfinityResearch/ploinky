# cli/server/webchat/strategies/stt/browser.js - Browser Speech Recognition

## Overview

Client-side speech-to-text using the Web Speech API (SpeechRecognition). Provides continuous voice recognition with transcript accumulation, voice triggers for send/purge, language selection, and microphone visual feedback.

## Source File

`cli/server/webchat/strategies/stt/browser.js`

## Internal Functions

### normalizeWhitespace(str)

**Purpose**: Normalizes whitespace in transcript text

**Parameters**:
- `str` (string): Input string

**Returns**: (string) Normalized string

**Implementation**:
```javascript
function normalizeWhitespace(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
}
```

## Public API

### initBrowserSpeechToText(elements, options)

**Purpose**: Initializes browser-based speech recognition

**Parameters**:
- `elements` (Object):
  - `sttBtn` (HTMLButtonElement): Microphone button
  - `sttStatus` (HTMLElement): Status display
  - `sttLang` (HTMLSelectElement): Language selector
  - `sttEnable` (HTMLInputElement): Enable checkbox
  - `settingsBtn` (HTMLButtonElement): Settings toggle
  - `settingsPanel` (HTMLElement): Settings panel
- `options` (Object):
  - `composer` (Object): Message composer instance
  - `purgeTriggerRe` (RegExp): Regex for purge command
  - `sendTriggerRe` (RegExp): Regex for send command
  - `dlog` (Function): Debug logger

**Returns**: (Object) STT control API

**Return Structure**:
```javascript
{
    isSupported: boolean,       // Browser supports STT
    resetTranscriptState: Function,  // Clear transcript buffer
    stop: Function              // Stop recognition
}
```

## Module State

```javascript
let sttRecognition = null;      // SpeechRecognition instance
let sttListening = false;       // Currently listening
let sttActive = false;          // STT enabled by user
let sttLangCode = 'en-GB';      // Selected language
let finalSegments = [];         // Accumulated final transcripts
let interimTranscript = '';     // Current interim transcript
let sttAppliedTranscript = '';  // Last applied to composer
```

## Key Functions

### updateVoiceStatus(text)

**Purpose**: Updates status display element

### setMicVisual(active)

**Purpose**: Updates microphone button visual state

**Implementation**:
```javascript
function setMicVisual(active) {
    if (!sttBtn) return;
    sttBtn.classList.toggle('active', active);
    sttBtn.classList.toggle('muted', !active);
    sttBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
}
```

### resetTranscriptState()

**Purpose**: Clears transcript accumulation buffers

### updateComposerFromVoice()

**Purpose**: Syncs accumulated transcript to composer

**Implementation**:
```javascript
function updateComposerFromVoice() {
    const combined = normalizeWhitespace(finalSegments.join(' '));
    if (!combined || combined === sttAppliedTranscript) return;
    const addition = combined.slice(sttAppliedTranscript.length);
    if (!addition.trim()) {
        sttAppliedTranscript = combined;
        return;
    }
    appendVoiceText(addition);
    sttAppliedTranscript = combined;
}
```

### handleVoiceSend(rawJoined)

**Purpose**: Processes send trigger from voice

**Implementation**:
```javascript
function handleVoiceSend(rawJoined) {
    const cleaned = normalizeWhitespace((rawJoined || '').replace(/\bsend\b/gi, ' '));
    if (!composer) {
        resetTranscriptState();
        return;
    }
    composer.setValue(cleaned);
    if (cleaned) {
        composer.submit();
    } else {
        composer.clear();
    }
    resetTranscriptState();
}
```

### startRecognition()

**Purpose**: Starts speech recognition session

**Implementation**:
```javascript
function startRecognition() {
    if (!sttSupported || !sttEnable?.checked || !sttActive || sttListening) return;

    resetTranscriptState();

    sttRecognition = new SpeechRecognitionClass();
    sttRecognition.lang = sttLang?.value || sttLangCode || 'en-GB';
    sttRecognition.continuous = true;
    sttRecognition.interimResults = true;

    sttRecognition.onresult = (event) => {
        interimTranscript = '';
        let triggered = false;
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = (result[0]?.transcript || '').trim();
            if (!transcript) continue;

            if (result.isFinal) {
                finalSegments.push(transcript);
                const joined = finalSegments.join(' ');
                if (purgeTriggerRe?.test?.(joined)) {
                    triggered = true;
                    handleVoicePurge();
                    break;
                }
                if (sendTriggerRe?.test?.(joined)) {
                    triggered = true;
                    handleVoiceSend(joined);
                    break;
                }
            } else {
                interimTranscript = interimTranscript
                    ? `${interimTranscript} ${transcript}`
                    : transcript;
            }
        }
        if (!triggered) updateComposerFromVoice();
    };

    sttRecognition.onerror = (event) => {
        const err = event?.error || 'unknown';
        const fatal = err === 'not-allowed' || err === 'service-not-allowed';
        sttListening = false;
        if (fatal) {
            sttActive = false;
            updateVoiceStatus('Permission denied');
            setMicVisual(false);
            stopRecognition();
        } else {
            updateVoiceStatus(`Error: ${err}`);
        }
    };

    sttRecognition.onend = () => {
        sttListening = false;
        if (sttActive && sttEnable?.checked) {
            setTimeout(() => {
                if (!sttListening && sttActive && sttEnable?.checked) {
                    startRecognition();
                }
            }, 200);
        } else {
            updateVoiceStatus(sttEnable?.checked ? 'Paused' : 'Muted');
        }
        setMicVisual(sttActive && sttEnable?.checked);
    };

    sttRecognition.start();
    sttListening = true;
    updateVoiceStatus('Listening…');
    setMicVisual(true);
}
```

### stopRecognition()

**Purpose**: Stops current recognition session

### applyEnableState(checked)

**Purpose**: Applies enable/disable state change

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `vc_stt_lang` | Selected language code |
| `vc_stt_enabled` | STT enabled state |

## Language Population

**Implementation**:
```javascript
function fillLangs() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const list = voices.map((voice) => voice.lang).filter(Boolean);
    const common = [
        'en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES',
        'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR',
        'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'
    ];
    const langs = Array.from(new Set([...list, ...common])).sort();
    // Populate select element
}
```

## Event Handlers

| Element | Event | Action |
|---------|-------|--------|
| `sttLang` | change | Update language, restart recognition |
| `sttEnable` | change | Toggle STT active state |
| `sttBtn` | click | Toggle listening |
| `settingsBtn` | click | Toggle settings panel |

## SpeechRecognition Options

| Option | Value |
|--------|-------|
| `lang` | User selected (default: 'en-GB') |
| `continuous` | true |
| `interimResults` | true |

## Error Handling

| Error | Handling |
|-------|----------|
| `not-allowed` | Disable STT, show permission denied |
| `service-not-allowed` | Disable STT, show permission denied |
| Other errors | Show error message, continue |

## Export

```javascript
export { initBrowserSpeechToText };
```

## Related Modules

- [server-webchat-strategies-stt-index.md](./server-webchat-strategies-stt-index.md) - STT factory
- [server-webchat-composer.md](../../server-webchat-composer.md) - Composer integration

