# cli/services/sso.js - SSO Service

## Overview

Manages Single Sign-On (SSO) configuration for Ploinky workspaces. Handles OIDC provider configuration, environment variable resolution, and service discovery for SSO agents.

## Source File

`cli/services/sso.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import * as workspaceSvc from './workspace.js';
import { resolveVarValue } from './secretVars.js';
```

## Constants & Configuration

```javascript
const ROUTING_FILE = path.resolve('.ploinky/routing.json');

// Standard SSO environment variable naming conventions
const SSO_ENV_ROLE_CANDIDATES = {
    baseUrl: ['KEYCLOAK_URL', 'SSO_BASE_URL', 'SSO_URL', 'OIDC_BASE_URL'],
    realm: ['KEYCLOAK_REALM', 'SSO_REALM', 'OIDC_REALM'],
    clientId: ['KEYCLOAK_CLIENT_ID', 'SSO_CLIENT_ID', 'OIDC_CLIENT_ID'],
    clientSecret: ['KEYCLOAK_CLIENT_SECRET', 'SSO_CLIENT_SECRET', 'OIDC_CLIENT_SECRET'],
    scope: ['KEYCLOAK_SCOPE', 'SSO_SCOPE', 'OIDC_SCOPE'],
    redirectUri: ['KEYCLOAK_REDIRECT_URI', 'SSO_REDIRECT_URI', 'OIDC_REDIRECT_URI'],
    logoutRedirectUri: ['KEYCLOAK_LOGOUT_REDIRECT_URI', 'SSO_LOGOUT_REDIRECT_URI', 'OIDC_LOGOUT_REDIRECT_URI'],
    adminUser: ['KEYCLOAK_ADMIN', 'SSO_ADMIN', 'OIDC_ADMIN'],
    adminPassword: ['KEYCLOAK_ADMIN_PASSWORD', 'SSO_ADMIN_PASSWORD', 'OIDC_ADMIN_PASSWORD'],
    hostname: ['KC_HOSTNAME', 'SSO_HOSTNAME', 'OIDC_HOSTNAME'],
    hostnameStrict: ['KC_HOSTNAME_STRICT', 'SSO_HOSTNAME_STRICT', 'OIDC_HOSTNAME_STRICT'],
    httpEnabled: ['KC_HTTP_ENABLED', 'SSO_HTTP_ENABLED', 'OIDC_HTTP_ENABLED'],
    proxy: ['KC_PROXY', 'SSO_PROXY', 'OIDC_PROXY'],
    dbEngine: ['KC_DB', 'SSO_DB_ENGINE', 'OIDC_DB_ENGINE'],
    dbUrl: ['KC_DB_URL', 'SSO_DB_URL', 'OIDC_DB_URL'],
    dbUsername: ['KC_DB_USERNAME', 'SSO_DB_USERNAME', 'OIDC_DB_USERNAME'],
    dbPassword: ['KC_DB_PASSWORD', 'SSO_DB_PASSWORD', 'OIDC_DB_PASSWORD']
};
```

## Internal Functions

### readRouting()

**Purpose**: Reads routing configuration

**Returns**: (Object) Routing config or empty object

### readEnvValue(name)

**Purpose**: Reads environment value from secrets or process.env

**Parameters**:
- `name` (string): Variable name

**Returns**: (string) Value or empty string

**Implementation**:
```javascript
function readEnvValue(name) {
    if (!name) return '';
    try {
        const fromSecrets = resolveVarValue(name);
        if (fromSecrets && String(fromSecrets).trim()) {
            return String(fromSecrets).trim();
        }
    } catch (_) {}
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
        const raw = process.env[name];
        if (raw !== undefined && raw !== null) {
            const str = String(raw).trim();
            if (str) return str;
        }
    }
    return '';
}
```

## Public API

### getRouterPort()

**Purpose**: Gets the router port from configuration

**Returns**: (number) Port number (default: 8080)

### extractShortAgentName(agentRef)

**Purpose**: Extracts short agent name from full reference

**Parameters**:
- `agentRef` (string): Agent reference like "repo/agent" or "repo:agent"

**Returns**: (string) Short name

**Implementation**:
```javascript
export function extractShortAgentName(agentRef) {
    if (!agentRef) return '';
    const tokens = String(agentRef).split(/[/:]/).filter(Boolean);
    if (!tokens.length) return String(agentRef);
    return tokens[tokens.length - 1];
}
```

### getAgentHostPort(agentName)

**Purpose**: Gets the host port for an agent from routing config

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (number|null) Host port or null

### resolveEnvRoleValues(overrides)

**Purpose**: Resolves SSO environment values with fallbacks

**Parameters**:
- `overrides` (Object): Override values

**Returns**: Object with all SSO values and missing list

