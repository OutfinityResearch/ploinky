# cli/commands/ssoCommands.js - SSO Commands

## Overview

Provides CLI commands for managing Single Sign-On (SSO) configuration. Handles enabling, disabling, and checking status of SSO authentication.

## Source File

`cli/commands/ssoCommands.js`

## Dependencies

```javascript
import { showHelp } from '../services/help.js';
import {
    setSsoEnabled,
    disableSsoConfig,
    gatherSsoStatus,
    extractShortAgentName as extractSsoShortName,
    SSO_ENV_ROLE_CANDIDATES,
    resolveEnvRoleValues as resolveSsoEnvRoleValues
} from '../services/sso.js';
```

## Internal Functions

### parseFlagArgs(args)

**Purpose**: Parses command-line flag arguments into flags object and remaining args

**Parameters**:
- `args` (string[]): Command arguments

**Returns**: `{flags: Object, rest: string[]}`

**Implementation**:
```javascript
function parseFlagArgs(args = []) {
    const flags = {};
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        if (!token || !String(token).startsWith('--')) {
            rest.push(token);
            continue;
        }
        const eqIdx = token.indexOf('=');
        let key = token.slice(2);
        let value;
        if (eqIdx !== -1) {
            key = token.slice(2, eqIdx);
            value = token.slice(eqIdx + 1);
        } else if (i + 1 < args.length && !String(args[i + 1]).startsWith('--')) {
            value = args[i + 1];
            i += 1;
        } else {
            value = 'true';
        }
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        flags[key] = value;
    }
    return { flags, rest };
}
```

### printSsoDetails(status, options)

**Purpose**: Prints formatted SSO status information

**Parameters**:
- `status` (Object): SSO status from gatherSsoStatus()
- `options.includeSecrets` (boolean): Whether to show masked secrets

**Implementation**:
```javascript
function printSsoDetails(status, { includeSecrets = false } = {}) {
    const { config, secrets, routerPort, providerHostPort } = status;
    if (!config.enabled) {
        console.log('SSO is disabled. Run `ploinky sso enable` to enforce SSO.');
        return;
    }
    console.log('SSO is enabled:');
    console.log(`  Provider: ${config.provider}`);
    console.log(`  Router port: ${routerPort}`);
    console.log(`  Provider port: ${providerHostPort}`);
    console.log(`  Redirect URI: ${config.redirectUri}`);
    if (config.externalBaseUrl) {
        console.log(`  External base URL: ${config.externalBaseUrl}`);
    }
    if (includeSecrets) {
        const secretKeys = Object.keys(secrets || {});
        if (secretKeys.length) {
            console.log('  Secrets:');
            for (const key of secretKeys) {
                const masked = secrets[key] ? `${secrets[key].slice(0, 4)}***` : '<empty>';
                console.log(`    ${key}: ${masked}`);
            }
        }
    }
    if (Array.isArray(config.roles) && config.roles.length) {
        console.log('  Roles:');
        for (const role of config.roles) {
            const envRole = role.envRole || 'unknown';
            const agentName = role.agent || '<none>';
            console.log(`    ${envRole} -> ${agentName}`);
        }
    }
}
```

### enableSsoCommand(options)

**Purpose**: Enables SSO using environment variables

**Parameters**:
- `options` (string[]): Command options with role flags

**Async**: Yes

