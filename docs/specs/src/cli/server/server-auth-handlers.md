# cli/server/authHandlers.js - Authentication Handlers

## Overview

Provides HTTP handlers for SSO authentication routes including login, callback, logout, and token management. Integrates with Keycloak/OIDC for user authentication and supports agent-to-agent authentication via client credentials.

## Source File

`cli/server/authHandlers.js`

## Dependencies

```javascript
import { appendLog } from './utils/logger.js';
import { parseCookies, buildCookie, readJsonBody, appendSetCookie } from './handlers/common.js';
import { resolveVarValue } from '../services/secretVars.js';
import { createAuthService } from './auth/service.js';
import { decodeJwt, verifySignature, validateClaims } from './auth/jwt.js';
import { createJwksCache } from './auth/jwksCache.js';
import { loadAuthConfig } from './auth/config.js';
import { createMetadataCache } from './auth/keycloakClient.js';
```

## Constants & Configuration

```javascript
const AUTH_COOKIE_NAME = 'ploinky_sso';
const authService = createAuthService();
const jwksCache = createJwksCache();
const agentMetadataCache = createMetadataCache();
```

## Internal Functions

### getRequestBaseUrl(req)

**Purpose**: Extracts base URL from request headers for redirect construction

**Parameters**:
- `req` (http.IncomingMessage): HTTP request

**Returns**: (string|null) Base URL or null

