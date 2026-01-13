# cli/server/auth/sessionStore.js - Session Store

## Overview

In-memory session storage for SSO authentication. Manages user sessions and pending authentication states with automatic expiration cleanup.

## Source File

`cli/server/auth/sessionStore.js`

## Dependencies

```javascript
import { randomId } from './utils.js';
```

## Constants

```javascript
const DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;      // 5 minutes
```

## Public API

### createSessionStore(options)

**Purpose**: Creates a session store instance

**Parameters**:
- `options` (Object):
  - `sessionTtlMs` (number): Session TTL in ms (default: 4 hours)
  - `pendingTtlMs` (number): Pending auth TTL in ms (default: 5 minutes)

**Returns**: Session store object

**Store Methods**:

| Method | Description |
|--------|-------------|
| `createPendingAuth(data)` | Create pending auth state |
| `consumePendingAuth(state)` | Consume and return pending auth |
| `createSession(record)` | Create new session |
| `getSession(sessionId)` | Get session by ID |
| `updateSession(sessionId, updates)` | Update session |
| `deleteSession(sessionId)` | Delete session |
| `getAllSessions()` | Get all valid sessions |

**Implementation**:
```javascript
function createSessionStore({ sessionTtlMs = DEFAULT_SESSION_TTL_MS, pendingTtlMs = DEFAULT_PENDING_TTL_MS } = {}) {
    const sessions = new Map();
    const pending = new Map();

    function cleanupPending() {
        const now = Date.now();
        for (const [state, entry] of pending.entries()) {
            if (now - entry.createdAt > pendingTtlMs) {
                pending.delete(state);
            }
        }
    }

    function cleanupSessions() {
        const now = Date.now();
        for (const [sid, session] of sessions.entries()) {
            if (session.expiresAt && now > session.expiresAt) {
                sessions.delete(sid);
            }
        }
    }

    // ... method implementations

    return {
        sessionTtlMs,
        pendingTtlMs,
        createPendingAuth,
        consumePendingAuth,
        createSession,
        getSession,
        updateSession,
        deleteSession,
        getAllSessions
    };
}
```

## Store Methods

### createPendingAuth(data)

**Purpose**: Creates pending authentication state

**Parameters**:
- `data` (Object): Data to store (codeVerifier, redirectUri, returnTo, nonce)

**Returns**: (string) State token

**Implementation**:
```javascript
function createPendingAuth(data) {
    cleanupPending();
    const state = randomId(16);
    pending.set(state, { ...data, createdAt: Date.now() });
    return state;
}
```

### consumePendingAuth(state)

**Purpose**: Retrieves and removes pending auth state

**Parameters**:
- `state` (string): State token

**Returns**: (Object|null) Pending auth data or null if invalid/expired

**Implementation**:
```javascript
function consumePendingAuth(state) {
    cleanupPending();
    const entry = pending.get(state);
    if (!entry) return null;
    pending.delete(state);
    if (Date.now() - entry.createdAt > pendingTtlMs) return null;
    return entry;
}
```

### createSession(record)

**Purpose**: Creates a new user session

**Parameters**:
- `record` (Object):
  - `user` (Object): User information
  - `tokens` (Object): OAuth tokens
  - `expiresAt` (number): Session expiration timestamp
  - `refreshExpiresAt` (number): Refresh token expiration

**Returns**: `{ id: string, session: Object }`

**Session Structure**:
```javascript
{
    id: string,
    user: {
        id: string,
        username: string,
        name: string,
        email: string,
        roles: string[],
        raw: Object
    },
    tokens: {
        accessToken: string,
        refreshToken: string,
        idToken: string,
        scope: string,
        tokenType: string
    },
    createdAt: number,
    updatedAt: number,
    expiresAt: number,
    refreshExpiresAt: number|null
}
```

**Implementation**:
```javascript
function createSession(record) {
    cleanupSessions();
    const sid = randomId(24);
    const now = Date.now();
    const expiresAt = record.expiresAt || (now + sessionTtlMs);
    const session = {
        id: sid,
        user: record.user,
        tokens: record.tokens,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        refreshExpiresAt: record.refreshExpiresAt || null
    };
    sessions.set(sid, session);
    return { id: sid, session };
}
```

