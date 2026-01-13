# cli/server/webchat/messages.js - WebChat Messages

## Overview

Manages message rendering and display for the WebChat interface. Handles client messages (outgoing), server messages (incoming), typing indicators, file attachments, and markdown rendering. Supports collapsible long messages with "View more" functionality and text-to-speech integration.

## Source File

`cli/server/webchat/messages.js`

## Dependencies

```javascript
import { formatBytes, getFileIcon } from './fileHelpers.js';
```

## Internal Functions

### formatTime()

**Purpose**: Formats current time as HH:MM

**Returns**: (string) Formatted time string

**Implementation**:
```javascript
function formatTime() {
    const date = new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
```

## Public API

### createMessages(elements, options)

**Purpose**: Creates message management module

**Parameters**:
- `elements` (Object):
  - `chatList` (HTMLElement): Container for messages
  - `typingIndicator` (HTMLElement): Typing indicator element
- `options` (Object):
  - `markdown` (Object): Markdown renderer
  - `initialViewMoreLineLimit` (number): Line limit before collapse
  - `sidePanel` (Object): Side panel API
  - `onServerOutput` (Function): TTS callback

**Returns**: (Object) Messages API

**Return Structure**:
```javascript
{
    addClientMsg: Function,           // Add outgoing message
    addClientAttachment: Function,    // Add outgoing attachment
    addServerMsg: Function,           // Add incoming message
    showTypingIndicator: Function,    // Show typing indicator
    hideTypingIndicator: Function,    // Hide typing indicator
    applyViewMoreSettingToAllBubbles: Function,
    setViewMoreLineLimit: Function,   // Update line limit
    markUserInputSent: Function,      // Mark input as sent
    setServerSpeechHandler: Function  // Set TTS handler
}
```

## Module State

```javascript
const lastServerMsg = { bubble: null, fullText: '' };
let userInputSent = false;
let lastClientCommand = '';
let viewMoreLineLimit = Math.max(1, initialViewMoreLineLimit || 1);
let serverSpeechHandler = typeof onServerOutput === 'function' ? onServerOutput : null;
let speechDebounceTimer = null;
```

## Internal Functions

### appendMessageEl(node)

**Purpose**: Appends message element to chat list

**Parameters**:
- `node` (HTMLElement): Message element

**Implementation**:
```javascript
function appendMessageEl(node) {
    if (!node || !chatList) return;
    try {
        if (typingIndicator && typingIndicator.parentNode === chatList) {
            chatList.insertBefore(node, typingIndicator);
        } else {
            chatList.appendChild(node);
        }
    } catch (_) {
        try {
            chatList.appendChild(node);
        } catch (__) { }
    }
}
```

### showTypingIndicator()

**Purpose**: Shows typing indicator

**Implementation**:
```javascript
function showTypingIndicator() {
    if (!typingIndicator) return;
    typingActive = true;
    typingIndicator.classList.add('show');
    typingIndicator.setAttribute('aria-hidden', 'false');
    try {
        chatList.scrollTop = chatList.scrollHeight;
    } catch (_) { }
}
```

### hideTypingIndicator(force)

**Purpose**: Hides typing indicator

**Parameters**:
- `force` (boolean): Force hide even if not active

**Implementation**:
```javascript
function hideTypingIndicator(force = false) {
    if (!typingIndicator) return;
    if (!typingActive && !force) return;
    typingActive = false;
    typingIndicator.classList.remove('show');
    typingIndicator.setAttribute('aria-hidden', 'true');
}
```

### renderMarkdown(text)

**Purpose**: Renders text as markdown HTML

**Parameters**:
- `text` (string): Raw text

**Returns**: (string) HTML string

**Implementation**:
```javascript
function renderMarkdown(text) {
    if (!text) return '';
    if (markdown && typeof markdown.render === 'function') {
        try {
            return markdown.render(text);
        } catch (error) {
            console.error('[webchat] Markdown render error:', error);
            return text;
        }
    }
    return text;
}
```

### updateBubbleContent(bubble, fullText)

**Purpose**: Updates message bubble content with collapsible support

**Parameters**:
- `bubble` (HTMLElement): Message bubble element
- `fullText` (string): Full message text

