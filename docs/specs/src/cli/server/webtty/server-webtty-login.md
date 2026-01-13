# cli/server/webtty/login.js - WebTTY Login

## Overview

Client-side JavaScript for the WebTTY login page. Handles token-based authentication with support for direct token input, URL query parameters, and full invitation links. Provides auto-login when token is present in URL.

## Source File

`cli/server/webtty/login.js`

## DOM Elements

```javascript
const body = document.body;
const err = document.getElementById('err');
const btn = document.getElementById('btn');
const form = document.getElementById('tokenForm');
const input = document.getElementById('tokenInput');
```

## Configuration

```javascript
const basePath = String(body.dataset.base || '').replace(/\/$/, '');
const homeHref = basePath ? `${basePath}/` : '/webtty';
```

## Functions

### URL/Endpoint Building

#### toEndpoint(path)

**Purpose**: Builds endpoint URL with base path

**Parameters**:
- `path` (string): Endpoint path

**Returns**: (string) Full URL

```javascript
const toEndpoint = (path) => {
    const suffix = String(path || '').replace(/^\/+/, '');
    return (basePath ? basePath : '') + '/' + suffix;
};
```

### Authentication Check

#### goIfAuthed()

**Purpose**: Redirects to home if already authenticated

**Returns**: (Promise<boolean>) Whether redirect occurred

```javascript
async function goIfAuthed() {
    try {
        const res = await fetch(toEndpoint('whoami'), { credentials: 'include' });
        if (res.ok) {
            const info = await res.json().catch(() => null);
            if (info && info.ok) {
                window.location.href = homeHref;
                return true;
            }
        }
    } catch (_) {}
    return false;
}
```

### Token Extraction

#### getTokenFromUrl()

**Purpose**: Extracts token from URL query string

**Returns**: (string) Token or empty string

```javascript
function getTokenFromUrl() {
    try {
        const u = new URL(location.href);
        return (u.searchParams.get('token') || '').trim();
    } catch(_) {
        return '';
    }
}
```

#### extractToken(raw)

**Purpose**: Extracts token from various input formats

**Parameters**:
- `raw` (string): Raw input (token, URL, or invitation link)

**Returns**: (string) Extracted token

**Supported Formats**:
1. Plain token string
2. Full URL with `?token=` parameter
3. Relative URL with token parameter
4. String containing `token=` anywhere

```javascript
function extractToken(raw) {
    const candidate = (raw || '').trim();
    if (!candidate) return '';

    // Try parsing as full URL
    try {
        const maybeUrl = new URL(candidate);
        const qp = maybeUrl.searchParams.get('token');
        if (qp && qp.trim()) return qp.trim();
    } catch (_) {}

    // Try parsing as relative URL
    if (candidate.includes('?')) {
        try {
            const maybeUrl = new URL(candidate, window.location.origin);
            const qp = maybeUrl.searchParams.get('token');
            if (qp && qp.trim()) return qp.trim();
        } catch (_) {}

        // Try URLSearchParams directly
        try {
            const search = candidate.split('?')[1] || candidate;
            const params = new URLSearchParams(search);
            const qp = params.get('token');
            if (qp && qp.trim()) return qp.trim();
        } catch (_) {}
    }

    // Try regex extraction
    if (candidate.includes('token=')) {
        const match = candidate.match(/token=([^&\s]+)/i);
        if (match && match[1]) {
            try {
                return decodeURIComponent(match[1]).trim();
            } catch (_) {
                return match[1].trim();
            }
        }
    }

    return candidate.trim();
}
```

#### getTokenFromInput()

**Purpose**: Gets and normalizes token from input field

**Returns**: (string) Extracted token

```javascript
function getTokenFromInput() {
    if (!input) return '';
    const parsed = extractToken(input.value);
    if (parsed && parsed !== input.value) input.value = parsed;
    return parsed;
}
```

#### resolveToken()

**Purpose**: Resolves token from URL or input

**Returns**: (string) Token value

```javascript
function resolveToken() {
    const fromUrl = getTokenFromUrl();
    if (fromUrl) {
        if (input) input.value = fromUrl;
        return fromUrl;
    }
    return getTokenFromInput();
}
```

### Login Handler

#### doLogin(ev)

**Purpose**: Performs login request

**Parameters**:
- `ev` (Event): Form submit event

```javascript
async function doLogin(ev) {
    if (ev) ev.preventDefault();
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    if (err) err.textContent = '';

    const token = resolveToken();
    if (!token) {
        if (err) err.textContent = 'Enter the invitation link or token to continue.';
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
        return;
    }

    try {
        const res = await fetch(toEndpoint('auth'), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ token })
        });

        if (res.ok) {
            if (btn) btn.textContent = 'Welcome!';
            try { window.history.replaceState({}, document.title, homeHref); } catch(_) {}
            window.location.href = homeHref;
        } else {
            if (err) err.textContent = 'Token not recognised. Double-check the link and try again.';
            if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
        }
    } catch (e) {
        if (err) err.textContent = 'Network error. Please retry.';
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
    }
}
```

## Event Handlers

```javascript
// Form submission
if (form) form.addEventListener('submit', doLogin);
else if (btn) btn.addEventListener('click', doLogin);

// Auto-login if token in URL
const autoToken = getTokenFromUrl();
if (autoToken) {
    if (input) input.value = autoToken;
    doLogin();
} else if (input) {
    input.focus();
}
```

## Initialization Flow

```
┌────────────────────────────────────────────────────────────┐
│                    Login Initialization                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. goIfAuthed() - Check existing session                  │
│     │                                                      │
│     ├── If authenticated → Redirect to home               │
│     │                                                      │
│  2. Check URL for token                                    │
│     │                                                      │
│     ├── If token present → Auto-login                     │
│     │                                                      │
│     └── If no token → Focus input field                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `auth` | POST | Submit token for authentication |
| `whoami` | GET | Check session status |

## Error Messages

| Condition | Message |
|-----------|---------|
| Empty token | "Enter the invitation link or token to continue." |
| Invalid token | "Token not recognised. Double-check the link and try again." |
| Network error | "Network error. Please retry." |

## Related Modules

- [server-webtty-client.md](./server-webtty-client.md) - Main terminal UI
- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - Server handler
- [server-auth-handlers.md](../server-auth-handlers.md) - Authentication

