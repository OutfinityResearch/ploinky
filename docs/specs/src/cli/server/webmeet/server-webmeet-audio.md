# cli/server/webmeet/audio.js - WebMeet Audio Service

## Overview

Client-side audio service for WebMeet. Provides text-to-speech synthesis using Web Speech API with language persistence and TTS button creation.

## Source File

`cli/server/webmeet/audio.js`

## Service Object

```javascript
const AudioService = {
    sttLang: localStorage.getItem('vc_stt_lang') || 'en-GB',

    init() {
        /* no-op, kept for backward compatibility */
    },

    speak(text, language) {
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = language || this.sttLang || 'en-GB';
            speechSynthesis.speak(utterance);
        } catch(e) {
            console.error('TTS error:', e);
        }
    },

    getCurrentLanguage() {
        return this.sttLang || 'en-GB';
    },

    createTTSButton(text) {
        const btn = document.createElement('button');
        btn.className = 'wa-tts-btn';
        btn.title = 'Read aloud';
        btn.innerHTML = '🔈';
        btn.onclick = () => {
            this.speak(text, this.getCurrentLanguage());
        };
        return btn;
    }
};
```

## Public API

### init()

**Purpose**: Initialization hook (no-op for backward compatibility)

### speak(text, language)

**Purpose**: Synthesizes speech from text

**Parameters**:
- `text` (string): Text to speak
- `language` (string): BCP-47 language code (default: stored language)

### getCurrentLanguage()

**Purpose**: Returns current language preference

**Returns**: (string) Language code (default: 'en-GB')

### createTTSButton(text)

**Purpose**: Creates TTS button element

**Parameters**:
- `text` (string): Text to speak on click

**Returns**: (HTMLButtonElement) TTS button

## LocalStorage

| Key | Description |
|-----|-------------|
| `vc_stt_lang` | Language preference |

## Button HTML Structure

```html
<button class="wa-tts-btn" title="Read aloud">🔈</button>
```

## Global Export

```javascript
window.webMeetAudio = AudioService;
```

## Usage Example

```javascript
// Speak text
window.webMeetAudio.speak('Hello, welcome to the meeting');

// Create TTS button for message
const ttsBtn = window.webMeetAudio.createTTSButton(messageText);
messageElement.appendChild(ttsBtn);

// Get current language
const lang = window.webMeetAudio.getCurrentLanguage();
```

## Related Modules

- [server-webmeet-client.md](./server-webmeet-client.md) - Message rendering with TTS buttons

