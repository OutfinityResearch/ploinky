# cli/server/utils/routerEnv.js - Router Environment

## Overview

Manages router environment configuration including port resolution and component token management for WebTTY, WebChat, Dashboard, and WebMeet services.

## Source File

`cli/server/utils/routerEnv.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as envSvc from '../../services/secretVars.js';
```

## Constants

```javascript
// Component configuration specifications
const COMPONENTS = {
    webtty: { varName: 'WEBTTY_TOKEN', label: 'WebTTY', path: '/webtty' },
    webchat: { varName: 'WEBCHAT_TOKEN', label: 'WebChat', path: '/webchat' },
    dashboard: { varName: 'WEBDASHBOARD_TOKEN', label: 'Dashboard', path: '/dashboard' },
    webmeet: { varName: 'WEBMEET_TOKEN', label: 'WebMeet', path: '/webmeet' }
};
```

## Public API

### getRouterPort()

**Purpose**: Gets the router port from configuration

**Returns**: (number) Router port (default: 8080)

**Resolution Order**:
1. `.ploinky/routing.json` → `port` field
2. `ROUTER_PORT` in `.ploinky/.secrets`
3. `ROUTER_PORT` environment variable
4. Default: 8080

**Implementation**:
```javascript
function getRouterPort() {
    let port = null;

    // Try routing.json first
    try {
        const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8'));
        if (routing && routing.port) {
            const candidate = parseInt(routing.port, 10);
            if (!Number.isNaN(candidate) && candidate > 0) port = candidate;
        }
    } catch (_) {}

    // Try .secrets file
    if (!port) {
        try {
            const val = parseInt(envSvc.resolveVarValue('ROUTER_PORT'), 10);
            if (!Number.isNaN(val) && val > 0) port = val;
        } catch (_) {}
    }

    // Try environment variable
    if (!port) {
        const envPort = parseInt(process.env.ROUTER_PORT || '', 10);
        if (!Number.isNaN(envPort) && envPort > 0) port = envPort;
    }

    return port || 8080;
}
```

### refreshComponentToken(component, options)

**Purpose**: Generates and stores a new token for a component

**Parameters**:
- `component` (string): Component name ('webtty', 'webchat', 'dashboard', 'webmeet')
- `options` (Object):
  - `quiet` (boolean): Suppress console output

**Returns**: (string) New token (64-character hex string)

**Implementation**:
```javascript
function refreshComponentToken(component, { quiet } = {}) {
    const spec = COMPONENTS[component];
    if (!spec) throw new Error(`Unknown component '${component}'`);

    const token = crypto.randomBytes(32).toString('hex');
    envSvc.setEnvVar(spec.varName, token);

    if (!quiet) {
        const port = getRouterPort();
        console.log(`✓ ${spec.label} token refreshed (${maskToken(token)}…).`);
        console.log(`  Visit: http://127.0.0.1:${port}${spec.path}?token=<stored in ${spec.varName} in .ploinky/.secrets>`);
    }

    return token;
}
```

### getComponentToken(component)

**Purpose**: Gets existing token for a component

**Parameters**:
- `component` (string): Component name

**Returns**: (string|null) Token or null if not found

**Implementation**:
```javascript
function getComponentToken(component) {
    const spec = COMPONENTS[component];
    if (!spec) throw new Error(`Unknown component '${component}'`);

    try {
        const val = envSvc.resolveVarValue(spec.varName);
        if (typeof val === 'string' && val.trim()) {
            return val.trim();
        }
    } catch (_) {}

    return null;
}
```

### ensureComponentToken(component, options)

**Purpose**: Gets existing token or creates new one

**Parameters**:
- `component` (string): Component name
- `options` (Object):
  - `quiet` (boolean): Suppress console output

**Returns**: (string) Token (existing or new)

**Implementation**:
```javascript
function ensureComponentToken(component, { quiet } = {}) {
    const spec = COMPONENTS[component];
    if (!spec) throw new Error(`Unknown component '${component}'`);

    const existing = getComponentToken(component);
    if (existing) {
        if (!quiet) {
            const port = getRouterPort();
            console.log(`✓ ${spec.label} token ready (${maskToken(existing)}…).`);
            console.log(`  Visit: http://127.0.0.1:${port}${spec.path}?token=<stored in ${spec.varName} in .ploinky/.secrets>`);
        }
        return existing;
    }

    return refreshComponentToken(component, { quiet });
}
```

## Internal Functions

### maskToken(token)

**Purpose**: Masks a token for display (shows first 5 characters)

**Parameters**:
- `token` (string): Token to mask

**Returns**: (string) First 5 characters

**Implementation**:
```javascript
function maskToken(token) {
    if (typeof token !== 'string') return '';
    return token.slice(0, 5);
}
```

## Exports

```javascript
export {
    COMPONENTS,
    getRouterPort,
    refreshComponentToken,
    ensureComponentToken,
    getComponentToken
};
```

## Component Specifications

| Component | Environment Variable | URL Path | Label |
|-----------|---------------------|----------|-------|
| webtty | `WEBTTY_TOKEN` | `/webtty` | WebTTY |
| webchat | `WEBCHAT_TOKEN` | `/webchat` | WebChat |
| dashboard | `WEBDASHBOARD_TOKEN` | `/dashboard` | Dashboard |
| webmeet | `WEBMEET_TOKEN` | `/webmeet` | WebMeet |

## Usage Example

```javascript
import {
    getRouterPort,
    ensureComponentToken,
    refreshComponentToken,
    getComponentToken
} from './routerEnv.js';

// Get router port
const port = getRouterPort();
console.log(`Router running on port ${port}`);

// Ensure webchat token exists
const webchatToken = ensureComponentToken('webchat');
// ✓ WebChat token ready (abc12…).
//   Visit: http://127.0.0.1:8080/webchat?token=<stored in WEBCHAT_TOKEN in .ploinky/.secrets>

// Force refresh dashboard token
const newDashboardToken = refreshComponentToken('dashboard');
// ✓ Dashboard token refreshed (def34…).

// Get existing token without side effects
const existingToken = getComponentToken('webtty');
if (existingToken) {
    console.log('WebTTY token exists');
}
```

## Token Storage

Tokens are stored in `.ploinky/.secrets`:

```
WEBTTY_TOKEN=abc123...
WEBCHAT_TOKEN=def456...
WEBDASHBOARD_TOKEN=ghi789...
WEBMEET_TOKEN=jkl012...
```

## Related Modules

- [service-secret-vars.md](../../services/utils/service-secret-vars.md) - Secret storage
- [server-auth-handlers.md](../server-auth-handlers.md) - Authentication
- [service-server-manager.md](../../services/utils/service-server-manager.md) - Server management
