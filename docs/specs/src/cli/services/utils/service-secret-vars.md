# cli/services/secretVars.js - Secret Variables Service

## Overview

Manages workspace environment variables and secrets. Provides storage, retrieval, alias resolution, and manifest-based environment variable handling for agent containers.

## Source File

`cli/services/secretVars.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { SECRETS_FILE } from './config.js';
import { getConfig } from './workspace.js';
import { findAgent } from './utils.js';
```

## Internal Functions

### ensureSecretsFile()

**Purpose**: Ensures the secrets file exists, creating if necessary

**Implementation**:
```javascript
function ensureSecretsFile() {
    try {
        const dir = path.dirname(SECRETS_FILE);
        if (dir && dir !== '.') {
            try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        }
        if (!fs.existsSync(SECRETS_FILE)) {
            fs.writeFileSync(SECRETS_FILE, '# Ploinky secrets\n');
        }
    } catch (_) {}
}
```

### resolveAlias(value, secrets, seen)

**Purpose**: Resolves variable aliases ($VAR references)

**Parameters**:
- `value` (string): Value to resolve
- `secrets` (Object): Secrets map
- `seen` (Set): Visited variables (cycle detection)

**Returns**: (string) Resolved value

**Implementation**:
```javascript
function resolveAlias(value, secrets, seen = new Set()) {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('$')) return value;
    const ref = value.slice(1);
    if (!ref || seen.has(ref)) return '';
    seen.add(ref);
    const next = secrets[ref];
    if (next === undefined) return '';
    return resolveAlias(next, secrets, seen);
}
```

### toBool(value, defaultValue)

**Purpose**: Converts value to boolean

**Parameters**:
- `value`: Value to convert
- `defaultValue` (boolean): Default if undefined

**Returns**: (boolean)

### isEmptyValue(value)

**Purpose**: Checks if a value is empty

**Returns**: (boolean)

### quoteEnvValue(value)

**Purpose**: Quotes and escapes value for docker -e flag

**Returns**: (string) Quoted value

