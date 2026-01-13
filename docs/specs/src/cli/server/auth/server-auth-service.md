# cli/server/auth/service.js - Auth Service

## Overview

Factory function that creates a comprehensive SSO authentication service. Handles the complete OAuth 2.0/OIDC flow including PKCE, token exchange, JWT validation, session management, and logout. Supports both user authentication and service-to-service (client credentials) authentication.

## Source File

`cli/server/auth/service.js`

## Dependencies

```javascript
import { loadAuthConfig } from './config.js';
import { createPkcePair } from './pkce.js';
import { decodeJwt, verifySignature, validateClaims } from './jwt.js';
import { createJwksCache } from './jwksCache.js';
import { createSessionStore } from './sessionStore.js';
import { createMetadataCache, buildAuthUrl, exchangeCodeForTokens, exchangeClientCredentials, refreshTokens, buildLogoutUrl } from './keycloakClient.js';
import { randomId } from './utils.js';
```

## Public API

### createAuthService(options)

**Purpose**: Creates an authentication service instance

**Parameters**:
- `options` (Object): Service options
  - `sessionOptions` (Object): Options for session store

**Returns**: Auth service object with methods

**Service Methods**:

| Method | Description |
|--------|-------------|
| `isConfigured()` | Check if SSO is configured |
| `reloadConfig()` | Reload configuration |
| `beginLogin(opts)` | Start OAuth login flow |
| `handleCallback(params)` | Handle OAuth callback |
| `getSession(sessionId)` | Get session by ID |
| `refreshSession(sessionId)` | Refresh session tokens |
| `logout(sessionId, opts)` | Logout and get redirect URL |
| `revokeSession(sessionId)` | Delete session |
| `getSessionCookieMaxAge()` | Get cookie max age |
| `authenticateAgent(clientId, clientSecret)` | Client credentials auth |

**Implementation**:
```javascript
function createAuthService(options = {}) {
    const sessionStore = createSessionStore(options.sessionOptions);
    const metadataCache = createMetadataCache();
    const jwksCache = createJwksCache();
    let config = loadAuthConfig();
    let lastConfigHash = null;

    function getConfigHash(cfg) {
        if (!cfg) return null;
        return JSON.stringify({
            baseUrl: cfg.baseUrl,
            realm: cfg.realm,
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            redirectUri: cfg.redirectUri,
            postLogoutRedirectUri: cfg.postLogoutRedirectUri,
            scope: cfg.scope
        });
    }

    function reloadConfig() {
        config = loadAuthConfig();
        metadataCache.clear();
        jwksCache.clear();
        lastConfigHash = getConfigHash(config);
    }

    function assertConfigured() {
        // Check if config needs reload (on first call or if env vars changed)
        const freshConfig = loadAuthConfig();
        const freshHash = getConfigHash(freshConfig);

        if (freshHash !== lastConfigHash) {
            config = freshConfig;
            metadataCache.clear();
            jwksCache.clear();
            lastConfigHash = freshHash;
        }

        if (!config) {
            throw new Error('SSO is not configured');
        }
        return config;
    }

    async function ensureMetadata() {
        const cfg = assertConfigured();
        return metadataCache.get(cfg);
    }

    // ... service methods implementation

    return {
        isConfigured,
        reloadConfig,
        beginLogin,
        handleCallback,
        getSession,
        refreshSession,
        logout,
        revokeSession,
        getSessionCookieMaxAge,
        authenticateAgent
    };
}
```

## Service Methods

### isConfigured()

**Purpose**: Checks if SSO configuration is available

**Returns**: (boolean) True if configured

**Implementation**:
```javascript
function isConfigured() {
    if (!config) {
        config = loadAuthConfig();
    }
    return Boolean(config);
}
```

### beginLogin({ baseUrl, returnTo, prompt })

**Purpose**: Initiates OAuth authorization code flow with PKCE

**Parameters**:
- `baseUrl` (string): Server base URL for redirect URI
- `returnTo` (string): URL to redirect after login (default: '/')
- `prompt` (string): OAuth prompt parameter (optional)

**Returns**: `{ redirectUrl: string, state: string }`

