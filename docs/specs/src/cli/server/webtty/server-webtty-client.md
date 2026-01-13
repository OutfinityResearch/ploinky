# cli/server/webtty/webtty.js - WebTTY Client

## Overview

Client-side JavaScript for the WebTTY terminal interface. Initializes xterm.js terminal emulator, manages SSE streaming for terminal output, handles user input, and provides theme switching. Runs in the browser.

## Source File

`cli/server/webtty/webtty.js`

## Constants

```javascript
const TAB_ID = crypto.randomUUID();
```

## DOM Elements

```javascript
const body = document.body;
const titleBar = document.getElementById('titleBar');
const statusEl = document.getElementById('status');
const statusDot = document.querySelector('.wa-status-dot');
const sizeEl = document.getElementById('size');
const themeToggle = document.getElementById('themeToggle');
const containerName = document.getElementById('containerName');
const runtime = document.getElementById('runtime');
const banner = document.getElementById('connBanner');
const bannerText = document.getElementById('bannerText');
```

## Body Data Attributes

| Attribute | Description |
|-----------|-------------|
| `data-title` | Terminal title |
| `data-agent` | Agent name |
| `data-auth` | Requires authentication |
| `data-container` | Container name |
| `data-runtime` | Runtime type |

## Theme Configuration

### Dark Theme

```javascript
const darkTheme = {
    background: '#0a0b0d',
    foreground: '#e9edef',
    cursor: '#e9edef',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5'
};
```

### Light Theme

```javascript
const lightTheme = {
    background: '#ffffff',
    foreground: '#111b21',
    cursor: '#111b21',
    // ... color definitions
};
```

## Functions

### Theme Management

#### getTheme()

**Purpose**: Retrieves saved theme preference

**Returns**: (string) Theme name ('light' or 'dark')

```javascript
function getTheme() {
    return localStorage.getItem('webtty_theme') || 'light';
}
```

#### setTheme(t)

**Purpose**: Applies and saves theme

**Parameters**:
- `t` (string): Theme name

```javascript
function setTheme(t) {
    document.body.setAttribute('data-theme', t);
    localStorage.setItem('webtty_theme', t);
    try {
        term?.setOption('theme', t === 'dark' ? darkTheme : lightTheme);
    } catch(_) {}
}
```

### Authentication

#### ensureAuth()

**Purpose**: Checks if user is authenticated

**Returns**: (Promise<boolean>) Authentication status

```javascript
async function ensureAuth() {
    if (!requiresAuth) return true;
    try {
        const res = await fetch('whoami');
        return res.ok;
    } catch(_) {
        return false;
    }
}
```

### Banner Display

#### showBanner(text, cls)

**Purpose**: Shows connection status banner

**Parameters**:
- `text` (string): Banner text
- `cls` (string): Status class ('ok' or 'err')

#### hideBanner()

**Purpose**: Hides connection banner

### Terminal Initialization

#### initConsole()

**Purpose**: Initializes xterm.js terminal

```javascript
function initConsole() {
    const termEl = document.getElementById('term');
    const { Terminal } = window;
    const FitAddon = window.FitAddon.FitAddon;
    const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;

    term = new Terminal({
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        theme: getTheme() === 'dark' ? darkTheme : lightTheme,
        cursorBlink: true,
        cursorStyle: 'bar',
        allowProposedApi: true,
        convertEol: true,
        scrollback: 2000,
        rendererType: 'canvas'
    });

    fitAddon = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(links);
    term.open(termEl);

    try {
        fitAddon.fit();
    } catch(_) {}

    sizeEl.textContent = term.rows + ' × ' + term.cols;
    termEl.addEventListener('mousedown', () => term.focus());
}
```

### Terminal I/O

#### sendResize()

**Purpose**: Sends terminal resize event to server

```javascript
function sendResize() {
    try {
        fitAddon.fit();
    } catch(_) {}

    const cols = term.cols;
    const rows = term.rows;
    sizeEl.textContent = rows + ' × ' + cols;

    fetch(`resize?tabId=${TAB_ID}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ cols, rows })
    }).catch(() => {});
}
```

#### bindIO()

**Purpose**: Binds terminal input/output handlers

```javascript
function bindIO() {
    window.addEventListener('resize', sendResize);
    setTimeout(sendResize, 120);

    term.onData(data => {
        fetch(`input?tabId=${TAB_ID}`, {
            method: 'POST',
            headers: {'Content-Type': 'text/plain'},
            body: data
        }).catch(() => {});
    });
}
```

### SSE Connection

#### startSSE()

**Purpose**: Starts Server-Sent Events connection

```javascript
function startSSE() {
    showBanner('Connecting…');

    try {
        es?.close?.();
    } catch(_) {}

    es = new EventSource(`stream?tabId=${TAB_ID}`);

    es.onopen = () => {
        statusEl.textContent = 'connected';
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        showBanner('Connected', 'ok');
        setTimeout(hideBanner, 800);
    };

    es.onerror = () => {
        statusEl.textContent = 'disconnected';
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        try { es.close(); } catch(_) {}
        // Auto-reconnect after delay
        setTimeout(() => { try { startSSE(); } catch(_) {} }, 1000);
    };

    es.onmessage = (ev) => {
        try {
            const text = JSON.parse(ev.data);
            term.write(text);
        } catch(_) {}
    };
}
```

## Initialization Sequence

```javascript
initConsole();
startSSE();
bindIO();
```

## Terminal Options

| Option | Value |
|--------|-------|
| `fontFamily` | Menlo, Monaco, Consolas, monospace |
| `fontSize` | 13 |
| `cursorBlink` | true |
| `cursorStyle` | bar |
| `convertEol` | true |
| `scrollback` | 2000 |
| `rendererType` | canvas |

## LocalStorage Keys

| Key | Description |
|-----|-------------|
| `webtty_theme` | Theme preference |

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `stream?tabId=<id>` | GET (SSE) | Terminal output stream |
| `input?tabId=<id>` | POST | Send user input |
| `resize?tabId=<id>` | POST | Send resize event |
| `whoami` | GET | Check authentication |

## Related Modules

- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - Server handler
- [server-webtty-tty.md](./server-webtty-tty.md) - PTY factory
- [server-webtty-login.md](./server-webtty-login.md) - Login page

