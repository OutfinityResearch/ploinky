# cli/server/webchat/domSetup.js - WebChat DOM Setup

## Overview

Client-side DOM initialization module for WebChat. Sets up element references, theme management, view more line limit settings, and provides utility functions for endpoint building and banner display.

## Source File

`cli/server/webchat/domSetup.js`

## Constants

```javascript
const VIEW_MORE_LINES_KEY = 'wa_view_more_lines';
const LEGACY_VIEW_MORE_KEY = 'wa_view_more_enabled';
const THEME_STORAGE_KEY = 'webchat_theme';
const SUPPORTED_THEMES = new Set(['light', 'dark', 'explorer', 'obsidian']);
const FALLBACK_THEME = 'explorer';
```

## Internal Functions

### readInitialViewMoreLimit()

**Purpose**: Reads view more line limit from localStorage

**Returns**: (number) Line limit (default: 1000)

**Implementation**:
```javascript
function readInitialViewMoreLimit() {
    let limit = 1000;
    try {
        const storedLimit = localStorage.getItem(VIEW_MORE_LINES_KEY);
        if (storedLimit !== null) {
            const parsed = parseInt(storedLimit, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
                limit = parsed;
            }
        } else {
            // Legacy migration
            const legacy = localStorage.getItem(LEGACY_VIEW_MORE_KEY);
            if (legacy === 'true') {
                limit = 6;
            } else if (legacy === 'false') {
                limit = 1000;
            }
        }
    } catch (_) {
        limit = 1000;
    }
    try {
        localStorage.removeItem(LEGACY_VIEW_MORE_KEY);
        localStorage.setItem(VIEW_MORE_LINES_KEY, String(limit));
    } catch (_) { }
    return limit;
}
```

## Public API

### initDom()

**Purpose**: Initializes DOM elements and returns configuration

**Returns**: (Object) DOM configuration object

**Return Structure**:
```javascript
{
    TAB_ID: string,                    // Unique tab identifier
    dlog: Function,                    // Debug logger
    markdown: Object,                  // Markdown renderer
    requiresAuth: boolean,             // Auth required flag
    basePath: string,                  // Base URL path
    agentName: string,                 // Agent identifier
    displayName: string,               // Display title
    ttsProvider: string,               // TTS provider name
    sttProvider: string,               // STT provider name
    toEndpoint: Function,              // URL builder
    showBanner: Function,              // Show connection banner
    hideBanner: Function,              // Hide connection banner
    getViewMoreLineLimit: Function,    // Get current limit
    setViewMoreChangeHandler: Function,// Set change callback
    elements: Object                   // DOM element references
}
```

## DOM Elements

```javascript
const elements = {
    body,
    titleBar,
    avatarInitial,
    statusEl,
    statusDot,
    themeSelect,
    banner,
    bannerText,
    chatList,
    typingIndicator,
    cmdInput,
    sendBtn,
    chatContainer,
    chatArea,
    sidePanel,
    sidePanelContent,
    sidePanelClose,
    sidePanelTitle,
    sidePanelResizer,
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
    viewMoreLinesInput,
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
};
```

## Body Data Attributes

| Attribute | Description |
|-----------|-------------|
| `data-auth` | `"true"` if authentication required |
| `data-agent` | Agent identifier |
| `data-title` | Display title |
| `data-base` | Base URL path |
| `data-agent-query` | Query string for agent |
| `data-tts-provider` | TTS provider name |
| `data-stt-provider` | STT provider name |

## Implementation

### Tab ID Generation

```javascript
const TAB_ID = crypto.randomUUID();
```

### Debug Logger

```javascript
const dlog = (...args) => console.log('[webchat]', ...args);
```

### Markdown Renderer

```javascript
const markdown = window.webchatMarkdown;
```

### Title Setup

```javascript
const appTitle = displayName || agentName || 'WebChat';
if (titleBar) {
    titleBar.textContent = appTitle;
}
document.title = `${appTitle} · WebChat`;
if (avatarInitial) {
    const initial = appTitle.trim().charAt(0) || 'P';
    avatarInitial.textContent = initial.toUpperCase();
}
```

## Banner Functions

### showBanner(text, cls)

**Purpose**: Shows connection status banner

**Parameters**:
- `text` (string): Banner text
- `cls` (string): Status class (`'ok'` or `'err'`)

