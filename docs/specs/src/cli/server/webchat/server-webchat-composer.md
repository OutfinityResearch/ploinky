# cli/server/webchat/composer.js - WebChat Composer

## Overview

Client-side input composer module for WebChat. Manages the command input textarea with auto-resize, voice text appending, keyboard event handling, purge detection, and submission handling.

## Source File

`cli/server/webchat/composer.js`

## Constants

```javascript
const MAX_TEXTAREA_HEIGHT_PX = 72;
const INITIAL_FOCUS_DELAY_MS = 120;
```

## Public API

### createComposer(elements, options)

**Purpose**: Creates composer input module

**Parameters**:
- `elements` (Object):
  - `cmdInput` (HTMLTextAreaElement): Input textarea
  - `sendBtn` (HTMLButtonElement): Send button
- `options` (Object):
  - `purgeTriggerRe` (RegExp): Pattern to trigger purge

**Returns**: (Object) Composer API

**Return Structure**:
```javascript
{
    submit: Function,          // Submit current input
    clear: Function,           // Clear input
    purge: Function,           // Clear and trigger purge handler
    appendVoiceText: Function, // Append voice transcription
    setValue: Function,        // Set input value
    getValue: Function,        // Get input value
    autoResize: Function,      // Resize textarea
    typeFromKeyEvent: Function,// Handle keyboard input
    focus: Function,           // Focus input
    setSendHandler: Function,  // Set send callback
    setPurgeHandler: Function  // Set purge callback
}
```

## Module State

```javascript
let onSend = null;   // Send handler callback
let onPurge = null;  // Purge handler callback
```

## Internal Functions

### focusAfterAction()

**Purpose**: Refocuses input after an action

**Implementation**:
```javascript
function focusAfterAction() {
    if (!cmdInput) return;
    setTimeout(() => {
        focusInput();
    }, 0);
}
```

### focusInput(options)

**Purpose**: Focuses the input textarea

**Parameters**:
- `options` (Object):
  - `preserveSelection` (boolean): Keep current selection

**Implementation**:
```javascript
function focusInput(options = {}) {
    if (!cmdInput) return;
    const { preserveSelection = false } = options;
    if (document.activeElement === cmdInput) return;
    try {
        cmdInput.focus({ preventScroll: true });
    } catch (_) {
        cmdInput.focus();
    }
    if (preserveSelection) return;
    const pos = cmdInput.value.length;
    try {
        cmdInput.setSelectionRange(pos, pos);
    } catch (_) { }
}
```

### autoResize()

**Purpose**: Auto-resizes textarea based on content

**Implementation**:
```javascript
function autoResize() {
    if (!cmdInput) return;
    try {
        cmdInput.style.height = 'auto';
        const next = Math.min(MAX_TEXTAREA_HEIGHT_PX, Math.max(22, cmdInput.scrollHeight));
        cmdInput.style.height = `${next}px`;
    } catch (_) { }
}
```

### insertTextAtCursor(text)

**Purpose**: Inserts text at current cursor position

**Parameters**:
- `text` (string): Text to insert

**Returns**: (boolean) True if inserted

**Implementation**:
```javascript
function insertTextAtCursor(text) {
    if (!cmdInput || !text) return false;
    let selStart = cmdInput.value.length;
    let selEnd = selStart;
    try {
        if (typeof cmdInput.selectionStart === 'number') {
            selStart = cmdInput.selectionStart;
        }
        if (typeof cmdInput.selectionEnd === 'number') {
            selEnd = cmdInput.selectionEnd;
        }
    } catch (_) { }
    const before = cmdInput.value.slice(0, selStart);
    const after = cmdInput.value.slice(selEnd);
    cmdInput.value = `${before}${text}${after}`;
    const nextPos = selStart + text.length;
    try {
        cmdInput.setSelectionRange(nextPos, nextPos);
    } catch (_) { }
    autoResize();
    return true;
}
```

## Public Methods

### clear()

**Purpose**: Clears input and refocuses

**Implementation**:
```javascript
function clear() {
    if (!cmdInput) return;
    cmdInput.value = '';
    autoResize();
    focusAfterAction();
}
```

### purge(options)

**Purpose**: Clears input and triggers purge handler

**Parameters**:
- `options` (Object):
  - `resetVoice` (boolean): Reset voice state

**Implementation**:
```javascript
function purge(options = {}) {
    const { resetVoice = false } = options;
    clear();
    if (typeof onPurge === 'function') {
        onPurge({ resetVoice });
    }
}
```

### submit()

**Purpose**: Submits current input value

**Returns**: (boolean) True if submitted