**Implementation**:
```javascript
function updateBubbleContent(bubble, fullText) {
    const safeText = typeof fullText === 'string' ? fullText : '';
    bubble.dataset.fullText = safeText;

    const lines = safeText.split('\n');
    const limit = Math.max(1, viewMoreLineLimit);
    const shouldCollapse = lines.length > limit;
    const displayText = shouldCollapse ? lines.slice(0, limit).join('\n') : safeText;

    const textContainer = bubble.querySelector('.wa-message-text');
    const moreNode = bubble.querySelector('.wa-message-more');
    if (textContainer) {
        textContainer.innerHTML = renderMarkdown(displayText);
        sidePanel.bindLinkDelegation(textContainer);
    }

    if (shouldCollapse) {
        if (!moreNode) {
            const viewMore = document.createElement('div');
            viewMore.className = 'wa-message-more';
            viewMore.textContent = 'View more';
            viewMore.onclick = () => sidePanel.openText(bubble, safeText);
            bubble.appendChild(viewMore);
        } else {
            moreNode.onclick = () => sidePanel.openText(bubble, safeText);
        }
        updatePanelIfActive(bubble, safeText);
    } else if (moreNode) {
        moreNode.remove();
        if (sidePanel.isActive(bubble)) {
            sidePanel.close();
        }
    } else if (sidePanel.isActive(bubble)) {
        sidePanel.close();
    }
}
```

### scheduleSpeech(text)

**Purpose**: Debounces TTS output

**Parameters**:
- `text` (string): Text to speak

**Implementation**:
```javascript
function scheduleSpeech(text) {
    if (!serverSpeechHandler) return;
    if (speechDebounceTimer) {
        clearTimeout(speechDebounceTimer);
    }
    const captured = typeof text === 'string' ? text : '';
    speechDebounceTimer = setTimeout(() => {
        speechDebounceTimer = null;
        emitServerOutput(captured);
    }, 250);
}
```

## Public Methods

### addClientMsg(text)

**Purpose**: Adds outgoing client message

**Parameters**:
- `text` (string): Message text

**Implementation**:
```javascript
function addClientMsg(text) {
    lastClientCommand = text;
    const wrapper = document.createElement('div');
    wrapper.className = 'wa-message out';
    wrapper.innerHTML = `
        <div class="wa-message-bubble">
            <div class="wa-message-text"></div>
            <span class="wa-message-time">
                ${formatTime()}
                <svg>...</svg>
            </span>
        </div>`;
    const textDiv = wrapper.querySelector('.wa-message-text');
    const bubble = wrapper.querySelector('.wa-message-bubble');
    if (textDiv) {
        textDiv.innerHTML = renderMarkdown(text);
        sidePanel.bindLinkDelegation(textDiv);
    }
    if (bubble) {
        bubble.dataset.fullText = text;
    }
    appendMessageEl(wrapper);
    if (chatList) {
        chatList.scrollTop = chatList.scrollHeight;
    }
    lastServerMsg.bubble = null;
}
```

### addClientAttachment(options)

**Purpose**: Adds outgoing attachment message with upload status

**Parameters**:
- `options` (Object):
  - `fileName` (string): File name
  - `size` (number): File size in bytes
  - `mime` (string): MIME type
  - `previewUrl` (string): Preview image URL
  - `isImage` (boolean): Is image file
  - `caption` (string): Optional caption

**Returns**: (Object) Attachment control API

**Return Structure**:
```javascript
{
    markUploaded: Function,    // Mark as uploaded
    replacePreview: Function,  // Replace preview URL
    markFailed: Function       // Mark as failed
}
```

**Implementation**:
```javascript
function addClientAttachment({ fileName, size, mime, previewUrl, isImage, caption }) {
    const displayName = fileName || 'Attachment';
    const wrapper = document.createElement('div');
    wrapper.className = 'wa-message out wa-message-attachment';
    wrapper.dataset.attachmentName = displayName;
    if (mime) wrapper.dataset.attachmentMime = mime;
    if (typeof size === 'number' && Number.isFinite(size)) {
        wrapper.dataset.attachmentSize = String(size);
    }
    if (previewUrl) wrapper.dataset.attachmentPreviewUrl = previewUrl;
    if (caption) wrapper.dataset.attachmentCaption = caption;
    wrapper.dataset.attachmentStatus = 'uploading';

    // ... create bubble, thumbnail, info elements ...

    return {
        markUploaded({ downloadUrl, size: uploadedSize, mime: uploadedMime, localPath, id }) {
            wrapper.dataset.attachmentStatus = 'uploaded';
            if (downloadUrl) wrapper.dataset.attachmentDownloadUrl = downloadUrl;
            // ... update UI elements ...
        },
        replacePreview(nextUrl) {
            if (!nextUrl) return;
            if (thumbImage) thumbImage.src = nextUrl;
            wrapper.dataset.attachmentPreviewUrl = nextUrl;
        },
        markFailed(message) {
            wrapper.dataset.attachmentStatus = 'error';
            statusNode.classList.add('error');
            statusNode.textContent = message || 'Upload failed';
        }
    };
}
```

