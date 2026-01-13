# cli/services/bootstrapManifest.js - Bootstrap Manifest

## Overview

Applies manifest directives during agent bootstrap. Processes `repos` and `enable` sections from manifest files to automatically add repositories and enable dependent agents.

## Source File

`cli/services/bootstrapManifest.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import * as repos from './repos.js';
import { enableAgent } from './agents.js';
import { findAgent } from './utils.js';
```

## Internal Functions

### parseEnableDirective(entry)

**Purpose**: Parses an enable directive string

**Parameters**:
- `entry` (string|any): Enable directive

**Returns**: `{ spec: string, alias: string|undefined }` or null

**Syntax**:
- `"repo/agent"` - Enable agent from repo
- `"repo/agent as myalias"` - Enable with alias

**Implementation**:
```javascript
function parseEnableDirective(entry) {
    if (entry === null || entry === undefined) return null;
    const raw = typeof entry === 'string' ? entry : String(entry || '').trim();
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    const aliasIndex = tokens.findIndex(token => token.toLowerCase() === 'as');
    let alias;
    if (aliasIndex !== -1) {
        if (aliasIndex + 1 >= tokens.length) {
            throw new Error(`manifest enable entry '${entry}' is missing alias name after "as"`);
        }
        alias = tokens[aliasIndex + 1];
        tokens.splice(aliasIndex);
    }

    const spec = tokens.join(' ').trim();
    if (!spec) {
        throw new Error(`manifest enable entry '${entry}' is missing agent reference`);
    }
    return { spec, alias };
}
```

## Public API

### applyManifestDirectives(agentNameOrPath)

**Purpose**: Applies repos and enable directives from a manifest

**Parameters**:
- `agentNameOrPath` (string): Agent name, repo/agent, or path to manifest.json

**Behavior**:
1. Loads manifest from path or finds agent manifest
2. Processes `repos` section: adds and enables repositories
3. Processes `enable` section: enables listed agents

**Manifest Sections**:

#### repos
Adds and enables repositories:
```json
{
    "repos": {
        "basic": "https://github.com/org/basic-agents.git",
        "custom": "https://github.com/org/custom-agents.git"
    }
}
```

#### enable
Enables dependent agents:
```json
{
    "enable": [
        "basic/node-dev",
        "basic/python-dev as python",
        "custom/file-parser"
    ]
}
```

**Implementation**:
```javascript
export async function applyManifestDirectives(agentNameOrPath) {
    let manifest;
    let baseDir;
    if (agentNameOrPath.endsWith('.json')) {
        manifest = JSON.parse(fs.readFileSync(agentNameOrPath, 'utf8'));
        baseDir = path.dirname(agentNameOrPath);
    } else {
        const { manifestPath } = findAgent(agentNameOrPath);
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        baseDir = path.dirname(manifestPath);
    }

    // Process repos section
    const r = manifest.repos;
    if (r && typeof r === 'object') {
        for (const [name, url] of Object.entries(r)) {
            try {
                repos.addRepo(name, url);
            } catch (_) {}
            try {
                repos.enableRepo(name);
            } catch (e) {}
        }
    }

    // Process enable section
    const en = manifest.enable;
    if (Array.isArray(en)) {
        for (const rawEntry of en) {
            try {
                const parsed = parseEnableDirective(rawEntry);
                if (!parsed) continue;
                enableAgent(parsed.spec, undefined, undefined, parsed.alias);
            } catch (err) {
                const message = err && err.message ? err.message : String(err);
                console.error(`[manifest enable] Failed to enable agent '${rawEntry}': ${message}`);
            }
        }
    }
}
```

## Exports

```javascript
export { applyManifestDirectives };
```

## Manifest Directive Examples

### Simple Dependencies

```json
{
    "name": "my-agent",
    "enable": [
        "basic/node-dev",
        "basic/file-parser"
    ]
}
```

### With Repositories

```json
{
    "name": "full-stack-agent",
    "repos": {
        "frontend": "https://github.com/org/frontend-agents.git",
        "backend": "https://github.com/org/backend-agents.git"
    },
    "enable": [
        "frontend/react-dev as frontend",
        "backend/express-api as backend"
    ]
}
```

### With Aliases

```json
{
    "name": "orchestrator",
    "enable": [
        "basic/node-dev as primary-node",
        "basic/node-dev as secondary-node"
    ]
}
```

## Error Handling

- Missing alias after "as" throws error
- Missing agent reference throws error
- Repository add/enable errors are silently ignored
- Agent enable errors are logged but don't stop processing

## Usage Example

```javascript
import { applyManifestDirectives } from './bootstrapManifest.js';

// Apply from agent name
await applyManifestDirectives('basic/orchestrator');

// Apply from manifest path
await applyManifestDirectives('/path/to/manifest.json');
```

## Related Modules

- [service-repos.md](../agents/service-repos.md) - Repository management
- [service-agents.md](../agents/service-agents.md) - Agent enabling
- [service-utils.md](./service-utils.md) - findAgent utility
