# cli/services/secretInjector.js - Secret Injector

## Overview

Manages secrets for agent containers and host hooks. Loads secrets from environment variables and `.ploinky/.secrets` file, validates required secrets for profiles, and builds docker environment flags.

## Source File

`cli/services/secretInjector.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { SECRETS_FILE, PLOINKY_DIR } from './config.js';
import { debugLog } from './utils.js';
```

## Constants

```javascript
// Secrets file location: .ploinky/.secrets
```

## Public API

### loadSecretsFile()

**Purpose**: Loads secrets from the .ploinky/.secrets file

**Returns**: (Object) Map of secret names to values

**File Format**:
```
# Comment lines start with #
KEY=VALUE
QUOTED_KEY="value with spaces"
SINGLE_QUOTED='another value'
```

**Implementation**:
```javascript
export function loadSecretsFile() {
    const secrets = {};

    if (!fs.existsSync(SECRETS_FILE)) {
        return secrets;
    }

    try {
        const content = fs.readFileSync(SECRETS_FILE, 'utf8');
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse KEY=VALUE
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) {
                continue;
            }

            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();

            // Remove surrounding quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (key) {
                secrets[key] = value;
            }
        }
    } catch (err) {
        debugLog(`Failed to load secrets file: ${err.message}`);
    }

    return secrets;
}
```

### getSecret(secretName)

**Purpose**: Gets a secret value from environment or .secrets file

**Parameters**:
- `secretName` (string): The secret name

**Returns**: (string|undefined) The secret value or undefined

**Priority**: Environment variables take precedence over .secrets file

**Implementation**:
```javascript
export function getSecret(secretName) {
    // First check environment
    if (process.env[secretName] !== undefined) {
        return process.env[secretName];
    }

    // Then check .secrets file
    const fileSecrets = loadSecretsFile();
    return fileSecrets[secretName];
}
```

### getSecrets(secretNames)

**Purpose**: Gets multiple secrets

**Parameters**:
- `secretNames` (string[]): Array of secret names

**Returns**: (Object) Map of secret names to values (only includes found secrets)

**Implementation**:
```javascript
export function getSecrets(secretNames) {
    const secrets = {};
    const fileSecrets = loadSecretsFile();

    for (const name of secretNames) {
        // Environment takes precedence
        if (process.env[name] !== undefined) {
            secrets[name] = process.env[name];
        } else if (fileSecrets[name] !== undefined) {
            secrets[name] = fileSecrets[name];
        }
    }

    return secrets;
}
```

### validateSecrets(requiredSecrets)

**Purpose**: Validates that all required secrets exist

**Parameters**:
- `requiredSecrets` (string[]): Array of required secret names

**Returns**:
```javascript
{
    valid: boolean,      // True if all secrets found
    missing: string[],   // Names of missing secrets
    source: Object       // Map of secret names to sources ('environment' or '.secrets file')
}
```

**Implementation**:
```javascript
export function validateSecrets(requiredSecrets) {
    if (!requiredSecrets || requiredSecrets.length === 0) {
        return { valid: true, missing: [], source: {} };
    }

    const missing = [];
    const source = {};
    const fileSecrets = loadSecretsFile();

    for (const name of requiredSecrets) {
        if (process.env[name] !== undefined) {
            source[name] = 'environment';
        } else if (fileSecrets[name] !== undefined) {
            source[name] = '.secrets file';
        } else {
            missing.push(name);
        }
    }

    return {
        valid: missing.length === 0,
        missing,
        source
    };
}
```

### buildSecretEnvFlags(secrets)

**Purpose**: Builds docker -e flags for secrets

**Parameters**:
- `secrets` (Object): Map of secret names to values

**Returns**: (string[]) Array of docker -e flag strings

**Implementation**:
```javascript
export function buildSecretEnvFlags(secrets) {
    const flags = [];

    for (const [name, value] of Object.entries(secrets)) {
        if (value === undefined || value === null) {
            continue;
        }
        flags.push(`-e ${name}=${shellEscape(String(value))}`);
    }

    return flags;
}
```

### buildSecretFlags(secretNames)

**Purpose**: Builds docker -e flags for required secrets

**Parameters**:
- `secretNames` (string[]): Array of secret names to include

**Returns**: `{ flags: string[], missing: string[] }`

**Implementation**:
```javascript
export function buildSecretFlags(secretNames) {
    const secrets = getSecrets(secretNames);
    const flags = buildSecretEnvFlags(secrets);
    const missing = secretNames.filter(name => !(name in secrets));

    return { flags, missing };
}
```

### getSecretsSource(secretNames)

**Purpose**: Gets secrets source information for debugging/display

**Parameters**:
- `secretNames` (string[]): Secret names to check

