# cli/server/webchat/index.js - WebChat Client Entry Point

## Overview

Client-side entry point for the WebChat interface. Initializes all modules including DOM setup, network communication, message rendering, file uploads, speech-to-text, and text-to-speech. Coordinates interactions between composer, messages, and network layers.

## Source File

`cli/server/webchat/index.js`

## Dependencies

```javascript
import { initDom } from './domSetup.js';
import { createSidePanel } from './sidePanel.js';
import { createMessages } from './messages.js';
import { createComposer } from './composer.js';
import { initSpeechToText } from './speechToText.js';
import { initTextToSpeech } from './textToSpeech.js';
import { createNetwork } from './network.js';
import { createUploader } from './upload.js';
```

## Constants

```javascript
const SEND_TRIGGER_RE = /\bsend\b/i;
const PURGE_TRIGGER_RE = /\bpurge\b/i;
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'];
```

## Module Initialization

### DOM Setup

```javascript
const dom = initDom();
const {
    TAB_ID,
    dlog,
    markdown,
    requiresAuth,
    basePath,
    toEndpoint,
    showBanner,
    hideBanner,
    getViewMoreLineLimit,
    setViewMoreChangeHandler,
    elements
} = dom;
```

### Element References

```javascript
const {
    chatList,
    typingIndicator,
    chatContainer,
    chatArea,
    sidePanel,
    sidePanelContent,
    sidePanelClose,
    sidePanelTitle,
    sidePanelResizer,
    statusEl,
    statusDot,
    cmdInput,
    sendBtn,
    sttBtn,
    sttStatus,
    sttLang,
    sttEnable,
    ttsEnable,
    ttsVoice,
    ttsRate,
    ttsRateValue,
    settingsBtn,
    settingsPanel,
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
} = elements;
```

### Module Creation

```javascript
// Side panel for viewing full messages
const sidePanelApi = createSidePanel({
    chatContainer,
    chatArea,
    sidePanel,
    sidePanelContent,
    sidePanelClose,
    sidePanelTitle,
    sidePanelResizer
}, { markdown });

// Text-to-speech for server responses
const textToSpeech = initTextToSpeech({
    ttsEnable,
    ttsVoice,
    ttsRate,
    ttsRateValue
}, { dlog, toEndpoint, provider: dom.ttsProvider });

// Message rendering and management
const messages = createMessages({
    chatList,
    typingIndicator
}, {
    markdown,
    initialViewMoreLineLimit: getViewMoreLineLimit(),
    sidePanel: sidePanelApi,
    onServerOutput: textToSpeech.handleServerOutput
});

// View more line limit change handler
dom.setViewMoreChangeHandler((limit) => {
    messages.setViewMoreLineLimit(limit);
});

// Bind link delegation to chat list
sidePanelApi.bindLinkDelegation(chatList);

// Network communication
const network = createNetwork({
    TAB_ID,
    toEndpoint,
    dlog,
    showBanner,
    hideBanner,
    statusEl,
    statusDot,
    agentName: dom.agentName
}, {
    addClientMsg: messages.addClientMsg,
    addClientAttachment: messages.addClientAttachment,
    addServerMsg: messages.addServerMsg,
    showTypingIndicator: messages.showTypingIndicator,
    hideTypingIndicator: messages.hideTypingIndicator,
    markUserInputSent: messages.markUserInputSent
});

// Input composer
const composer = createComposer({
    cmdInput,
    sendBtn
}, {
    purgeTriggerRe: PURGE_TRIGGER_RE
});

// File uploader
const uploader = createUploader({
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
}, { composer });
```

## Internal Functions

### refocusComposerAfterIcon(btn)

**Purpose**: Refocuses composer after clicking toolbar buttons

**Parameters**:
- `btn` (HTMLElement): Button element

**Implementation**:
```javascript
function refocusComposerAfterIcon(btn) {
    if (!btn) {
        return;
    }
    btn.addEventListener('click', () => {
        setTimeout(() => composer.focus(), 0);
    });
}
```