**Implementation**:
```javascript
function submit() {
    if (!cmdInput) return false;
    const value = cmdInput.value;
    if (purgeTriggerRe.test(value)) {
        purge();
        return false;
    }

    const result = typeof onSend === 'function' ? onSend(value) : true;

    if (result !== false) {
        clear();
        return true;
    }
    focusAfterAction();
    return false;
}
```

### appendVoiceText(addition)

**Purpose**: Appends voice transcription text

**Parameters**:
- `addition` (string): Transcribed text

**Implementation**:
```javascript
function appendVoiceText(addition) {
    if (!cmdInput || !addition) return;
    const current = cmdInput.value;
    let insert = addition;
    const additionHasLeadingSpace = /^\s/.test(insert);
    const additionStartsPunct = /^[.,!?;:]/.test(insert);
    if (!additionHasLeadingSpace && current && !/\s$/.test(current) && !additionStartsPunct) {
        insert = ` ${insert}`;
    }
    const selStart = cmdInput.selectionStart;
    const selEnd = cmdInput.selectionEnd;
    const hadFocus = document.activeElement === cmdInput;
    const prevScroll = cmdInput.scrollTop;
    cmdInput.value = current + insert;
    if (hadFocus) {
        if (selStart !== current.length || selEnd !== current.length) {
            cmdInput.setSelectionRange(selStart, selEnd);
        } else {
            const pos = cmdInput.value.length;
            cmdInput.setSelectionRange(pos, pos);
        }
    }
    cmdInput.scrollTop = prevScroll;
    autoResize();
    if (purgeTriggerRe.test(cmdInput.value)) {
        purge({ resetVoice: true });
    }
}
```

### typeFromKeyEvent(event)

**Purpose**: Handles global keyboard input

**Parameters**:
- `event` (KeyboardEvent): Keyboard event

**Returns**: (boolean) True if handled

**Implementation**:
```javascript
function typeFromKeyEvent(event) {
    if (!cmdInput || !event) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const key = event.key;
    if (!key || key.length !== 1) return false;
    focusInput({ preserveSelection: true });
    const inserted = insertTextAtCursor(key);
    if (inserted && purgeTriggerRe.test(cmdInput.value)) {
        purge();
    }
    return inserted;
}
```

### setValue(value)

**Purpose**: Sets input value directly

**Parameters**:
- `value` (string): New value

**Implementation**:
```javascript
function setValue(value) {
    if (!cmdInput) return;
    cmdInput.value = value;
    autoResize();
}
```

### getValue()

**Purpose**: Gets current input value

**Returns**: (string) Current value

**Implementation**:
```javascript
const getValue = () => (cmdInput ? cmdInput.value : '');
```

## Event Handlers

### Input Event

```javascript
if (cmdInput) {
    cmdInput.addEventListener('input', () => {
        autoResize();
        if (purgeTriggerRe.test(cmdInput.value)) {
            purge();
        }
    });
}
```

### Keydown Event

```javascript
if (cmdInput) {
    cmdInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    });
}
```

### Send Button Click

```javascript
if (sendBtn) {
    sendBtn.onclick = () => submit();
}
```

### Initial Focus

```javascript
setTimeout(autoResize, 0);
const scheduleInitialFocus = () => {
    setTimeout(() => {
        focusInput();
    }, INITIAL_FOCUS_DELAY_MS);
};
scheduleInitialFocus();
window.addEventListener('pageshow', scheduleInitialFocus);
```

## Callback Registration

### setSendHandler(handler)

**Purpose**: Registers send callback

**Parameters**:
- `handler` (Function): Callback receiving input value

**Implementation**:
```javascript
setSendHandler: (handler) => {
    onSend = typeof handler === 'function' ? handler : null;
}
```

### setPurgeHandler(handler)

**Purpose**: Registers purge callback

**Parameters**:
- `handler` (Function): Callback receiving purge options

**Implementation**:
```javascript
setPurgeHandler: (handler) => {
    onPurge = typeof handler === 'function' ? handler : null;
}
```

## Export

```javascript
export function createComposer(elements, options) { ... }
```

## Usage Example

```javascript
import { createComposer } from './composer.js';

const composer = createComposer({
    cmdInput: document.getElementById('cmd'),
    sendBtn: document.getElementById('send')
}, {
    purgeTriggerRe: /\bpurge\b/i
});

composer.setSendHandler((text) => {
    network.sendCommand(text);
    return true; // Clear input
});

composer.setPurgeHandler(({ resetVoice }) => {
    if (resetVoice) {
        speechToText.reset();
    }
});

// Append voice transcription
composer.appendVoiceText('Hello world');

// Submit programmatically
composer.submit();

// Insert text at cursor
composer.setValue('New command');
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-speech-to-text.md](./server-webchat-speech-to-text.md) - Voice input
- [server-webchat-network.md](./server-webchat-network.md) - Network communication

