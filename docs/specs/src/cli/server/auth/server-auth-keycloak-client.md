# cli/server/auth/keycloakClient.js - Keycloak Client

## Overview

Provides Keycloak/OIDC client functionality including metadata discovery, authorization URL building, token exchange, token refresh, and logout URL generation.

## Source File

`cli/server/auth/keycloakClient.js`

## Dependencies

```javascript
import { URL } from 'url';
```

## Constants

```javascript
const METADATA_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

## Internal Functions

### ensureTrailingSlash(url)

**Purpose**: Ensures URL has trailing slash

**Parameters**:
- `url` (string): URL to check

**Returns**: (string) URL with trailing slash

### buildRealmBase(baseUrl, realm)

**Purpose**: Constructs Keycloak realm base URL

**Parameters**:
- `baseUrl` (string): Keycloak server base URL
- `realm` (string): Realm name

**Returns**: (string) Full realm URL

**Implementation**:
```javascript
function buildRealmBase(baseUrl, realm) {
    return `${ensureTrailingSlash(baseUrl)}realms/${encodeURIComponent(realm)}`;
}
```

### toFormBody(params)

**Purpose**: Converts object to URL-encoded form body

**Parameters**:
- `params` (Object): Key-value pairs

**Returns**: (string) URL-encoded string

**Implementation**:
```javascript
function toFormBody(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    return search.toString();
}
```

### fetchJson(url, options)

**Purpose**: Fetches JSON from URL with error handling

**Parameters**:
- `url` (string): Request URL
- `options` (Object): Fetch options

**Returns**: (Promise<Object>) Parsed JSON response

**Throws**: Error with status and body on failure

## Public API

### createMetadataCache()

**Purpose**: Creates a cache for OIDC discovery metadata

**Returns**: Cache object with `get(config)` and `clear()` methods

**TTL**: 5 minutes

**Implementation**:
```javascript
function createMetadataCache() {
    const cache = new Map(); // key -> { fetchedAt, data }
    return {
        async get(config) {
            const key = `${config.baseUrl}|${config.realm}`;
            const cached = cache.get(key);
            if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) {
                return cached.data;
            }
            const realmBase = buildRealmBase(config.baseUrl, config.realm);
            const url = `${realmBase}/.well-known/openid-configuration`;
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) {
                throw new Error(`Failed to fetch OpenID configuration (${res.status})`);
            }
            const data = await res.json();
            cache.set(key, { fetchedAt: Date.now(), data });
            return data;
        },
        clear() {
            cache.clear();
        }
    };
}
```

### buildAuthUrl(metadata, config, options)

**Purpose**: Builds OAuth authorization URL with PKCE

**Parameters**:
- `metadata` (Object): OIDC discovery metadata
- `config` (Object): Auth configuration
- `options` (Object):
  - `state` (string): OAuth state parameter
  - `codeChallenge` (string): PKCE code challenge
  - `redirectUri` (string): Callback URL
  - `scope` (string): OAuth scopes
  - `nonce` (string): OIDC nonce (optional)
  - `prompt` (string): OAuth prompt (optional)

**Returns**: (string) Authorization URL

**Implementation**:
```javascript
function buildAuthUrl(metadata, config, { state, codeChallenge, redirectUri, scope, nonce, prompt }) {
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('scope', scope || config.scope || 'openid');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (nonce) authUrl.searchParams.set('nonce', nonce);
    if (prompt) authUrl.searchParams.set('prompt', prompt);
    return authUrl.toString();
}
```

### exchangeCodeForTokens(metadata, config, options)

**Purpose**: Exchanges authorization code for tokens

**Parameters**:
- `metadata` (Object): OIDC discovery metadata
- `config` (Object): Auth configuration
- `options` (Object):
  - `code` (string): Authorization code
  - `redirectUri` (string): Redirect URI used in auth request
  - `codeVerifier` (string): PKCE code verifier

**Returns**: (Promise<Object>) Token response
```javascript
{
    access_token: string,
    id_token: string,
    refresh_token: string,
    token_type: string,
    expires_in: number,
    refresh_expires_in: number,
    scope: string
}
```

**Implementation**:
```javascript
async function exchangeCodeForTokens(metadata, config, { code, redirectUri, codeVerifier }) {
    const body = toFormBody({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
        client_secret: config.clientSecret || undefined
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}
```

### exchangeClientCredentials(metadata, config, options)

**Purpose**: Exchanges client credentials for tokens (service-to-service)

**Parameters**:
- `metadata` (Object): OIDC discovery metadata
- `config` (Object): Auth configuration
- `options` (Object):
  - `clientId` (string): Client ID
  - `clientSecret` (string): Client secret
  - `scope` (string): OAuth scopes

**Returns**: (Promise<Object>) Token response

**Implementation**:
```javascript
async function exchangeClientCredentials(metadata, config, { clientId, clientSecret, scope }) {
    const body = toFormBody({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope || config.scope || 'openid'
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}
```

### refreshTokens(metadata, config, refreshToken)

**Purpose**: Refreshes access token using refresh token

**Parameters**:
- `metadata` (Object): OIDC discovery metadata
- `config` (Object): Auth configuration
- `refreshToken` (string): Refresh token

**Returns**: (Promise<Object>) New token response

**Implementation**:
```javascript
async function refreshTokens(metadata, config, refreshToken) {
    const body = toFormBody({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret || undefined
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}
```

### buildLogoutUrl(metadata, config, options)

**Purpose**: Builds OIDC logout URL

**Parameters**:
- `metadata` (Object): OIDC discovery metadata
- `config` (Object): Auth configuration
- `options` (Object):
  - `idTokenHint` (string): ID token for logout
  - `postLogoutRedirectUri` (string): Where to redirect after logout

**Returns**: (string|null) Logout URL or null if not supported

**Implementation**:
```javascript
function buildLogoutUrl(metadata, config, { idTokenHint, postLogoutRedirectUri }) {
    if (!metadata.end_session_endpoint) return null;
    const url = new URL(metadata.end_session_endpoint);
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
    const redirect = postLogoutRedirectUri || config.postLogoutRedirectUri || config.redirectUri;
    if (redirect) url.searchParams.set('post_logout_redirect_uri', redirect);
    url.searchParams.set('client_id', config.clientId);
    return url.toString();
}
```

## Exports

```javascript
export {
    createMetadataCache,
    buildAuthUrl,
    exchangeCodeForTokens,
    exchangeClientCredentials,
    refreshTokens,
    buildLogoutUrl
};
```

## OIDC Metadata Structure

Discovery endpoint returns:
```javascript
{
    issuer: "https://keycloak.example.com/realms/ploinky",
    authorization_endpoint: "https://keycloak.example.com/realms/ploinky/protocol/openid-connect/auth",
    token_endpoint: "https://keycloak.example.com/realms/ploinky/protocol/openid-connect/token",
    end_session_endpoint: "https://keycloak.example.com/realms/ploinky/protocol/openid-connect/logout",
    jwks_uri: "https://keycloak.example.com/realms/ploinky/protocol/openid-connect/certs",
    // ... other metadata
}
```

## Usage Example

```javascript
import {
    createMetadataCache,
    buildAuthUrl,
    exchangeCodeForTokens,
    refreshTokens,
    buildLogoutUrl
} from './keycloakClient.js';

const metadataCache = createMetadataCache();
const config = {
    baseUrl: 'https://keycloak.example.com',
    realm: 'ploinky',
    clientId: 'ploinky-router',
    scope: 'openid profile email'
};

// Get metadata
const metadata = await metadataCache.get(config);

// Build authorization URL
const authUrl = buildAuthUrl(metadata, config, {
    state: 'random-state',
    codeChallenge: 'pkce-challenge',
    redirectUri: 'http://localhost:8080/auth/callback',
    scope: 'openid profile email'
});

// Exchange code for tokens
const tokens = await exchangeCodeForTokens(metadata, config, {
    code: 'authorization-code',
    redirectUri: 'http://localhost:8080/auth/callback',
    codeVerifier: 'pkce-verifier'
});

// Refresh tokens
const newTokens = await refreshTokens(metadata, config, tokens.refresh_token);

// Build logout URL
const logoutUrl = buildLogoutUrl(metadata, config, {
    idTokenHint: tokens.id_token,
    postLogoutRedirectUri: 'http://localhost:8080/'
});
```

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses Keycloak client
- [server-auth-config.md](./server-auth-config.md) - Configuration source
- [server-auth-pkce.md](./server-auth-pkce.md) - PKCE generation