### addServerMsg(text)

**Purpose**: Adds incoming server message with streaming support

**Parameters**:
- `text` (string): Message text

**Implementation**:
```javascript
function addServerMsg(text) {
    let normalized = typeof text === 'string' ? text : '';

    // Filter out raw envelope JSON
    const trimmedNormalized = normalized.trim();
    if (trimmedNormalized.includes('"__webchatMessage"') &&
        trimmedNormalized.includes('"version"') &&
        trimmedNormalized.includes('"text"') &&
        trimmedNormalized.includes('"attachments"')) {
        return; // Skip envelope echo
    }

    // Remove echoed client command
    if (lastClientCommand) {
        const trimmed = lastClientCommand.trim();
        if (trimmed) {
            const lines = normalized.split(/\r?\n/);
            while (lines.length && lines[0].trim() === trimmed) {
                lines.shift();
            }
            normalized = lines.join('\n');
        }
        lastClientCommand = '';
        normalized = normalized.replace(/^\n+/, '');
    }

    if (!normalized.trim()) {
        lastServerMsg.bubble = null;
        lastServerMsg.fullText = '';
        userInputSent = false;
        return;
    }

    const previousFullText = typeof lastServerMsg.fullText === 'string' ? lastServerMsg.fullText : '';
    const appendToExisting = !userInputSent && lastServerMsg.bubble;

    if (appendToExisting) {
        // Append to existing message
        const combined = previousFullText ? `${previousFullText}\n${normalized}` : normalized;
        lastServerMsg.fullText = combined;
        updateBubbleContent(lastServerMsg.bubble, combined);
        scheduleSpeech(combined);
    } else {
        // Create new message
        const wrapper = document.createElement('div');
        wrapper.className = 'wa-message in';
        const bubble = document.createElement('div');
        bubble.className = 'wa-message-bubble';
        bubble.innerHTML = '<div class="wa-message-text"></div><span class="wa-message-time"></span>';
        wrapper.appendChild(bubble);

        lastServerMsg.bubble = bubble;
        lastServerMsg.fullText = normalized;
        userInputSent = false;

        updateBubbleContent(bubble, normalized);
        const timeNode = bubble.querySelector('.wa-message-time');
        if (timeNode) timeNode.textContent = formatTime();
        appendMessageEl(wrapper);
        scheduleSpeech(normalized);
    }

    if (chatList) chatList.scrollTop = chatList.scrollHeight;
}
```

## Message Classes

| Class | Description |
|-------|-------------|
| `.wa-message` | Message container |
| `.wa-message.out` | Outgoing (client) message |
| `.wa-message.in` | Incoming (server) message |
| `.wa-message-bubble` | Message content bubble |
| `.wa-message-text` | Text content container |
| `.wa-message-time` | Timestamp display |
| `.wa-message-more` | View more button |
| `.wa-message-attachment` | Attachment message |
| `.wa-typing` | Typing indicator |

## Attachment Status Values

| Status | Description |
|--------|-------------|
| `uploading` | Upload in progress |
| `uploaded` | Upload complete |
| `error` | Upload failed |

## Data Attributes

| Attribute | Description |
|-----------|-------------|
| `data-full-text` | Complete message text |
| `data-rating` | User rating (up/down) |
| `data-attachment-name` | File name |
| `data-attachment-mime` | MIME type |
| `data-attachment-size` | File size |
| `data-attachment-status` | Upload status |
| `data-attachment-download-url` | Download URL |
| `data-attachment-preview-url` | Preview URL |

## Export

```javascript
export function createMessages(elements, options) { ... }
```

## Usage Example

```javascript
import { createMessages } from './messages.js';

const messages = createMessages({
    chatList: document.getElementById('chat-list'),
    typingIndicator: document.getElementById('typing')
}, {
    markdown: markdownRenderer,
    initialViewMoreLineLimit: 10,
    sidePanel: sidePanelApi,
    onServerOutput: (text) => tts.speak(text)
});

// Add client message
messages.addClientMsg('Hello!');

// Add server message
messages.addServerMsg('Hello! How can I help you?');

// Show typing indicator
messages.showTypingIndicator();

// Add attachment
const attachment = messages.addClientAttachment({
    fileName: 'document.pdf',
    size: 1024,
    mime: 'application/pdf',
    caption: 'Please review this'
});
attachment.markUploaded({ downloadUrl: '/files/123' });
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-network.md](./server-webchat-network.md) - Network communication
- [server-webchat-side-panel.md](./server-webchat-side-panel.md) - Side panel
- [server-webchat-file-helpers.md](./server-webchat-file-helpers.md) - File utilities

