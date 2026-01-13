# cli/server/webchat/sidePanel.js - WebChat Side Panel

## Overview

Client-side side panel module for WebChat. Provides a resizable panel for viewing full message content, displaying iframes for external links, and markdown rendering. Supports drag-to-resize with persistent size storage.

## Source File

`cli/server/webchat/sidePanel.js`

## Constants

```javascript
const PANEL_SIZE_KEY = 'webchat_sidepanel_pct';
```

## Internal Functions

### clamp(value, min, max)

**Purpose**: Clamps value between min and max

**Parameters**:
- `value` (number): Value to clamp
- `min` (number): Minimum value
- `max` (number): Maximum value

**Returns**: (number) Clamped value

**Implementation**:
```javascript
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
```

### renderMarkdown(markdown, text)

**Purpose**: Renders text as markdown HTML

**Parameters**:
- `markdown` (Object): Markdown renderer
- `text` (string): Text to render

**Returns**: (string) HTML string

**Implementation**:
```javascript
function renderMarkdown(markdown, text) {
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

## Public API

### createSidePanel(elements, options)

**Purpose**: Creates side panel module

**Parameters**:
- `elements` (Object):
  - `chatContainer` (HTMLElement): Container element
  - `chatArea` (HTMLElement): Chat area element
  - `sidePanel` (HTMLElement): Side panel element
  - `sidePanelContent` (HTMLElement): Content container
  - `sidePanelClose` (HTMLElement): Close button
  - `sidePanelTitle` (HTMLElement): Title element
  - `sidePanelResizer` (HTMLElement): Resize handle
- `options` (Object):
  - `markdown` (Object): Markdown renderer

**Returns**: (Object) Side panel API

**Return Structure**:
```javascript
{
    openText: Function,              // Open with text content
    openIframe: Function,            // Open with iframe
    close: Function,                 // Close panel
    updateIfActive: Function,        // Update if bubble active
    isActive: Function,              // Check if bubble active
    applyPanelSizeFromStorage: Function, // Apply stored size
    bindLinkDelegation: Function     // Bind link click handling
}
```

## Module State

```javascript
let activeBubble = null;
const panelWrapper = sidePanel?.querySelector('.wa-side-panel-content') || null;
```

## Title Management

### clearPanelTitle()

**Purpose**: Clears panel title content

**Implementation**:
```javascript
function clearPanelTitle() {
    if (!sidePanelTitle) return;
    sidePanelTitle.textContent = '';
    try {
        while (sidePanelTitle.firstChild) {
            sidePanelTitle.removeChild(sidePanelTitle.firstChild);
        }
    } catch (_) { }
}
```

### setPanelTitleText(text)

**Purpose**: Sets plain text title

**Parameters**:
- `text` (string): Title text

**Implementation**:
```javascript
function setPanelTitleText(text) {
    if (!sidePanelTitle) return;
    clearPanelTitle();
    sidePanelTitle.textContent = text || '';
}
```

### setPanelTitleLink(url)

**Purpose**: Sets title as clickable link with copy button

**Parameters**:
- `url` (string): Link URL

**Implementation**:
```javascript
function setPanelTitleLink(url) {
    if (!sidePanelTitle) return;
    clearPanelTitle();

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = url;
    anchor.title = url;
    // Styling...

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // External link icon SVG...

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy link';
    copyBtn.className = 'wa-copy-btn';
    copyBtn.onclick = async (event) => {
        event.preventDefault();
        try {
            await navigator.clipboard.writeText(url);
            copyBtn.classList.add('ok');
            copyBtn.title = 'Copied';
            setTimeout(() => {
                copyBtn.classList.remove('ok');
                copyBtn.title = 'Copy link';
            }, 1000);
        } catch (_) { }
    };
    // Copy icon SVG...

    const wrap = document.createElement('span');
    wrap.appendChild(anchor);
    wrap.appendChild(icon);
    wrap.appendChild(copyBtn);
    sidePanelTitle.appendChild(wrap);
}
```

## Panel Visibility

### ensurePanelVisible()

**Purpose**: Shows side panel and adds class to container

**Implementation**:
```javascript
function ensurePanelVisible() {
    if (!sidePanel || !chatContainer) return;
    sidePanel.style.display = 'flex';
    chatContainer.classList.add('side-panel-open');
}
```

### resetChatAreaSizing()

**Purpose**: Resets chat area to default sizing

**Implementation**:
```javascript
function resetChatAreaSizing() {
    if (!chatArea) return;
    chatArea.style.width = '';
    chatArea.style.flex = '';
}
```

## Panel Sizing

### applyPanelSize(percent)

**Purpose**: Applies panel width percentage

**Parameters**:
- `percent` (number): Width percentage (20-80)

**Implementation**:
```javascript
function applyPanelSize(percent) {
    const pct = clamp(percent, 20, 80);
    if (sidePanel) {
        sidePanel.style.flex = `0 0 ${pct}%`;
        sidePanel.style.maxWidth = 'unset';
        sidePanel.style.width = `${pct}%`;
    }
    if (chatArea) {
        const leftPct = 100 - pct;
        chatArea.style.flex = '0 0 auto';
        chatArea.style.width = `calc(${leftPct}% - 6px)`;
    }
}
```

### applyPanelSizeFromStorage()

**Purpose**: Applies stored panel size

**Implementation**:
```javascript
function applyPanelSizeFromStorage() {
    let stored = 40;
    try {
        stored = parseFloat(localStorage.getItem(PANEL_SIZE_KEY) || '40');
    } catch (_) {
        stored = 40;
    }
    applyPanelSize(Number.isFinite(stored) ? stored : 40);
}
```

## Content Display

### showText(text)

**Purpose**: Shows text content in panel

**Parameters**:
- `text` (string): Content text

**Implementation**:
```javascript
function showText(text) {
    if (!panelWrapper) return;
    panelWrapper.innerHTML = '<div id="sidePanelContent" class="wa-side-panel-body"></div>';
    const container = panelWrapper.querySelector('#sidePanelContent');
    if (!container) return;
    container.innerHTML = renderMarkdown(markdown, text);
    bindLinkDelegation(container);
    setPanelTitleText('Full Answer');
}
```

### openText(bubble, text)

**Purpose**: Opens panel with text from a message bubble

**Parameters**:
- `bubble` (HTMLElement): Source message bubble
- `text` (string): Full message text

**Implementation**:
```javascript
function openText(bubble, text) {
    if (!sidePanel) return;
    showText(text);
    activeBubble = bubble || null;
    ensurePanelVisible();
    applyPanelSizeFromStorage();
}
```

### openIframe(url)

**Purpose**: Opens panel with embedded iframe

**Parameters**:
- `url` (string): URL to embed

**Implementation**:
```javascript
function openIframe(url) {
    if (!panelWrapper || !sidePanel) return;
    panelWrapper.innerHTML = '';

    const holder = document.createElement('div');
    holder.className = 'wa-iframe-wrap';
    holder.style.position = 'relative';
    holder.style.width = '100%';
    holder.style.height = '100%';

    const frame = document.createElement('iframe');
    frame.src = url;
    frame.style.border = '0';
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.referrerPolicy = 'no-referrer';
    frame.loading = 'lazy';

    const overlay = document.createElement('div');
    overlay.className = 'wa-iframe-error';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="wa-iframe-error-card">
          <div class="wa-iframe-error-title">Cannot display this site</div>
          <div class="wa-iframe-error-text">Blocked by X-Frame-Options or CSP.</div>
          <div class="wa-iframe-error-actions">
            <a class="wa-btn" href="${url}" target="_blank">Open in new tab</a>
          </div>
        </div>`;

    holder.appendChild(frame);
    holder.appendChild(overlay);
    panelWrapper.appendChild(holder);

    let loaded = false;
    frame.addEventListener('load', () => {
        loaded = true;
        overlay.style.display = 'none';
    });
    setTimeout(() => {
        if (!loaded) {
            overlay.style.display = 'flex';
        }
    }, 2500);

    activeBubble = null;
    ensurePanelVisible();
    setPanelTitleLink(url);
    applyPanelSizeFromStorage();
}
```

### close()

**Purpose**: Closes the side panel

**Implementation**:
```javascript
function close() {
    if (!sidePanel || !chatContainer) return;
    sidePanel.style.display = 'none';
    chatContainer.classList.remove('side-panel-open');
    activeBubble = null;
    resetChatAreaSizing();
}
```

### updateIfActive(bubble, text)

**Purpose**: Updates content if bubble is active

**Parameters**:
- `bubble` (HTMLElement): Source bubble
- `text` (string): New text content

**Implementation**:
```javascript
function updateIfActive(bubble, text) {
    if (!bubble || bubble !== activeBubble) return;
    showText(text);
    applyPanelSizeFromStorage();
}
```

## Resize Handler

```javascript
(function initResizer() {
    if (!sidePanelResizer || !chatContainer || !sidePanel) return;
    let dragging = false;
    let startX = 0;
    let containerWidth = 0;
    let startPanelWidth = 0;
    let raf = 0;
    let pendingPct = null;

    function scheduleApply(pct) {
        pendingPct = pct;
        if (raf) return;
        raf = requestAnimationFrame(() => {
            if (pendingPct !== null) applyPanelSize(pendingPct);
            raf = 0;
            pendingPct = null;
        });
    }

    function onPointerDown(event) {
        event.preventDefault();
        dragging = true;
        chatContainer.classList.add('dragging');
        startX = event.clientX;
        sidePanelResizer.setPointerCapture(event.pointerId);
        const containerRect = chatContainer.getBoundingClientRect();
        containerWidth = containerRect.width;
        startPanelWidth = sidePanel.getBoundingClientRect().width;
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp, { once: true });
        window.addEventListener('pointercancel', onPointerUp, { once: true });
    }

    function onPointerMove(event) {
        if (!dragging) return;
        event.preventDefault();
        const delta = event.clientX - startX;
        const newWidth = clamp(startPanelWidth - delta, containerWidth * 0.2, containerWidth * 0.8);
        const pct = (newWidth / containerWidth) * 100;
        scheduleApply(pct);
    }

    function onPointerUp(event) {
        if (!dragging) return;
        dragging = false;
        chatContainer.classList.remove('dragging');
        sidePanelResizer.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        try {
            const panelRect = sidePanel.getBoundingClientRect();
            const containerRect = chatContainer.getBoundingClientRect();
            const pct = clamp((panelRect.width / containerRect.width) * 100, 20, 80);
            localStorage.setItem(PANEL_SIZE_KEY, String(pct.toFixed(1)));
        } catch (_) { }
    }

    sidePanelResizer.addEventListener('pointerdown', onPointerDown);
})();
```

## Link Delegation

### bindLinkDelegation(container)

**Purpose**: Binds click handler for webchat links

**Parameters**:
- `container` (HTMLElement): Container to bind

**Implementation**:
```javascript
function bindLinkDelegation(container) {
    if (!container || container.dataset.linksBound === 'true') return;
    container.addEventListener('click', (event) => {
        const link = event.target.closest('a[data-wc-link="true"]');
        if (!link) return;
        event.preventDefault();
        openIframe(link.href);
    });
    container.dataset.linksBound = 'true';
}
```

## Export

```javascript
export function createSidePanel(elements, options) { ... }
```

## Usage Example

```javascript
import { createSidePanel } from './sidePanel.js';

const sidePanelApi = createSidePanel({
    chatContainer: document.getElementById('chatContainer'),
    chatArea: document.getElementById('chatArea'),
    sidePanel: document.getElementById('sidePanel'),
    sidePanelContent: document.getElementById('sidePanelContent'),
    sidePanelClose: document.getElementById('sidePanelClose'),
    sidePanelTitle: document.querySelector('.wa-side-panel-title'),
    sidePanelResizer: document.getElementById('sidePanelResizer')
}, { markdown: window.webchatMarkdown });

// Open with text
const bubble = document.querySelector('.wa-message-bubble');
sidePanelApi.openText(bubble, 'Full message content here...');

// Open with iframe
sidePanelApi.openIframe('https://example.com');

// Close panel
sidePanelApi.close();

// Check if bubble is active
if (sidePanelApi.isActive(bubble)) {
    sidePanelApi.updateIfActive(bubble, 'Updated content');
}

// Bind link handling to container
sidePanelApi.bindLinkDelegation(chatList);
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-messages.md](./server-webchat-messages.md) - Message rendering
- [server-webchat-dom-setup.md](./server-webchat-dom-setup.md) - DOM setup