### getSession(sessionId)

**Purpose**: Retrieves session by ID

**Parameters**:
- `sessionId` (string): Session ID

**Returns**: (Object|null) Session or null if not found/expired

**Behavior**:
- Runs cleanup before lookup
- Returns null for expired sessions
- Updates `updatedAt` on access

**Implementation**:
```javascript
function getSession(sessionId) {
    if (!sessionId) return null;
    cleanupSessions();
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt && Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        return null;
    }
    session.updatedAt = Date.now();
    return session;
}
```

### updateSession(sessionId, updates)

**Purpose**: Updates session data

**Parameters**:
- `sessionId` (string): Session ID
- `updates` (Object):
  - `tokens` (Object): Token updates (merged)
  - `expiresAt` (number): New expiration
  - `refreshExpiresAt` (number): New refresh expiration

**Returns**: (Object|null) Updated session or null if not found

**Implementation**:
```javascript
function updateSession(sessionId, updates) {
    const session = getSession(sessionId);
    if (!session) return null;
    if (updates.tokens) {
        session.tokens = { ...session.tokens, ...updates.tokens };
    }
    if (updates.expiresAt) {
        session.expiresAt = updates.expiresAt;
    }
    if (updates.refreshExpiresAt !== undefined) {
        session.refreshExpiresAt = updates.refreshExpiresAt;
    }
    session.updatedAt = Date.now();
    sessions.set(sessionId, session);
    return session;
}
```

### deleteSession(sessionId)

**Purpose**: Deletes a session

**Parameters**:
- `sessionId` (string): Session ID

**Implementation**:
```javascript
function deleteSession(sessionId) {
    if (!sessionId) return;
    sessions.delete(sessionId);
}
```

### getAllSessions()

**Purpose**: Gets all valid (non-expired) sessions

**Returns**: (Array) Array of session objects

**Implementation**:
```javascript
function getAllSessions() {
    cleanupSessions();
    return Array.from(sessions.values());
}
```

## Exports

```javascript
export { createSessionStore };
```

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Session Lifecycle                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pending Auth                    Session                        │
│  ┌──────────┐                    ┌──────────┐                   │
│  │ Created  │                    │ Created  │                   │
│  │ (5 min)  │                    │ (4 hrs)  │                   │
│  └────┬─────┘                    └────┬─────┘                   │
│       │                               │                         │
│       │ consumePendingAuth()          │ getSession()            │
│       ▼                               ▼                         │
│  ┌──────────┐                    ┌──────────┐                   │
│  │ Consumed │                    │  Active  │◄─┐                │
│  │ (deleted)│                    │          │  │ updateSession()│
│  └──────────┘                    └────┬─────┘──┘                │
│       │                               │                         │
│       │ TTL expired                   │ deleteSession() or      │
│       ▼                               │ TTL expired             │
│  ┌──────────┐                         ▼                         │
│  │ Cleaned  │                    ┌──────────┐                   │
│  │   up     │                    │ Deleted  │                   │
│  └──────────┘                    └──────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { createSessionStore } from './sessionStore.js';

const store = createSessionStore({
    sessionTtlMs: 2 * 60 * 60 * 1000, // 2 hours
    pendingTtlMs: 10 * 60 * 1000      // 10 minutes
});

// Create pending auth for login
const state = store.createPendingAuth({
    codeVerifier: 'pkce-verifier',
    redirectUri: 'http://localhost:8080/auth/callback',
    returnTo: '/dashboard',
    nonce: 'random-nonce'
});

// Later, consume pending auth
const pending = store.consumePendingAuth(state);
if (!pending) {
    throw new Error('Invalid or expired state');
}

// Create session after successful auth
const { id: sessionId, session } = store.createSession({
    user: { id: 'user-123', username: 'john', roles: ['user'] },
    tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token'
    },
    expiresAt: Date.now() + 3600000
});

// Get session
const currentSession = store.getSession(sessionId);

// Update tokens after refresh
store.updateSession(sessionId, {
    tokens: { accessToken: 'new-access-token' },
    expiresAt: Date.now() + 3600000
});

// Logout
store.deleteSession(sessionId);
```

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses session store
- [server-auth-utils.md](./server-auth-utils.md) - Random ID generation