**Implementation**:
```javascript
async function beginLogin({ baseUrl, returnTo = '/', prompt } = {}) {
    const cfg = assertConfigured();
    const metadata = await ensureMetadata();
    const { verifier, challenge } = createPkcePair();
    const nonce = randomId(16);
    const redirectUri = resolveRedirectUri(baseUrl);
    const state = sessionStore.createPendingAuth({
        codeVerifier: verifier,
        redirectUri,
        returnTo,
        nonce
    });
    const authUrl = buildAuthUrl(metadata, cfg, {
        state,
        codeChallenge: challenge,
        redirectUri,
        scope: cfg.scope,
        nonce,
        prompt
    });
    return { redirectUrl: authUrl, state };
}
```

### handleCallback({ code, state, baseUrl })

**Purpose**: Handles OAuth callback, exchanges code for tokens, validates JWT

**Parameters**:
- `code` (string): Authorization code from IdP
- `state` (string): State parameter to validate
- `baseUrl` (string): Server base URL

**Returns**:
```javascript
{
    sessionId: string,
    user: {
        id: string,
        username: string,
        name: string,
        email: string|null,
        roles: string[],
        raw: Object
    },
    redirectTo: string,
    postLogoutRedirectUri: string,
    tokens: {
        accessToken: string,
        expiresAt: number
    }
}
```

**Implementation**:
```javascript
async function handleCallback({ code, state, baseUrl }) {
    const cfg = assertConfigured();
    const pending = sessionStore.consumePendingAuth(state);
    if (!pending) {
        throw new Error('Invalid or expired authorization state');
    }
    const metadata = await ensureMetadata();
    const tokens = await exchangeCodeForTokens(metadata, cfg, {
        code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.codeVerifier
    });
    if (!tokens || !tokens.id_token) {
        throw new Error('Token response missing id_token');
    }

    // Decode and verify ID token
    const decoded = decodeJwt(tokens.id_token);
    const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
    if (!jwk) {
        throw new Error('Unable to resolve signing key');
    }
    const signatureValid = verifySignature(decoded, jwk);
    if (!signatureValid) {
        throw new Error('Invalid token signature');
    }
    validateClaims(decoded.payload, {
        issuer: metadata.issuer,
        clientId: cfg.clientId,
        nonce: pending.nonce
    });

    // Calculate expiration times
    const now = Date.now();
    const accessExpires = tokens.expires_in ? now + Number(tokens.expires_in) * 1000 : now + sessionStore.sessionTtlMs;
    const refreshExpires = tokens.refresh_expires_in ? now + Number(tokens.refresh_expires_in) * 1000 : null;

    // Extract roles from ACCESS token (not ID token)
    const accessDecoded = tokens.access_token ? decodeJwt(tokens.access_token) : decoded;
    const realmRoles = accessDecoded.payload.realm_access?.roles || [];
    const resourceRoles = [];

    if (accessDecoded.payload.resource_access) {
        for (const [clientId, clientData] of Object.entries(accessDecoded.payload.resource_access)) {
            if (Array.isArray(clientData.roles)) {
                resourceRoles.push(...clientData.roles);
            }
        }
    }

    const allRoles = [...new Set([...realmRoles, ...resourceRoles])];

    const user = {
        id: decoded.payload.sub,
        username: decoded.payload.preferred_username || decoded.payload.username || decoded.payload.email || '',
        name: decoded.payload.name || decoded.payload.preferred_username || decoded.payload.email || '',
        email: decoded.payload.email || null,
        roles: allRoles,
        raw: decoded.payload
    };

    const { id: sessionId } = sessionStore.createSession({
        user,
        tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            idToken: tokens.id_token,
            scope: tokens.scope,
            tokenType: tokens.token_type
        },
        expiresAt: accessExpires,
        refreshExpiresAt: refreshExpires
    });

    const redirectTo = pending.returnTo || '/';
    const postLogoutRedirectUri = resolvePostLogoutUri(baseUrl);

    return {
        sessionId,
        user,
        redirectTo,
        postLogoutRedirectUri,
        tokens: {
            accessToken: tokens.access_token,
            expiresAt: accessExpires
        }
    };
}
```

### refreshSession(sessionId)

**Purpose**: Refreshes access token using refresh token

**Parameters**:
- `sessionId` (string): Session ID

**Returns**:
```javascript
{
    accessToken: string,
    expiresAt: number,
    scope: string,
    tokenType: string
}
```

**Throws**: Error if session not found or refresh token unavailable

### logout(sessionId, { baseUrl })

**Purpose**: Logs out user and returns redirect URL

**Parameters**:
- `sessionId` (string): Session ID
- `baseUrl` (string): Server base URL