**Returns**: (Object) Map of secret names to their sources

**Source Values**:
- `'environment'` - From environment variable
- `'.secrets'` - From .secrets file
- `'not found'` - Not available

**Implementation**:
```javascript
export function getSecretsSource(secretNames) {
    const sources = {};
    const fileSecrets = loadSecretsFile();

    for (const name of secretNames) {
        if (process.env[name] !== undefined) {
            sources[name] = 'environment';
        } else if (fileSecrets[name] !== undefined) {
            sources[name] = '.secrets';
        } else {
            sources[name] = 'not found';
        }
    }

    return sources;
}
```

### formatMissingSecretsError(missingSecrets, profileName)

**Purpose**: Formats missing secrets error message with guidance

**Parameters**:
- `missingSecrets` (string[]): Array of missing secret names
- `profileName` (string): The profile name

**Returns**: (string) Formatted error message

**Output Example**:
```
Missing required secrets for profile 'prod':

  - API_KEY
  - DB_PASSWORD

To provide secrets, either:
  1. Set environment variables before running ploinky
  2. Add them to .ploinky/.secrets

Example (.ploinky/.secrets):
  API_KEY=your_value_here
  DB_PASSWORD=your_value_here
```

**Implementation**:
```javascript
export function formatMissingSecretsError(missingSecrets, profileName) {
    const lines = [
        `Missing required secrets for profile '${profileName}':`,
        ''
    ];

    for (const secret of missingSecrets) {
        lines.push(`  - ${secret}`);
    }

    lines.push('');
    lines.push('To provide secrets, either:');
    lines.push('  1. Set environment variables before running ploinky');
    lines.push(`  2. Add them to ${SECRETS_FILE}`);
    lines.push('');
    lines.push('Example (.ploinky/.secrets):');
    for (const secret of missingSecrets.slice(0, 2)) {
        lines.push(`  ${secret}=your_value_here`);
    }

    return lines.join('\n');
}
```

### injectSecretsToEnv(secrets)

**Purpose**: Injects profile secrets into process environment (for host hooks)

**Parameters**:
- `secrets` (Object): Map of secret names to values

**Implementation**:
```javascript
export function injectSecretsToEnv(secrets) {
    for (const [name, value] of Object.entries(secrets)) {
        if (value !== undefined && value !== null) {
            process.env[name] = String(value);
        }
    }
}
```

### createEnvWithSecrets(baseEnv, secrets)

**Purpose**: Creates environment object with secrets (without modifying process.env)

**Parameters**:
- `baseEnv` (Object): Base environment object
- `secrets` (Object): Secrets to add

**Returns**: (Object) New environment object with secrets

**Implementation**:
```javascript
export function createEnvWithSecrets(baseEnv, secrets) {
    return {
        ...baseEnv,
        ...secrets
    };
}
```

## Internal Functions

### shellEscape(value)

**Purpose**: Escapes a value for shell/docker command

**Parameters**:
- `value` (string): Value to escape

**Returns**: (string) Escaped value

**Implementation**:
```javascript
function shellEscape(value) {
    // If value contains special characters, wrap in single quotes
    if (/[^a-zA-Z0-9_\-\.\/]/.test(value)) {
        // Escape single quotes within the value
        return `'${value.replace(/'/g, "'\\''")}'`;
    }
    return value;
}
```

## Secrets File Format

Location: `.ploinky/.secrets`

```
# Ploinky Secrets File
# Format: KEY=VALUE

# API Keys
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=your-key-here

# Database
DB_PASSWORD="password with spaces"
DB_HOST='localhost'

# Other secrets
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

## Usage Example

```javascript
import {
    validateSecrets,
    getSecrets,
    buildSecretFlags,
    formatMissingSecretsError,
    createEnvWithSecrets
} from './secretInjector.js';

// Validate required secrets for profile
const profileSecrets = ['API_KEY', 'DB_PASSWORD'];
const validation = validateSecrets(profileSecrets);

if (!validation.valid) {
    console.error(formatMissingSecretsError(validation.missing, 'prod'));
    process.exit(1);
}

// Get secrets for docker
const secrets = getSecrets(profileSecrets);

// Build docker flags
const { flags, missing } = buildSecretFlags(profileSecrets);
// flags: ['-e API_KEY=value', '-e DB_PASSWORD=value']

// Create environment for host hook
const hookEnv = createEnvWithSecrets(process.env, secrets);
```

## Related Modules

- [service-config.md](../config/service-config.md) - SECRETS_FILE constant
- [service-profile.md](./service-profile.md) - Profile secrets validation
- [service-lifecycle-hooks.md](./service-lifecycle-hooks.md) - Secret injection for hooks