### initMessageToolbar()

**Purpose**: Initializes context menu toolbar for message bubbles

**Implementation**:
```javascript
function initMessageToolbar() {
    if (!chatList || !composer) {
        return;
    }

    const getBubbleText = (bubble) => {
        if (!bubble) return '';
        const fromDataset = typeof bubble.dataset.fullText === 'string' ? bubble.dataset.fullText : '';
        const fallback = bubble.textContent || '';
        return (fromDataset || fallback || '').trim();
    };

    const setRating = (bubble, rating) => {
        if (!bubble) return;
        const menu = bubble.querySelector('.wa-context-menu');
        if (!menu) return;
        if (rating) {
            bubble.dataset.rating = rating;
        } else {
            delete bubble.dataset.rating;
        }
        const upBtn = menu.querySelector('[data-action="thumb-up"]');
        const downBtn = menu.querySelector('[data-action="thumb-down"]');
        const mark = (btn, isActive) => {
            if (!btn) return;
            if (isActive) {
                btn.dataset.active = 'true';
            } else {
                delete btn.dataset.active;
            }
        };
        mark(upBtn, rating === 'up');
        mark(downBtn, rating === 'down');
    };

    const copyText = async (text) => {
        const value = (text || '').trim();
        if (!value) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                throw new Error('Clipboard unavailable');
            }
        } catch (_) {
            try {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            } catch (_) { }
        }
    };

    const handleAction = (action, bubble) => {
        const text = getBubbleText(bubble);
        if (action === 'copy') {
            copyText(text);
            return;
        }
        if (action === 'insert') {
            if (text) {
                composer.setValue(text);
                composer.focus();
            }
            return;
        }
        if (action === 'thumb-up' || action === 'thumb-down') {
            const desired = action === 'thumb-up' ? 'up' : 'down';
            const current = bubble?.dataset?.rating;
            const next = current === desired ? '' : desired;
            setRating(bubble, next);
        }
    };

    const attachMenuToBubble = (bubble) => {
        if (!bubble || bubble.querySelector('.wa-context-menu')) return;
        const message = bubble.closest('.wa-message');
        if (message && message.classList.contains('wa-typing')) return;

        const menu = document.createElement('div');
        menu.className = 'wa-context-menu';
        menu.innerHTML = `
            <button type="button" data-action="copy" title="Copy">Copy</button>
            <button type="button" data-action="insert" title="Insert into prompt">Insert</button>
            <button type="button" data-action="thumb-up" title="Thumb up">👍</button>
            <button type="button" data-action="thumb-down" title="Thumb down">👎</button>
        `;
        menu.addEventListener('click', (event) => {
            const btn = event.target?.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            handleAction(action, bubble);
        });
        bubble.appendChild(menu);
    };

    // Attach to existing bubbles
    const attachToExisting = () => {
        const bubbles = chatList.querySelectorAll('.wa-message-bubble');
        bubbles.forEach((bubble) => attachMenuToBubble(bubble));
    };

    // Observe new bubbles
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes?.forEach((node) => {
                if (!(node instanceof Element)) return;
                if (node.classList.contains('wa-message-bubble')) {
                    attachMenuToBubble(node);
                    return;
                }
                const nested = node.querySelectorAll?.('.wa-message-bubble');
                if (nested && nested.length) {
                    nested.forEach((bubble) => attachMenuToBubble(bubble));
                }
            });
        }
    });

    attachToExisting();
    observer.observe(chatList, { childList: true, subtree: true });
}
```

### isEditableTarget(target)

**Purpose**: Checks if target element is editable

**Parameters**:
- `target` (HTMLElement): Target element

**Returns**: (boolean) True if editable

**Implementation**:
```javascript
const isEditableTarget = (target) => {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (!tag) return false;
    return EDITABLE_TAGS.includes(tag);
};
```

## Event Handlers

### Toolbar Button Focus