**Returns**: `{ redirect: string }` - Logout redirect URL

### authenticateAgent(clientId, clientSecret)

**Purpose**: Authenticates an agent using client credentials flow

**Parameters**:
- `clientId` (string): Agent's OAuth client ID
- `clientSecret` (string): Agent's OAuth client secret

**Returns**:
```javascript
{
    agent: {
        name: string,
        clientId: string,
        allowedTargets: string[]
    },
    tokens: {
        accessToken: string,
        tokenType: string,
        expiresIn: number
    },
    expiresAt: number
}
```

**Implementation**:
```javascript
async function authenticateAgent(clientId, clientSecret) {
    const cfg = assertConfigured();
    const metadata = await ensureMetadata();

    const tokens = await exchangeClientCredentials(metadata, cfg, {
        clientId,
        clientSecret,
        scope: cfg.scope
    });

    if (!tokens || !tokens.access_token) {
        throw new Error('Token response missing access_token');
    }

    const decoded = decodeJwt(tokens.access_token);
    const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
    if (!jwk) {
        throw new Error('Unable to resolve signing key');
    }

    const signatureValid = verifySignature(decoded, jwk);
    if (!signatureValid) {
        throw new Error('Invalid token signature');
    }

    validateClaims(decoded.payload, {
        issuer: metadata.issuer
    });

    const agentName = decoded.payload.agent_name || clientId.replace(/^agent-/, '');
    const allowedTargets = decoded.payload.allowed_targets || [];

    const now = Date.now();
    const expiresAt = decoded.payload.exp ? decoded.payload.exp * 1000 : (now + 3600000);

    return {
        agent: {
            name: agentName,
            clientId,
            allowedTargets: Array.isArray(allowedTargets) ? allowedTargets : []
        },
        tokens: {
            accessToken: tokens.access_token,
            tokenType: tokens.token_type || 'Bearer',
            expiresIn: tokens.expires_in
        },
        expiresAt
    };
}
```

## Exports

```javascript
export { createAuthService };
```

## Usage Example

```javascript
import { createAuthService } from './service.js';

const authService = createAuthService();

// Check if configured
if (!authService.isConfigured()) {
    console.log('SSO not configured');
}

// Begin login
const { redirectUrl } = await authService.beginLogin({
    baseUrl: 'http://localhost:8080',
    returnTo: '/dashboard'
});
// Redirect user to redirectUrl

// Handle callback
const { sessionId, user } = await authService.handleCallback({
    code: 'auth_code_from_idp',
    state: 'state_from_query',
    baseUrl: 'http://localhost:8080'
});

// Get session
const session = authService.getSession(sessionId);

// Refresh tokens
const newTokens = await authService.refreshSession(sessionId);

// Logout
const { redirect } = await authService.logout(sessionId, {
    baseUrl: 'http://localhost:8080'
});
```

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    OAuth 2.0 + PKCE Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User clicks login                                           │
│     │                                                           │
│     ▼                                                           │
│  beginLogin() ─────────────────────────────────────────────────►│
│     │ Creates PKCE pair (verifier + challenge)                  │
│     │ Stores pending auth state                                 │
│     │ Returns authorization URL                                 │
│     │                                                           │
│  2. User redirects to Keycloak                                  │
│     │                                                           │
│  3. User authenticates at Keycloak                              │
│     │                                                           │
│  4. Keycloak redirects back with code                           │
│     │                                                           │
│     ▼                                                           │
│  handleCallback() ─────────────────────────────────────────────►│
│     │ Validates state, consumes pending auth                    │
│     │ Exchanges code for tokens (with PKCE verifier)            │
│     │ Validates JWT signature via JWKS                          │
│     │ Validates claims (issuer, audience, nonce, exp)           │
│     │ Extracts user info and roles                              │
│     │ Creates session                                           │
│     │ Returns session ID and user                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Related Modules

- [server-auth-config.md](./server-auth-config.md) - Configuration loading
- [server-auth-jwt.md](./server-auth-jwt.md) - JWT operations
- [server-auth-pkce.md](./server-auth-pkce.md) - PKCE generation
- [server-auth-session-store.md](./server-auth-session-store.md) - Session storage
- [server-auth-keycloak-client.md](./server-auth-keycloak-client.md) - Keycloak API
- [server-auth-jwks-cache.md](./server-auth-jwks-cache.md) - JWKS caching
