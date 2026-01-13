# cli/server/webchat/strategies/tts/voices.js - OpenAI Voice Options

## Overview

Voice configuration constants for OpenAI TTS. Defines available voices and provides voice name normalization.

## Source File

`cli/server/webchat/strategies/tts/voices.js`

## Constants

### DEFAULT_VOICE

**Purpose**: Default voice for OpenAI TTS

**Value**: `'alloy'`

```javascript
export const DEFAULT_VOICE = 'alloy';
```

### VOICE_OPTIONS

**Purpose**: Available OpenAI TTS voices

**Value**:
```javascript
export const VOICE_OPTIONS = [
    { value: 'alloy', label: 'Alloy (general purpose)' },
    { value: 'aria', label: 'Aria (American English)' },
    { value: 'verse', label: 'Verse (narration)' },
    { value: 'sol', label: 'Sol (bright tone)' },
    { value: 'luna', label: 'Luna (warm tone)' }
];
```

## Voice Characteristics

| Voice | Description |
|-------|-------------|
| `alloy` | General purpose, neutral tone |
| `aria` | American English, clear articulation |
| `verse` | Narration style, storytelling |
| `sol` | Bright, energetic tone |
| `luna` | Warm, friendly tone |

## Public API

### normalizeVoiceChoice(voice)

**Purpose**: Validates and normalizes voice selection

**Parameters**:
- `voice` (string): Voice name to validate

**Returns**: (string) Valid voice name or default

**Implementation**:
```javascript
export function normalizeVoiceChoice(voice) {
    const token = (voice || '').trim().toLowerCase();
    if (!token) {
        return DEFAULT_VOICE;
    }
    return VOICE_OPTIONS.some((option) => option.value === token)
        ? token
        : DEFAULT_VOICE;
}
```

## Validation Logic

```
┌─────────────────────────────────────────────────────┐
│          Voice Normalization                        │
├─────────────────────────────────────────────────────┤
│  1. Trim and lowercase input                        │
│                                                     │
│  2. If empty:                                       │
│     └── Return DEFAULT_VOICE ('alloy')              │
│                                                     │
│  3. If matches known voice:                         │
│     └── Return normalized voice                     │
│                                                     │
│  4. Otherwise:                                      │
│     └── Return DEFAULT_VOICE ('alloy')              │
└─────────────────────────────────────────────────────┘
```

## Option Format

Each voice option follows the format:
```javascript
{
    value: string,   // API voice identifier
    label: string    // Human-readable display name
}
```

## Exports

```javascript
export { DEFAULT_VOICE, VOICE_OPTIONS, normalizeVoiceChoice };
```

## Usage Example

```javascript
import { DEFAULT_VOICE, VOICE_OPTIONS, normalizeVoiceChoice } from './voices.js';

// Get default voice
console.log(DEFAULT_VOICE);  // 'alloy'

// Populate voice selector
voiceSelect.innerHTML = VOICE_OPTIONS.map(opt =>
    `<option value="${opt.value}">${opt.label}</option>`
).join('');

// Validate user selection
const voice = normalizeVoiceChoice(userInput);  // Returns valid voice or 'alloy'
```

## Related Modules

- [server-webchat-strategies-tts-openai.md](./server-webchat-strategies-tts-openai.md) - OpenAI TTS strategy