**Implementation**:
```javascript
function showBanner(text, cls) {
    if (!banner || !bannerText) return;
    banner.className = 'wa-connection-banner show';
    if (cls === 'ok') {
        banner.classList.add('success');
    } else if (cls === 'err') {
        banner.classList.add('error');
    }
    bannerText.textContent = text;
}
```

### hideBanner()

**Purpose**: Hides connection status banner

**Implementation**:
```javascript
function hideBanner() {
    if (!banner) return;
    banner.classList.remove('show');
}
```

## Theme Management

### normalizeTheme(theme)

**Purpose**: Validates theme name

**Parameters**:
- `theme` (string): Theme name

**Returns**: (string) Valid theme name

**Implementation**:
```javascript
function normalizeTheme(theme) {
    return SUPPORTED_THEMES.has(theme) ? theme : FALLBACK_THEME;
}
```

### readThemePreference()

**Purpose**: Reads saved theme from localStorage

**Returns**: (string) Theme name

**Implementation**:
```javascript
function readThemePreference() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return normalizeTheme(stored);
    } catch (_) {
        return FALLBACK_THEME;
    }
}
```

### applyThemePreference(theme)

**Purpose**: Applies theme and saves preference

**Parameters**:
- `theme` (string): Theme name

**Implementation**:
```javascript
function applyThemePreference(theme) {
    const nextTheme = normalizeTheme(theme);
    document.body.setAttribute('data-theme', nextTheme);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (_) { }
    if (themeSelect && themeSelect.value !== nextTheme) {
        themeSelect.value = nextTheme;
    }
}
```

## Theme Event Handler

```javascript
if (themeSelect) {
    themeSelect.value = initialTheme;
    themeSelect.addEventListener('change', (event) => {
        applyThemePreference(event.target.value);
    });
}
```

## View More Settings

### Line Limit Handler

```javascript
if (viewMoreLinesInput) {
    const normalizeLineLimit = () => {
        const parsed = parseInt(viewMoreLinesInput.value, 10);
        viewMoreLineLimit = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
        viewMoreLinesInput.value = String(viewMoreLineLimit);
        try {
            localStorage.setItem(VIEW_MORE_LINES_KEY, String(viewMoreLineLimit));
        } catch (_) { }
        emitViewMoreChange();
    };
    viewMoreLinesInput.value = String(viewMoreLineLimit);
    viewMoreLinesInput.addEventListener('change', normalizeLineLimit);
    viewMoreLinesInput.addEventListener('blur', normalizeLineLimit);
}
```

### setViewMoreChangeHandler(handler)

**Purpose**: Registers callback for line limit changes

**Parameters**:
- `handler` (Function): Callback receiving new limit

**Implementation**:
```javascript
function setViewMoreChangeHandler(handler) {
    viewMoreChangeHandler = typeof handler === 'function' ? handler : null;
    emitViewMoreChange();
}
```

## Endpoint Builder

### toEndpoint(path)

**Purpose**: Builds API endpoint URL

**Parameters**:
- `path` (string): Endpoint path

**Returns**: (string) Full URL

**Implementation**:
```javascript
const toEndpoint = (path) => {
    const suffix = String(path || '').replace(/^\/+/, '');
    let url = basePath ? `${basePath}/${suffix}` : `/${suffix}`;
    if (agentQuery) {
        url += (url.includes('?') ? '&' : '?') + agentQuery;
    }
    return url;
};
```

## Supported Themes

| Theme | Description |
|-------|-------------|
| `light` | Light color scheme |
| `dark` | Dark color scheme |
| `explorer` | Explorer theme (default) |
| `obsidian` | Obsidian-inspired theme |

## Export

```javascript
export function initDom() { ... }
```

## Usage Example

```javascript
import { initDom } from './domSetup.js';

const dom = initDom();

// Access elements
const { chatList, cmdInput, sendBtn } = dom.elements;

// Build endpoint URL
const streamUrl = dom.toEndpoint('stream?tabId=' + dom.TAB_ID);

// Show status
dom.showBanner('Connected', 'ok');
setTimeout(() => dom.hideBanner(), 2000);

// Handle view more changes
dom.setViewMoreChangeHandler((limit) => {
    messages.setViewMoreLineLimit(limit);
});

// Check auth requirement
if (dom.requiresAuth) {
    // Perform authentication
}
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-messages.md](./server-webchat-messages.md) - Message rendering
- [server-webchat-side-panel.md](./server-webchat-side-panel.md) - Side panel

