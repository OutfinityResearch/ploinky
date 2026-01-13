# cli/server/webmeet/login.js - WebMeet Login Page

## Overview

Client-side JavaScript for the WebMeet login page. Handles token-based authentication with support for direct token input, URL query parameters, and full meeting links. Auto-login when token is present in URL.

## Source File

`cli/server/webmeet/login.js`

## DOM Elements

```javascript
const err = document.getElementById('err');
const btn = document.getElementById('btn');
const form = document.getElementById('tokenForm');
const input = document.getElementById('tokenInput');
```

## Configuration

```javascript
const basePath = String(document.body.dataset.base || '').replace(/\/$/, '');
const homeHref = basePath ? `${basePath}/` : '/webmeet';
const toEndpoint = (path) => {
    const suffix = String(path || '').replace(/^\/+/, '');
    return (basePath ? basePath : '') + '/' + suffix;
};
```

## Functions

### goIfAuthed()

**Purpose**: Redirects to meeting if already authenticated

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

### getTokenFromUrl()

**Purpose**: Extracts token from URL query string

**Returns**: (string) Token or empty string

### extractToken(raw)

**Purpose**: Extracts token from various input formats

**Supported Formats**:
1. Plain token string
2. Full URL with `?token=` parameter
3. Relative URL with token parameter
4. URLSearchParams extraction
5. Regex extraction for `token=`

```javascript
function extractToken(raw) {
    const candidate = (raw || '').trim();
    if (!candidate) return '';

    // Try full URL
    try {
        const maybeUrl = new URL(candidate);
        const qp = maybeUrl.searchParams.get('token');
        if (qp && qp.trim()) return qp.trim();
    } catch (_) {}

    // Try relative URL
    if (candidate.includes('?')) {
        try {
            const maybeUrl = new URL(candidate, window.location.origin);
            const qp = maybeUrl.searchParams.get('token');
            if (qp && qp.trim()) return qp.trim();
        } catch (_) {}

        // Try URLSearchParams
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
            try { return decodeURIComponent(match[1]).trim(); }
            catch (_) { return match[1].trim(); }
        }
    }

    return candidate;
}
```

### resolveToken()

**Purpose**: Resolves token from URL or input field

```javascript
function resolveToken() {
    const fromUrl = getTokenFromUrl();
    if (fromUrl) {
        if (input) input.value = fromUrl;
        return fromUrl;
    }
    if (!input) return '';
    const parsed = extractToken(input.value);
    if (parsed && parsed !== input.value) input.value = parsed;
    return parsed;
}
```

### performLogin(ev)

**Purpose**: Performs login request

```javascript
async function performLogin(ev) {
    if (ev) ev.preventDefault();
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    if (err) err.textContent = '';

    const token = resolveToken();
    if (!token) {
        if (err) err.textContent = 'Paste the meeting link or token to continue.';
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
        return;
    }

    try {
        const res = await fetch(toEndpoint('auth'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        if (res.ok) {
            if (btn) btn.textContent = 'Room unlocked';
            try { window.history.replaceState({}, document.title, homeHref); }
            catch(_) {}
            window.location.href = homeHref;
        } else {
            if (err) err.textContent = 'Token not recognised. Please confirm with the moderator.';
            if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
        }
    } catch (_) {
        if (err) err.textContent = 'Network error. Try again.';
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
    }
}
```

## Event Handlers

```javascript
// Form submission
if (form) form.addEventListener('submit', performLogin);
else if (btn) btn.addEventListener('click', performLogin);

// Auto-login if token in URL
const autoToken = getTokenFromUrl();
if (autoToken) {
    if (input) input.value = autoToken;
    performLogin();
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
│     ├── If authenticated → Redirect to meeting             │
│                                                            │
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
| Empty token | "Paste the meeting link or token to continue." |
| Invalid token | "Token not recognised. Please confirm with the moderator." |
| Network error | "Network error. Try again." |

## Related Modules

- [server-webmeet-client.md](./server-webmeet-client.md) - Main meeting UI
- [server-handlers-webmeet.md](../handlers/server-handlers-webmeet.md) - Server handler