**Implementation**:
```javascript
function quoteEnvValue(value) {
    const str = String(value ?? '');
    const escaped = str.replace(/(["\\$`])/g, '\\$1').replace(/\n/g, '\\n');
    return `"${escaped}"`;
}
```

## Public API

### parseSecrets()

**Purpose**: Parses the secrets file into a key-value map

**Returns**: (Object) Map of variable names to values

**Implementation**:
```javascript
export function parseSecrets() {
    ensureSecretsFile();
    const map = {};
    try {
        const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
        for (const line of (raw.split('\n') || [])) {
            if (!line || line.trim().startsWith('#')) continue;
            const idx = line.indexOf('=');
            if (idx > 0) {
                const k = line.slice(0, idx).trim();
                const v = line.slice(idx + 1);
                if (k) map[k] = v;
            }
        }
    } catch (_) {}
    return map;
}
```

### setEnvVar(name, value)

**Purpose**: Sets or updates an environment variable

**Parameters**:
- `name` (string): Variable name
- `value` (string): Variable value

**Throws**: Error if name missing

**Implementation**:
```javascript
export function setEnvVar(name, value) {
    if (!name) throw new Error('Missing variable name.');
    ensureSecretsFile();
    let lines = [];
    try {
        lines = fs.readFileSync(SECRETS_FILE, 'utf8').split('\n');
    } catch (_) {
        lines = [];
    }
    const envLine = `${name}=${value ?? ''}`;
    const idx = lines.findIndex(l => String(l).startsWith(name + '='));
    if (idx >= 0) lines[idx] = envLine;
    else lines.push(envLine);
    fs.writeFileSync(SECRETS_FILE, lines.filter(x => x !== undefined).join('\n'));
}
```

### deleteVar(name)

**Purpose**: Deletes an environment variable

**Parameters**:
- `name` (string): Variable name

### declareVar(name)

**Purpose**: Declares a variable with empty value

**Parameters**:
- `name` (string): Variable name

### resolveVarValue(name)

**Purpose**: Resolves the final value of a variable (following aliases)

**Parameters**:
- `name` (string): Variable name

**Returns**: (string) Resolved value

### getManifestEnvSpecs(manifest)

**Purpose**: Extracts environment variable specifications from manifest

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: Array of env specs with structure:
```javascript
{
    insideName: string,    // Name inside container
    sourceName: string,    // Name to look up in secrets
    required: boolean,     // Whether required
    defaultValue: any      // Default value
}
```

**Implementation**:
```javascript
export function getManifestEnvSpecs(manifest) {
    const specs = [];
    const env = manifest?.env;
    if (!env) return specs;

    if (Array.isArray(env)) {
        for (const entry of env) {
            if (entry === undefined || entry === null) continue;
            if (typeof entry === 'object' && !Array.isArray(entry)) {
                const { name, value, varName, required } = entry;
                const insideName = typeof name === 'string' ? name.trim() : '';
                if (!insideName) continue;
                const sourceName = typeof varName === 'string' && varName.trim()
                    ? varName.trim() : insideName;
                specs.push({
                    insideName,
                    sourceName,
                    required: toBool(required, false),
                    defaultValue: value
                });
                continue;
            }
            // String entry like "VAR=default" or "VAR"
            const text = String(entry).trim();
            if (!text) continue;
            let insideName = text;
            let defaultValue;
            const eqIdx = text.indexOf('=');
            if (eqIdx >= 0) {
                insideName = text.slice(0, eqIdx).trim();
                defaultValue = text.slice(eqIdx + 1);
            }
            if (!insideName) continue;
            specs.push({
                insideName,
                sourceName: insideName,
                required: false,
                defaultValue
            });
        }
        return specs;
    }

    // Object format
    if (env && typeof env === 'object') {
        for (const [insideKey, rawSpec] of Object.entries(env)) {
            if (!insideKey) continue;
            const insideName = String(insideKey).trim();
            if (!insideName) continue;

            let sourceName = insideName;
            let required = false;
            let defaultValue;
            if (rawSpec && typeof rawSpec === 'object' && !Array.isArray(rawSpec)) {
                if (typeof rawSpec.varName === 'string' && rawSpec.varName.trim()) {
                    sourceName = rawSpec.varName.trim();
                }
                if (Object.prototype.hasOwnProperty.call(rawSpec, 'required')) {
                    required = toBool(rawSpec.required, false);
                }
                if (Object.prototype.hasOwnProperty.call(rawSpec, 'default')) {
                    defaultValue = rawSpec.default;
                } else if (Object.prototype.hasOwnProperty.call(rawSpec, 'value')) {
                    defaultValue = rawSpec.value;
                }
            } else {
                defaultValue = rawSpec;
            }

            specs.push({ insideName, sourceName, required, defaultValue });
        }
    }

    return specs;
}
```

### getManifestEnvNames(manifest)

**Purpose**: Gets list of environment variable names from manifest

**Returns**: (string[]) Array of variable names

### collectManifestEnv(manifest, options)

**Purpose**: Collects resolved environment variables for manifest

**Parameters**:
- `manifest` (Object): Agent manifest
- `options.enforceRequired` (boolean): Throw on missing required vars

**Returns**: `{resolved: Array, missing: Array}`

### getExposedNames(manifest)

**Purpose**: Gets all exposed variable names from manifest

**Returns**: (string[]) Variable names

### formatEnvFlag(name, value)

**Purpose**: Formats an environment variable as docker -e flag

**Returns**: (string) `-e NAME="value"`

### buildEnvFlags(manifest)

**Purpose**: Builds complete list of -e flags for container

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string[]) Array of `-e NAME=value` flags

**Implementation**:
```javascript
export function buildEnvFlags(manifest) {
    const secrets = parseSecrets();
    const envEntries = resolveManifestEnv(manifest, secrets, { enforceRequired: true }).resolved;
    const out = [];
    for (const entry of envEntries) {
        if (entry.value !== undefined) {
            out.push(formatEnvFlag(entry.insideName, entry.value));
        }
    }
    // Handle expose section
    const exp = manifest?.expose;
    if (Array.isArray(exp)) {
        for (const spec of exp) {
            if (!spec || !spec.name) continue;
            if (Object.prototype.hasOwnProperty.call(spec, 'value')) {
                out.push(formatEnvFlag(spec.name, spec.value));
            } else if (spec.ref) {
                const v = resolveAlias('$' + spec.ref, secrets);
                if (v !== undefined) out.push(formatEnvFlag(spec.name, v ?? ''));
            }
        }
    } else if (exp && typeof exp === 'object') {
        for (const [name, val] of Object.entries(exp)) {
            if (typeof val === 'string' && val.startsWith('$')) {
                const v = resolveAlias(val, secrets);
                if (v !== undefined) out.push(formatEnvFlag(name, v ?? ''));
            } else if (val !== undefined) {
                out.push(formatEnvFlag(name, val));
            }
        }
    }
    return out;
}
```

### buildEnvMap(manifest)

**Purpose**: Builds environment variable map for manifest

**Returns**: (Object) Key-value map of environment variables

### updateAgentExpose(manifestPath, exposedName, src)

**Purpose**: Updates the expose section of an agent manifest

**Parameters**:
- `manifestPath` (string): Path to manifest.json
- `exposedName` (string): Variable name to expose
- `src` (string): Source value or $REF

### echoVar(nameOrAlias)

**Purpose**: Returns variable value for display

**Parameters**:
- `nameOrAlias` (string): Variable name or $VAR

**Returns**: (string) Formatted output

### exposeEnv(exposedName, valueOrRef, agentNameOpt)

**Purpose**: Exposes a variable to an agent

**Parameters**:
- `exposedName` (string): Variable name inside container
- `valueOrRef` (string): Value or $VAR reference
- `agentNameOpt` (string): Target agent name

**Returns**: `{agentName: string, manifestPath: string}`

## File Format

### .ploinky/secrets

```
# Ploinky secrets
APP_NAME=myapp
DATABASE_URL=postgres://localhost/db
API_KEY=$SHARED_KEY
SHARED_KEY=secret123
```

## Usage Example

```javascript
import {
    setEnvVar,
    parseSecrets,
    resolveVarValue,
    buildEnvFlags,
    exposeEnv
} from './secretVars.js';

// Set a variable
setEnvVar('DATABASE_URL', 'postgres://localhost/mydb');

// Set an alias
setEnvVar('DB_URL', '$DATABASE_URL');

// Resolve the alias
const resolved = resolveVarValue('DB_URL');
// 'postgres://localhost/mydb'

// Build flags for container
const manifest = { env: ['DATABASE_URL', 'API_KEY'] };
const flags = buildEnvFlags(manifest);
// ['-e DATABASE_URL="postgres://localhost/mydb"', '-e API_KEY="..."']

// Expose to agent
exposeEnv('DB_CONN', '$DATABASE_URL', 'postgres');
```

## Related Modules

- [service-config.md](../config/service-config.md) - SECRETS_FILE path
- [service-workspace.md](../workspace/service-workspace.md) - Workspace config
- [service-utils.md](./service-utils.md) - Agent lookup