**Implementation**:
```javascript
async function enableSsoCommand(options = []) {
    const { flags } = parseFlagArgs(options);

    // Parse role flags (--role-admin=agent-name)
    const roleInputs = [];
    for (const [key, value] of Object.entries(flags)) {
        if (!key.startsWith('role-')) continue;
        const role = key.slice('role-'.length);
        if (!role) continue;
        roleInputs.push({ role, agent: value });
    }

    const status = gatherSsoStatus();
    if (status.config.enabled) {
        console.log('SSO is already enabled. Use `ploinky sso disable` to reset.');
        return;
    }

    // Build roles array
    const roles = [];
    for (const { role, agent } of roleInputs) {
        if (!role || !agent) continue;
        roles.push({ envRole: role, agent: extractSsoShortName(agent) });
    }

    // Resolve environment values
    const roleValues = resolveSsoEnvRoleValues({
        provider: process.env.SSO_PROVIDER,
        clientId: process.env.SSO_CLIENT_ID,
        clientSecret: process.env.SSO_CLIENT_SECRET,
        redirectUri: process.env.SSO_REDIRECT_URI,
        externalBaseUrl: process.env.SSO_EXTERNAL_BASE_URL,
        roles: roles.length ? roles : undefined,
    });

    // Check required variables
    const missingRequired = roleValues.missing.filter(item => item.required);
    if (missingRequired.length) {
        const missing = missingRequired.map(item =>
            item.candidates.filter(Boolean).join('/')
        ).join(', ');
        console.log(`Cannot enable SSO. Missing required environment variables: ${missing}.`);
        console.log('Configure the variables and run `ploinky sso enable` again.');
        return;
    }

    // Warn about optional missing
    const missingOptional = roleValues.missing.filter(item => !item.required);
    if (missingOptional.length) {
        const hint = missingOptional.map(item =>
            item.candidates.filter(Boolean).join('/')
        ).join(', ');
        console.log(`Warning: optional SSO environment variables not set: ${hint}.`);
    }

    setSsoEnabled(true);
    console.log('✓ SSO enabled. Router will enforce Single Sign-On.');
    printSsoDetails(gatherSsoStatus(), { includeSecrets: true });
}
```

### disableSsoCommand()

**Purpose**: Disables SSO configuration

**Implementation**:
```javascript
function disableSsoCommand() {
    disableSsoConfig();
    console.log('✓ SSO disabled. Restart the workspace to return to token-based auth.');
}
```

### showSsoStatusCommand()

**Purpose**: Shows current SSO status

**Implementation**:
```javascript
function showSsoStatusCommand() {
    printSsoDetails(gatherSsoStatus(), { includeSecrets: true });
}
```

## Public API

### handleSsoCommand(options)

**Purpose**: Main command dispatcher for SSO subcommands

**Parameters**:
- `options` (string[]): Command arguments

**Async**: Yes

**Subcommands**:
| Command | Description |
|---------|-------------|
| `sso enable` | Enable SSO using environment variables |
| `sso disable` | Disable SSO |
| `sso status` | Show SSO status (default) |

**Implementation**:
```javascript
export async function handleSsoCommand(options = []) {
    const subcommand = (options[0] || 'status').toLowerCase();
    const rest = options.slice(1);
    if (subcommand === 'enable') {
        if (rest.length > 0) {
            throw new Error('Usage: ploinky sso enable');
        }
        await enableSsoCommand(rest);
        return;
    }
    if (subcommand === 'disable') {
        disableSsoCommand();
        return;
    }
    if (subcommand === 'status') {
        showSsoStatusCommand();
        return;
    }
    showHelp(['sso']);
}
```

## Exports

```javascript
export { handleSsoCommand };
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SSO_PROVIDER` | Yes | SSO provider (e.g., 'keycloak') |
| `SSO_CLIENT_ID` | Yes | OAuth client ID |
| `SSO_CLIENT_SECRET` | Yes | OAuth client secret |
| `SSO_REDIRECT_URI` | No | OAuth redirect URI |
| `SSO_EXTERNAL_BASE_URL` | No | External base URL for callbacks |

## Usage Example

```bash
# Enable SSO
export SSO_PROVIDER=keycloak
export SSO_CLIENT_ID=myapp
export SSO_CLIENT_SECRET=secret123
ploinky sso enable

# Check status
ploinky sso status

# Disable SSO
ploinky sso disable
```

## Related Modules

- [service-sso.md](../services/utils/service-sso.md) - SSO service
- [server-auth-handlers.md](../server/auth/server-auth-handlers.md) - Auth handling