**Implementation**:
```javascript
export function resolveEnvRoleValues(overrides = {}) {
    // Normalize overrides
    const normalizedOverrides = {};
    // ... normalize string values

    // Helper to get value from candidates
    const valueFromCandidates = (candidates = [], overrideKeys = []) => {
        for (const key of overrideKeys) {
            if (key && normalizedOverrides[key]) {
                return normalizedOverrides[key];
            }
        }
        for (const name of candidates) {
            if (!name) continue;
            const val = readEnvValue(name);
            if (val) return val;
        }
        return '';
    };

    // Resolve all values
    const baseUrl = valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.baseUrl, ['baseUrl']);
    const realm = valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.realm, ['realm']) || 'ploinky';
    const clientId = valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.clientId, ['clientId']) || 'ploinky-router';
    // ... resolve other values

    // Track missing required values
    const missing = [];
    const pushMissing = (key, candidates, value, required = false) => {
        const resolved = value === undefined || value === null ? '' : String(value).trim();
        if (resolved) return;
        missing.push({ key, required, candidates });
    };

    pushMissing('baseUrl', SSO_ENV_ROLE_CANDIDATES.baseUrl, baseUrl, true);
    // ... check other required values

    return {
        baseUrl, realm, clientId, clientSecret, scope, redirectUri,
        logoutRedirectUri, adminUser, adminPassword, hostname,
        hostnameStrict, httpEnabled, proxy, dbEngine, dbUrl,
        dbUsername, dbPassword, provider, externalBaseUrl, roles,
        missing
    };
}
```

### getSsoConfig()

**Purpose**: Gets SSO configuration from workspace

**Returns**: SSO config object

**Implementation**:
```javascript
export function getSsoConfig() {
    const cfg = workspaceSvc.getConfig() || {};
    const sso = cfg.sso || {};
    const providerAgent = sso.providerAgent || sso.keycloakAgent || 'keycloak';
    const providerAgentShort = extractShortAgentName(providerAgent);
    const databaseAgent = sso.databaseAgent || sso.postgresAgent || 'postgres';
    const databaseAgentShort = extractShortAgentName(databaseAgent);

    return {
        enabled: Boolean(sso.enabled),
        providerAgent,
        providerAgentShort,
        databaseAgent,
        databaseAgentShort,
        realm: sso.realm || null,
        clientId: sso.clientId || null,
        redirectUri: sso.redirectUri || null,
        logoutRedirectUri: sso.logoutRedirectUri || null,
        baseUrl: sso.baseUrl || null,
        scope: sso.scope || 'openid profile email'
    };
}
```

### setSsoConfig(partial)

**Purpose**: Sets SSO configuration

**Parameters**:
- `partial` (Object): Partial config to merge

**Returns**: Merged config

### setSsoEnabled(enabled)

**Purpose**: Enables or disables SSO

**Parameters**:
- `enabled` (boolean): Enable state

**Returns**: Updated SSO config

### disableSsoConfig()

**Purpose**: Disables SSO configuration

**Returns**: Updated SSO config

### getSsoSecrets()

**Purpose**: Gets resolved SSO secrets

**Returns**: Object with all SSO credentials

### gatherSsoStatus()

**Purpose**: Gathers comprehensive SSO status

**Returns**: Status object with config, secrets, and ports

**Implementation**:
```javascript
export function gatherSsoStatus() {
    const config = getSsoConfig();
    const secrets = getSsoSecrets();
    return {
        config,
        secrets,
        routerPort: getRouterPort(),
        providerHostPort: getAgentHostPort(config.providerAgentShort)
    };
}
```

### normalizeBaseUrl(raw)

**Purpose**: Normalizes a base URL

**Parameters**:
- `raw` (string): Raw URL

**Returns**: (string) Normalized URL

## Exports

```javascript
export {
    getSsoConfig,
    setSsoConfig,
    setSsoEnabled,
    disableSsoConfig,
    getSsoSecrets,
    gatherSsoStatus,
    getRouterPort,
    getAgentHostPort,
    normalizeBaseUrl,
    extractShortAgentName,
    SSO_ENV_ROLE_CANDIDATES,
    resolveEnvRoleValues
};
```

## Usage Example

```javascript
import {
    getSsoConfig,
    setSsoEnabled,
    gatherSsoStatus,
    resolveEnvRoleValues
} from './sso.js';

// Check SSO status
const status = gatherSsoStatus();
console.log(`SSO enabled: ${status.config.enabled}`);

// Enable SSO
setSsoEnabled(true);

// Resolve environment values
const envValues = resolveEnvRoleValues({
    baseUrl: 'http://keycloak:8180'
});
console.log(`Missing required: ${envValues.missing.filter(m => m.required).length}`);
```

## Related Modules

- [service-workspace.md](../workspace/service-workspace.md) - Workspace config
- [service-secret-vars.md](./service-secret-vars.md) - Variable resolution
- [commands-sso.md](../../commands/commands-sso.md) - SSO commands
