# cli/server/auth/config.js - Auth Configuration

## Overview

Loads and validates SSO/OIDC authentication configuration from environment variables, secrets, and workspace configuration. Provides centralized configuration loading for Keycloak integration.

## Source File

`cli/server/auth/config.js`

## Dependencies

```javascript
import { resolveVarValue } from '../../services/secretVars.js';
import { getConfig } from '../../services/workspace.js';
import { SSO_ENV_ROLE_CANDIDATES } from '../../services/sso.js';
```

## Internal Functions

### readConfigValue(names, fallback)

**Purpose**: Reads configuration value from secrets or environment variables

**Parameters**:
- `names` (string|string[]): Variable name(s) to try
- `fallback` (string): Fallback value if not found

**Returns**: (string) Configuration value or empty string

**Resolution Order**:
1. Secret variables (via `resolveVarValue`)
2. Environment variables
3. Fallback value

**Implementation**:
```javascript
function readConfigValue(names, fallback) {
    const candidates = Array.isArray(names) ? names : [names].filter(Boolean);
    // First try secrets
    for (const name of candidates) {
        if (!name) continue;
        const secret = resolveVarValue(name);
        if (secret && String(secret).trim()) return String(secret).trim();
    }
    // Then try environment variables
    for (const name of candidates) {
        if (!name) continue;
        const env = process.env[name];
        if (env && String(env).trim()) return String(env).trim();
    }
    // Finally use fallback
    if (fallback && String(fallback).trim()) return String(fallback).trim();
    return '';
}
```

## Public API

### loadAuthConfig()

**Purpose**: Loads complete SSO authentication configuration

**Returns**: (Object|null) Configuration object or null if SSO disabled/not configured

**Configuration Object**:
```javascript
{
    baseUrl: string,        // Keycloak base URL
    realm: string,          // Keycloak realm
    clientId: string,       // OAuth client ID
    clientSecret: string|null, // OAuth client secret (optional)
    redirectUri: string|null,  // OAuth redirect URI
    postLogoutRedirectUri: string|null, // Post-logout redirect
    scope: string           // OAuth scopes (default: 'openid profile email')
}
```

**Required Fields**:
- `baseUrl` - Must be present
- `realm` - Must be present
- `clientId` - Must be present

**Returns null when**:
- `sso.enabled === false` in workspace config
- Required fields (baseUrl, realm, clientId) are missing

**Implementation**:
```javascript
function loadAuthConfig() {
    let workspaceConfig;
    // Check if SSO is explicitly disabled in workspace config
    try {
        workspaceConfig = getConfig();
        if (workspaceConfig && workspaceConfig.sso && workspaceConfig.sso.enabled === false) {
            return null;
        }
    } catch (_) {
        // Ignore config read errors, fall through to env var check
    }

    const ssoConfig = workspaceConfig?.sso || {};

    const baseUrl = readConfigValue(SSO_ENV_ROLE_CANDIDATES.baseUrl, ssoConfig.baseUrl);
    const realm = readConfigValue(SSO_ENV_ROLE_CANDIDATES.realm, ssoConfig.realm);
    const clientId = readConfigValue(SSO_ENV_ROLE_CANDIDATES.clientId, ssoConfig.clientId);
    const clientSecret = readConfigValue(SSO_ENV_ROLE_CANDIDATES.clientSecret, ssoConfig.clientSecret);
    const redirectUri = readConfigValue(SSO_ENV_ROLE_CANDIDATES.redirectUri, ssoConfig.redirectUri);
    const postLogoutRedirectUri = readConfigValue(SSO_ENV_ROLE_CANDIDATES.logoutRedirectUri, ssoConfig.logoutRedirectUri);
    const scope = readConfigValue(SSO_ENV_ROLE_CANDIDATES.scope, ssoConfig.scope) || 'openid profile email';

    if (!baseUrl || !realm || !clientId) {
        return null;
    }

    return {
        baseUrl,
        realm,
        clientId,
        clientSecret: clientSecret || null,
        redirectUri: redirectUri || null,
        postLogoutRedirectUri: postLogoutRedirectUri || null,
        scope
    };
}
```

## Exports

```javascript
export { loadAuthConfig };
```

## Configuration Sources

### Environment Variables (via SSO_ENV_ROLE_CANDIDATES)

| Config Key | Environment Variables |
|------------|----------------------|
| baseUrl | KEYCLOAK_URL, SSO_BASE_URL |
| realm | KEYCLOAK_REALM, SSO_REALM |
| clientId | KEYCLOAK_CLIENT_ID, SSO_CLIENT_ID |
| clientSecret | KEYCLOAK_CLIENT_SECRET, SSO_CLIENT_SECRET |
| redirectUri | KEYCLOAK_REDIRECT_URI, SSO_REDIRECT_URI |
| logoutRedirectUri | KEYCLOAK_LOGOUT_REDIRECT_URI, SSO_LOGOUT_REDIRECT_URI |
| scope | KEYCLOAK_SCOPE, SSO_SCOPE |

### Workspace Configuration

File: `.ploinky/config.json`
```json
{
    "sso": {
        "enabled": true,
        "baseUrl": "https://keycloak.example.com",
        "realm": "ploinky",
        "clientId": "ploinky-router",
        "clientSecret": "secret",
        "redirectUri": "http://localhost:8080/auth/callback",
        "logoutRedirectUri": "http://localhost:8080/",
        "scope": "openid profile email"
    }
}
```

## Usage Example

```javascript
import { loadAuthConfig } from './config.js';

const config = loadAuthConfig();

if (config) {
    console.log(`SSO enabled for realm: ${config.realm}`);
    console.log(`Client ID: ${config.clientId}`);
} else {
    console.log('SSO is disabled or not configured');
}
```

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses config
- [service-secret-vars.md](../../services/utils/service-secret-vars.md) - Secret resolution
- [service-sso.md](../../services/utils/service-sso.md) - SSO environment candidates
- [service-workspace.md](../../services/workspace/service-workspace.md) - Workspace config