```javascript
refocusComposerAfterIcon(attachmentBtn);
refocusComposerAfterIcon(settingsBtn);
refocusComposerAfterIcon(sttBtn);
```

### Send Handler

```javascript
composer.setSendHandler((cmdText) => {
    const cmd = cmdText.trim();
    const fileSelections = uploader.getSelectedFiles();

    if (fileSelections.length) {
        network.sendAttachments(fileSelections, cmd);
        uploader.clearFiles();
        return true;
    }

    if (cmd) {
        network.sendCommand(cmd);
        return true;
    }

    return false;
});
```

### Speech-to-Text Initialization

```javascript
initSpeechToText({
    sttBtn,
    sttStatus,
    sttLang,
    sttEnable,
    settingsBtn,
    settingsPanel
}, {
    composer,
    purgeTriggerRe: PURGE_TRIGGER_RE,
    sendTriggerRe: SEND_TRIGGER_RE,
    dlog,
    provider: dom.sttProvider
});
```

### Global Keyboard Handler

```javascript
document.addEventListener('keydown', (event) => {
    if (!composer || !cmdInput) return;
    if (event.defaultPrevented) return;
    if (document.activeElement === cmdInput) return;
    const activeEl = document.activeElement;
    if (isEditableTarget(activeEl) && activeEl !== cmdInput) return;
    if (isEditableTarget(event.target) && event.target !== cmdInput) return;
    const handled = typeof composer.typeFromKeyEvent === 'function'
        ? composer.typeFromKeyEvent(event)
        : false;
    if (handled) {
        event.preventDefault();
    }
});
```

## Startup Sequence

```javascript
(async () => {
    if (requiresAuth) {
        const ok = await fetch(toEndpoint('whoami')).then((res) => res.ok).catch(() => false);
        if (!ok) {
            window.location.href = basePath || '.';
            return;
        }
    }
})();

network.start();
```

## Message Toolbar Actions

| Action | Description |
|--------|-------------|
| `copy` | Copy message text to clipboard |
| `insert` | Insert message text into composer |
| `thumb-up` | Rate message positively (toggle) |
| `thumb-down` | Rate message negatively (toggle) |

## Module Interaction Flow

```
┌────────────────────────────────────────────────────────────┐
│                    WebChat Architecture                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────┐     ┌──────────┐     ┌─────────────┐         │
│  │ Composer│────►│ Network  │────►│ Server (SSE)│         │
│  └─────────┘     └──────────┘     └─────────────┘         │
│       │               │                  │                 │
│       │               ▼                  │                 │
│       │         ┌──────────┐             │                 │
│       │         │ Messages │◄────────────┘                 │
│       │         └──────────┘                               │
│       │               │                                    │
│       ▼               ▼                                    │
│  ┌─────────┐     ┌──────────┐                             │
│  │ Uploader│     │Side Panel│                             │
│  └─────────┘     └──────────┘                             │
│       │               │                                    │
│       ▼               ▼                                    │
│  ┌────────────────────────────────────┐                   │
│  │          Text-to-Speech            │                   │
│  └────────────────────────────────────┘                   │
│                    │                                       │
│                    ▼                                       │
│  ┌────────────────────────────────────┐                   │
│  │         Speech-to-Text             │                   │
│  └────────────────────────────────────┘                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Related Modules

- [server-webchat-messages.md](./server-webchat-messages.md) - Message rendering
- [server-webchat-network.md](./server-webchat-network.md) - Network communication
- [server-webchat-composer.md](./server-webchat-composer.md) - Input composition
- [server-webchat-dom-setup.md](./server-webchat-dom-setup.md) - DOM initialization
- [server-webchat-side-panel.md](./server-webchat-side-panel.md) - Side panel
- [server-webchat-speech-to-text.md](./server-webchat-speech-to-text.md) - Speech input
- [server-webchat-text-to-speech.md](./server-webchat-text-to-speech.md) - Speech output
- [server-webchat-upload.md](./server-webchat-upload.md) - File uploads