**Implementation**:
```javascript
function getRequestBaseUrl(req) {
    const headers = req.headers || {};
    const forwardedProto = headers['x-forwarded-proto'];
    const forwardedHost = headers['x-forwarded-host'] || headers['host'];
    const proto = forwardedProto
        ? String(forwardedProto).split(',')[0].trim()
        : (req.socket && req.socket.encrypted ? 'https' : 'http');
    if (!forwardedHost) return null;
    return `${proto}://${forwardedHost}`;
}
```

### wantsJsonResponse(req, pathname)

**Purpose**: Determines if client expects JSON response

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `pathname` (string): Request path

**Returns**: (boolean) True if JSON response expected

**Implementation**:
```javascript
function wantsJsonResponse(req, pathname) {
    const accept = String(req.headers?.accept || '').toLowerCase();
    if (accept.includes('application/json')) return true;
    if (accept.includes('text/event-stream')) return true;
    if (!pathname) return false;
    return pathname.startsWith('/apis/') || pathname.startsWith('/api/') || pathname.startsWith('/blobs');
}
```

### respondUnauthenticated(req, res, parsedUrl)

**Purpose**: Responds to unauthenticated requests with login redirect or 401

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `parsedUrl` (URL): Parsed URL object

**Returns**: `{ ok: false }`

**Behavior**:
- Clears auth cookie
- Returns JSON 401 for API/non-GET requests
- Returns 302 redirect to login for browser requests

**Implementation**:
```javascript
function respondUnauthenticated(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    const returnTo = parsedUrl.path || pathname || '/';
    const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    const clearCookie = buildCookie(AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0 });
    const method = (req.method || 'GET').toUpperCase();
    const wantsJson = wantsJsonResponse(req, pathname) || method !== 'GET';
    if (wantsJson) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookie
        });
        res.end(JSON.stringify({ ok: false, error: 'not_authenticated', login: loginUrl }));
    } else {
        res.writeHead(302, {
            Location: loginUrl,
            'Set-Cookie': clearCookie
        });
        res.end('Authentication required');
    }
    return { ok: false };
}
```

## Public API

### sendJson(res, statusCode, body)

**Purpose**: Sends JSON response

**Parameters**:
- `res` (http.ServerResponse): HTTP response
- `statusCode` (number): HTTP status code
- `body` (Object): Response body

**Implementation**:
```javascript
export function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body || {});
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(payload);
}
```

### buildIdentityHeaders(req)

**Purpose**: Builds identity headers from authenticated request for proxying

**Parameters**:
- `req` (http.IncomingMessage): Authenticated request with user info

**Returns**: (Object) Headers object with user identity

**Headers Produced**:
- `X-Ploinky-User-Id`: User ID
- `X-Ploinky-User`: Username or email
- `X-Ploinky-User-Email`: Email address
- `X-Ploinky-User-Roles`: Comma-separated roles
- `X-Ploinky-Session-Id`: Session identifier
- `Authorization`: Bearer token if available

**Implementation**:
```javascript
export function buildIdentityHeaders(req) {
    if (!req || !req.user) return {};
    const headers = {};
    const user = req.user || {};
    if (user.id) headers['X-Ploinky-User-Id'] = String(user.id);
    const name = user.username || user.email || user.name || user.id;
    if (name) headers['X-Ploinky-User'] = String(name);
    if (user.email) headers['X-Ploinky-User-Email'] = String(user.email);
    if (Array.isArray(user.roles) && user.roles.length) {
        headers['X-Ploinky-User-Roles'] = user.roles.join(',');
    }
    if (req.sessionId) headers['X-Ploinky-Session-Id'] = String(req.sessionId);
    if (req.session?.tokens?.accessToken) {
        headers['Authorization'] = `Bearer ${req.session.tokens.accessToken}`;
    }
    return headers;
}
```

### ensureAgentAuthenticated(req, res, parsedUrl)

**Purpose**: Validates agent-to-agent authentication via Bearer token

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `parsedUrl` (URL): Parsed URL

**Returns**: `{ ok: boolean, agent?: Object, error?: string }`

**Behavior**:
1. Extracts Bearer token from Authorization header
2. Decodes JWT
3. Fetches JWKS from Keycloak
4. Verifies token signature
5. Validates claims (issuer, expiry)
6. Extracts agent info (name, clientId, allowedTargets)

**Implementation**:
```javascript
export async function ensureAgentAuthenticated(req, res, parsedUrl) {
    if (!authService.isConfigured()) {
        return { ok: false, error: 'sso_not_configured' };
    }

    const authHeader = req.headers?.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
        return { ok: false, error: 'missing_authorization_header' };
    }

    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
        return { ok: false, error: 'invalid_authorization_header' };
    }

    const token = bearerMatch[1];

    try {
        const decoded = decodeJwt(token);
        const config = loadAuthConfig();
        if (!config) {
            return { ok: false, error: 'sso_not_configured' };
        }

        const metadata = await agentMetadataCache.get(config);
        const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
        if (!jwk) {
            return { ok: false, error: 'unable_to_resolve_signing_key' };
        }

        const signatureValid = verifySignature(decoded, jwk);
        if (!signatureValid) {
            return { ok: false, error: 'invalid_token_signature' };
        }

        validateClaims(decoded.payload, { issuer: metadata.issuer });

        const agentName = decoded.payload.agent_name || 'unknown';
        const allowedTargets = decoded.payload.allowed_targets || [];

        req.agent = {
            name: agentName,
            clientId: decoded.payload.client_id || decoded.payload.aud,
            allowedTargets: Array.isArray(allowedTargets) ? allowedTargets : []
        };

        return { ok: true, agent: req.agent };
    } catch (err) {
        appendLog('auth_agent_token_validation_error', { error: err?.message || String(err) });
        return { ok: false, error: 'token_validation_failed', detail: err?.message || String(err) };
    }
}
```

### ensureAuthenticated(req, res, parsedUrl)

**Purpose**: Validates user session authentication

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `parsedUrl` (URL): Parsed URL

**Returns**: `{ ok: boolean, session?: Object }`

**Behavior**:
1. Returns ok if SSO not configured
2. Checks for session cookie
3. Validates and refreshes session if needed
4. Attaches user info to request
5. Refreshes session cookie

**Implementation**:
```javascript
export async function ensureAuthenticated(req, res, parsedUrl) {
    if (!authService.isConfigured()) {
        return { ok: true };
    }
    const cookies = parseCookies(req);
    const sessionId = cookies.get(AUTH_COOKIE_NAME);
    if (!sessionId) {
        appendLog('auth_missing_cookie', { path: parsedUrl.pathname });
        return respondUnauthenticated(req, res, parsedUrl);
    }
    let session = authService.getSession(sessionId);
    if (!session || (session.expiresAt && Date.now() > session.expiresAt)) {
        try {
            await authService.refreshSession(sessionId);
        } catch (err) {
            appendLog('auth_refresh_failed', { error: err?.message || String(err) });
        }
        session = authService.getSession(sessionId);
    }
    if (!session) {
        appendLog('auth_session_invalid', { sessionId: '[redacted]' });
        return respondUnauthenticated(req, res, parsedUrl);
    }
    req.user = session.user;
    req.session = session;
    req.sessionId = sessionId;
    try {
        const cookie = buildCookie(AUTH_COOKIE_NAME, sessionId, req, '/', {
            maxAge: authService.getSessionCookieMaxAge()
        });
        appendSetCookie(res, cookie);
    } catch (_) { }
    return { ok: true, session };
}
```

### handleAuthRoutes(req, res, parsedUrl)

**Purpose**: Main handler for /auth/* routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `parsedUrl` (URL): Parsed URL

**Returns**: (boolean) True if route was handled

**Routes**:

| Route | Method | Description |
|-------|--------|-------------|
| `/auth/login` | GET | Redirects to identity provider |
| `/auth/callback` | GET | Handles OIDC callback with code exchange |
| `/auth/logout` | GET/POST | Logs out user, clears session |
| `/auth/token` | GET/POST | Returns current token info, optionally refreshes |
| `/auth/agent-token` | POST | Issues token for agent authentication |

**Implementation**:
```javascript
export async function handleAuthRoutes(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    if (!pathname.startsWith('/auth/')) return false;
    if (!authService.isConfigured()) {
        sendJson(res, 503, { ok: false, error: 'sso_disabled' });
        return true;
    }
    const method = (req.method || 'GET').toUpperCase();
    const baseUrl = getRequestBaseUrl(req);

    try {
        if (pathname === '/auth/login') {
            if (method !== 'GET') { res.writeHead(405); res.end(); return true; }
            const returnTo = parsedUrl.searchParams.get('returnTo') || '/';
            const prompt = parsedUrl.searchParams.get('prompt') || undefined;
            const { redirectUrl } = await authService.beginLogin({ baseUrl, returnTo, prompt });
            res.writeHead(302, { Location: redirectUrl });
            res.end('Redirecting to identity provider...');
            appendLog('auth_login_redirect', { returnTo });
            return true;
        }

        if (pathname === '/auth/callback') {
            if (method !== 'GET') { res.writeHead(405); res.end(); return true; }
            const code = parsedUrl.searchParams.get('code') || '';
            const state = parsedUrl.searchParams.get('state') || '';
            if (!code || !state) {
                sendJson(res, 400, { ok: false, error: 'missing_parameters' });
                return true;
            }
            const result = await authService.handleCallback({ code, state, baseUrl });
            const cookie = buildCookie(AUTH_COOKIE_NAME, result.sessionId, req, '/', {
                maxAge: authService.getSessionCookieMaxAge()
            });
            res.writeHead(302, {
                Location: result.redirectTo || '/',
                'Set-Cookie': cookie
            });
            res.end('Login successful');
            appendLog('auth_callback_success', { user: result.user?.id });
            return true;
        }

        if (pathname === '/auth/logout') {
            if (method !== 'GET' && method !== 'POST') { res.writeHead(405); res.end(); return true; }
            const cookies = parseCookies(req);
            const sessionId = cookies.get(AUTH_COOKIE_NAME) || '';
            const outcome = await authService.logout(sessionId, { baseUrl });
            const clearCookie = buildCookie(AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0 });
            const redirectTarget = parsedUrl.searchParams.get('returnTo') || outcome.redirect;
            if (method === 'GET' || redirectTarget) {
                res.writeHead(302, { Location: redirectTarget || '/', 'Set-Cookie': clearCookie });
                res.end('Logged out');
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie });
                res.end(JSON.stringify({ ok: true }));
            }
            appendLog('auth_logout', { sessionId: sessionId ? '[redacted]' : null });
            return true;
        }

        if (pathname === '/auth/token') {
            // Returns token info, optionally refreshes
            // ... (token handling implementation)
            return true;
        }

        if (pathname === '/auth/agent-token') {
            if (method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
                res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                return true;
            }
            const body = await readJsonBody(req);
            const clientId = body?.client_id || body?.clientId;
            const clientSecret = body?.client_secret || body?.clientSecret;

            if (!clientId || !clientSecret) {
                sendJson(res, 400, { ok: false, error: 'missing_parameters' });
                return true;
            }

            const result = await authService.authenticateAgent(clientId, clientSecret);
            appendLog('auth_agent_token_success', { agent: result.agent.name });

            sendJson(res, 200, {
                ok: true,
                access_token: result.tokens.accessToken,
                expires_in: result.tokens.expiresIn,
                token_type: result.tokens.tokenType
            });
            return true;
        }
    } catch (err) {
        appendLog('auth_error', { error: err?.message || String(err) });
        sendJson(res, 500, { ok: false, error: 'auth_failure', detail: err?.message || String(err) });
        return true;
    }

    res.writeHead(404); res.end('Not Found');
    return true;
}
```

### getAppName()

**Purpose**: Gets application name from secrets or environment

**Returns**: (string|null) App name or null

**Implementation**:
```javascript
export function getAppName() {
    const secretName = resolveVarValue('APP_NAME');
    const fromSecrets = secretName && String(secretName).trim();
    if (fromSecrets) return fromSecrets;
    const raw = process.env.APP_NAME;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed.length ? trimmed : null;
}
```

## Exports

```javascript
export {
    AUTH_COOKIE_NAME,
    authService,
    buildIdentityHeaders,
    ensureAgentAuthenticated,
    ensureAuthenticated,
    getAppName,
    handleAuthRoutes,
    sendJson
};
```

## Authentication Flow

```
User Login:
1. GET /auth/login?returnTo=/dashboard
2. → Redirect to Keycloak authorization endpoint
3. User authenticates with Keycloak
4. Keycloak redirects to /auth/callback?code=xxx&state=yyy
5. Exchange code for tokens
6. Create session, set cookie
7. Redirect to returnTo URL

Agent Authentication:
1. POST /auth/agent-token { client_id, client_secret }
2. Validate credentials with Keycloak
3. Return access_token for agent-to-agent calls
```

## Usage Example

```javascript
import {
    ensureAuthenticated,
    handleAuthRoutes,
    buildIdentityHeaders
} from './authHandlers.js';

// In route handler
async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, 'http://localhost');

    // Handle auth routes first
    if (await handleAuthRoutes(req, res, parsedUrl)) {
        return;
    }

    // Check authentication
    const authResult = await ensureAuthenticated(req, res, parsedUrl);
    if (!authResult.ok) {
        return; // Response already sent
    }

    // Build headers for proxy
    const identityHeaders = buildIdentityHeaders(req);
    // ... proxy request with identityHeaders
}
```

## Related Modules

- [server-auth-service.md](./auth/server-auth-service.md) - Auth service
- [server-auth-jwt.md](./auth/server-auth-jwt.md) - JWT utilities
- [server-handlers-common.md](./handlers/server-handlers-common.md) - Cookie helpers
