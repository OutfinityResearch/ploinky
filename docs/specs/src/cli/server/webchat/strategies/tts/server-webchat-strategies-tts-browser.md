# cli/server/webchat/strategies/tts/browser.js - Browser Speech Synthesis

## Overview

Client-side text-to-speech using the Web Speech Synthesis API. Provides voice selection, rate control, and playback with promise-based completion handling.

## Source File

`cli/server/webchat/strategies/tts/browser.js`

## Constants

```javascript
const VOICE_CACHE_TTL_MS = 10_000;  // 10 second cache
const GOOGLE_EN_US_NAME = 'google us english';
```

## Internal Functions

### hasSpeechSynthesisSupport()

**Purpose**: Checks for Web Speech Synthesis API support

**Implementation**:
```javascript
function hasSpeechSynthesisSupport() {
    return typeof window !== 'undefined' &&
        typeof window.speechSynthesis !== 'undefined' &&
        typeof window.SpeechSynthesisUtterance === 'function';
}
```

### getSynth()

**Purpose**: Returns speechSynthesis instance if available

### waitForVoicesOnce(synth)

**Purpose**: Waits for voices to load (with timeout)

**Implementation**:
```javascript
function waitForVoicesOnce(synth) {
    return new Promise((resolve) => {
        let settled = false;

        const handle = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(synth.getVoices());
        };

        const failSafe = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(synth.getVoices());
        }, 750);

        function cleanup() {
            if (failSafe) clearTimeout(failSafe);
            if (typeof synth.removeEventListener === 'function') {
                synth.removeEventListener('voiceschanged', handle);
            } else {
                synth.onvoiceschanged = null;
            }
        }

        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', handle, { once: true });
        } else {
            synth.onvoiceschanged = handle;
        }

        synth.getVoices();  // Trigger load
    });
}
```

### normalizeVoiceLabel(voice)

**Purpose**: Creates display label for voice

**Implementation**:
```javascript
function normalizeVoiceLabel(voice) {
    const name = voice.name || voice.voiceURI || 'Voice';
    const locale = voice.lang ? ` (${voice.lang})` : '';
    const label = `${name}${locale}`;
    return label;
}
```

### selectPreferredVoice(voices)

**Purpose**: Selects default voice with preference chain

**Implementation**:
```javascript
function selectPreferredVoice(voices) {
    if (!Array.isArray(voices) || !voices.length) return null;

    const toToken = (voice) => (voice?.name || voice?.voiceURI || '').trim();

    // Priority 1: Exact "Google US English"
    const googleExact = voices.find((voice) =>
        (voice?.name || '').trim().toLowerCase() === GOOGLE_EN_US_NAME
    );
    if (googleExact) return toToken(googleExact);

    // Priority 2: Any Google en-US variant
    const googleEnVariant = voices.find((voice) => {
        const name = (voice?.name || '').toLowerCase();
        const lang = (voice?.lang || '').toLowerCase();
        return name.includes('google') && lang.startsWith('en-us');
    });
    if (googleEnVariant) return toToken(googleEnVariant);

    // Priority 3: Any en-US voice
    const enUsVoice = voices.find((voice) =>
        (voice?.lang || '').toLowerCase().startsWith('en-us')
    );
    if (enUsVoice) return toToken(enUsVoice);

    // Priority 4: Browser default
    const defaultVoice = voices.find((voice) => voice?.default);
    if (defaultVoice) return toToken(defaultVoice);

    // Fallback: First available
    return toToken(voices[0]) || null;
}
```

## Public API

### createBrowserTtsStrategy(options)

**Purpose**: Creates browser TTS strategy instance

**Parameters**:
- `options` (Object):
  - `dlog` (Function): Debug logger

**Returns**: (Object) TTS strategy

**Return Structure**:
```javascript
{
    id: 'browser',
    label: 'Browser',
    isSupported: boolean,
    getDefaultVoice: Function,
    getVoiceOptions: Function,
    onVoicesChanged: Function,
    requestSpeech: Function,
    cancel: Function
}
```

## Strategy Methods

### loadVoices()

**Purpose**: Loads and caches available voices

**Implementation**:
```javascript
async function loadVoices() {
    const now = Date.now();
    if ((now - lastVoiceCache.at) < VOICE_CACHE_TTL_MS && lastVoiceCache.voices.length) {
        return lastVoiceCache.voices;
    }
    let voices = synth.getVoices();
    if (!voices || !voices.length) {
        voices = await waitForVoicesOnce(synth);
    }
    if (!Array.isArray(voices)) voices = [];
    lastVoiceCache = { at: Date.now(), voices };
    return voices;
}
```

### resolveVoiceChoice(voiceName, voices)

**Purpose**: Resolves voice name to SpeechSynthesisVoice object

### subscribeToVoiceChanges(listener)

**Purpose**: Subscribes to voice list changes

**Returns**: (Function) Unsubscribe function

### getVoiceOptions()

**Purpose**: Returns available voice options

**Implementation**:
```javascript
async function getVoiceOptions() {
    const voices = await loadVoices();
    return voices.map((voice) => ({
        value: voice.name || voice.voiceURI,
        label: normalizeVoiceLabel(voice)
    }));
}
```

### requestSpeech({ text, voice, rate })

**Purpose**: Creates speech utterance

**Parameters**:
- `text` (string): Text to speak
- `voice` (string): Voice name/URI
- `rate` (number): Playback rate (0.5-2.0)

**Returns**: (Promise<SpeechResult>) Speech result

**Implementation**:
```javascript
async function requestSpeech({ text, voice, rate }) {
    if (!text) throw new Error('Missing text for speech synthesis.');

    const utterance = new window.SpeechSynthesisUtterance(text);
    const voices = await loadVoices();
    const chosen = resolveVoiceChoice(voice, voices);
    if (chosen) utterance.voice = chosen;
    if (Number.isFinite(rate) && rate > 0) {
        utterance.rate = Math.min(2, Math.max(0.5, rate));
    }

    return {
        async play() {
            return new Promise((resolve, reject) => {
                let settled = false;

                const handleEnd = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };

                const handleError = (event) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    const err = event?.error || event?.message || 'Speech synthesis failed.';
                    reject(new Error(err));
                };

                function cleanup() {
                    utterance.onend = null;
                    utterance.onerror = null;
                }

                utterance.onend = handleEnd;
                utterance.onerror = handleError;

                try {
                    synth.cancel();
                    synth.speak(utterance);
                } catch (error) {
                    cleanup();
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        },
        stop() {
            try { synth.cancel(); } catch (_) {}
        },
        cleanup() {}
    };
}
```

## Voice Selection Priority

1. Exact match "Google US English"
2. Any Google voice with en-US locale
3. Any voice with en-US locale
4. Browser default voice
5. First available voice

## Voice Cache

```javascript
let lastVoiceCache = {
    at: 0,          // Timestamp
    voices: []      // Cached voice list
};
```

TTL: 10 seconds to handle dynamic voice loading

## Unsupported Fallback

When Speech Synthesis is not available:

```javascript
{
    id: 'browser',
    label: 'Browser',
    isSupported: false,
    getDefaultVoice() { return null; },
    async getVoiceOptions() { return []; },
    async requestSpeech() {
        throw new Error('Speech synthesis not supported in this environment.');
    },
    cancel() {}
}
```

## Export

```javascript
export { createBrowserTtsStrategy };
```

## Related Modules

- [server-webchat-strategies-tts-index.md](./server-webchat-strategies-tts-index.md) - TTS factory
- [server-webchat-text-to-speech.md](../../server-webchat-text-to-speech.md) - TTS initialization

