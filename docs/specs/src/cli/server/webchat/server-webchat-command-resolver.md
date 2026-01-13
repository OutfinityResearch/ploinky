# cli/server/webchat/commandResolver.js - Command Resolver

## Overview

Resolves CLI commands for WebChat sessions from routing configuration and agent manifests. Determines the appropriate host and container commands to execute for a webchat session based on the static agent configuration.

## Source File

`cli/server/webchat/commandResolver.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
```

## Internal Functions

### trimCommand(value)

**Purpose**: Trims and validates command string

**Parameters**:
- `value` (any): Value to trim

**Returns**: (string) Trimmed string or empty string

**Implementation**:
```javascript
function trimCommand(value) {
    if (!value) return '';
    const text = String(value).trim();
    return text.length ? text : '';
}
```

### readRoutingConfig(routingFilePath)

**Purpose**: Reads and parses routing configuration file

**Parameters**:
- `routingFilePath` (string): Path to routing.json

**Returns**: (Object|null) Parsed config or null

**Implementation**:
```javascript
function readRoutingConfig(routingFilePath) {
    try {
        const raw = fs.readFileSync(routingFilePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}
```

### extractManifestCli(manifest)

**Purpose**: Extracts CLI command from agent manifest

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string) CLI command or empty string

**Candidate Paths**:
1. `manifest.cli`
2. `manifest.commands.cli`
3. `manifest.run`
4. `manifest.commands.run`

**Implementation**:
```javascript
function extractManifestCli(manifest) {
    if (!manifest || typeof manifest !== 'object') return '';
    const candidates = [
        manifest.cli,
        manifest.commands && manifest.commands.cli,
        manifest.run,
        manifest.commands && manifest.commands.run
    ];
    for (const entry of candidates) {
        const candidate = trimCommand(entry);
        if (candidate) return candidate;
    }
    return '';
}
```

### resolveStaticAgentDetails(routingFilePath)

**Purpose**: Extracts static agent details from routing config

**Parameters**:
- `routingFilePath` (string): Path to routing.json

**Returns**: (Object) Agent details

**Return Structure**:
```javascript
{
    agentName: string,      // Agent identifier
    hostPath: string,       // Path on host
    containerName: string,  // Container name
    alias: string           // Agent alias
}
```

**Implementation**:
```javascript
function resolveStaticAgentDetails(routingFilePath) {
    const cfg = readRoutingConfig(routingFilePath);
    if (!cfg || !cfg.static) {
        return { agentName: '', hostPath: '', containerName: '', alias: '' };
    }
    const agentName = trimCommand(cfg.static.agent);
    const hostPath = trimCommand(cfg.static.hostPath);
    const containerName = trimCommand(cfg.static.container);
    const alias = trimCommand(cfg.static.alias);
    return { agentName, hostPath, containerName, alias };
}
```

### resolveCliTarget(record, fallbackName)

**Purpose**: Resolves CLI target from agent record

**Parameters**:
- `record` (Object): Agent record
- `fallbackName` (string): Fallback name

**Returns**: (string) CLI target

**Resolution Order**:
1. `record.alias`
2. `record.container`
3. `fallbackName`

**Implementation**:
```javascript
function resolveCliTarget(record = {}, fallbackName = '') {
    const alias = trimCommand(record.alias);
    if (alias) return alias;
    const container = trimCommand(record.container);
    if (container) return container;
    return trimCommand(fallbackName);
}
```

## Public API

### resolveWebchatCommands(options)

**Purpose**: Resolves webchat commands from routing config

**Parameters**:
- `options` (Object):
  - `routingFilePath` (string): Path to routing.json (default: `.ploinky/routing.json`)
  - `manifestPathOverride` (string): Override manifest path

**Returns**: (Object) Resolved commands

**Return Structure**:
```javascript
{
    host: string,       // Host command (e.g., "ploinky cli agent-name")
    container: string,  // Container command from manifest
    source: string,     // 'manifest' or 'unset'
    agentName: string,  // Agent identifier
    cliTarget: string,  // CLI target name
    cacheKey: string    // Cache key for factory
}
```

**Implementation**:
```javascript
function resolveWebchatCommands(options = {}) {
    const routingFilePath = options.routingFilePath || path.resolve('.ploinky/routing.json');
    const { agentName: staticAgentName, hostPath, containerName, alias } = resolveStaticAgentDetails(routingFilePath);

    if (!staticAgentName || !hostPath) {
        return { host: '', container: '', source: 'unset', agentName: '' };
    }

    const manifestPath = options.manifestPathOverride || path.join(hostPath, 'manifest.json');
    let manifestCli = '';
    try {
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifestCli = extractManifestCli(manifest);
        }
    } catch (_) {
        manifestCli = '';
    }

    if (!manifestCli) {
        // Return agent name even without manifest command
        // Other features like blob storage might depend on it
        return { host: '', container: '', source: 'unset', agentName: staticAgentName };
    }

    const cliTarget = resolveCliTarget({ alias, container: containerName }, staticAgentName);
    const hostCommand = cliTarget ? `ploinky cli ${cliTarget}` : '';
    return {
        host: hostCommand,
        container: manifestCli,
        source: 'manifest',
        agentName: staticAgentName,
        cliTarget,
        cacheKey: 'webchat'
    };
}
```

### resolveWebchatCommandsForAgent(agentRef, options)

**Purpose**: Resolves webchat commands for a specific agent

**Parameters**:
- `agentRef` (string): Agent reference/identifier
- `options` (Object):
  - `routingFilePath` (string): Path to routing.json

**Returns**: (Object|null) Resolved commands or null

**Implementation**:
```javascript
function resolveWebchatCommandsForAgent(agentRef, options = {}) {
    const routingFilePath = options.routingFilePath || path.resolve('.ploinky/routing.json');
    const routing = readRoutingConfig(routingFilePath);
    if (!routing) return null;

    const routes = routing.routes || {};
    let record = routes[agentRef];
    if (!record) {
        const staticAgent = trimCommand(routing.static?.agent);
        if (staticAgent && staticAgent === agentRef) {
            record = routing.static;
        }
    }

    if (!record || !record.hostPath) {
        return null;
    }

    const manifestPath = path.join(record.hostPath, 'manifest.json');
    let manifestCli = '';
    try {
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifestCli = extractManifestCli(manifest);
        }
    } catch (_) {
        manifestCli = '';
    }

    const cliTarget = resolveCliTarget(record, agentRef);
    const hostCommand = cliTarget ? `ploinky cli ${cliTarget}` : '';
    return {
        host: hostCommand,
        container: manifestCli,
        source: 'manifest',
        agentName: agentRef,
        cliTarget,
        cacheKey: `webchat:${agentRef}`
    };
}
```

## Exports

```javascript
export {
    resolveWebchatCommands,
    resolveWebchatCommandsForAgent,
    extractManifestCli,
    trimCommand
};
```

## Configuration Files

### routing.json Structure

```javascript
{
    "port": 8080,
    "static": {
        "agent": "my-agent",
        "hostPath": "/path/to/agent",
        "container": "ploinky_basic_my-agent_proj",
        "alias": "my-alias"
    },
    "routes": {
        "other-agent": {
            "hostPath": "/path/to/other",
            "container": "ploinky_basic_other-agent_proj"
        }
    }
}
```

### manifest.json CLI Fields

```javascript
{
    "cli": "./run.sh",           // Primary
    "commands": {
        "cli": "./run.sh",       // Alternative
        "run": "./run.sh"        // Alternative
    },
    "run": "./run.sh"            // Fallback
}
```

## Resolution Flow

```
┌────────────────────────────────────────────────────────────┐
│               Command Resolution Flow                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Read routing.json                                      │
│     │                                                      │
│  2. Extract static agent details                           │
│     ├── agentName                                          │
│     ├── hostPath                                           │
│     ├── containerName                                      │
│     └── alias                                              │
│     │                                                      │
│  3. Read manifest.json from hostPath                       │
│     │                                                      │
│  4. Extract CLI command from manifest                      │
│     ├── Try manifest.cli                                   │
│     ├── Try manifest.commands.cli                          │
│     ├── Try manifest.run                                   │
│     └── Try manifest.commands.run                          │
│     │                                                      │
│  5. Resolve CLI target                                     │
│     ├── Use alias if available                             │
│     ├── Use container name if available                    │
│     └── Use agent name as fallback                         │
│     │                                                      │
│  6. Generate host command                                  │
│     └── "ploinky cli <target>"                             │
│     │                                                      │
│  7. Return resolved commands                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { resolveWebchatCommands, resolveWebchatCommandsForAgent } from './commandResolver.js';

// Resolve for static agent
const commands = resolveWebchatCommands();
// {
//   host: 'ploinky cli my-agent',
//   container: './run.sh',
//   source: 'manifest',
//   agentName: 'my-agent',
//   cliTarget: 'my-agent',
//   cacheKey: 'webchat'
// }

// Resolve for specific agent
const agentCommands = resolveWebchatCommandsForAgent('other-agent');
// {
//   host: 'ploinky cli other-agent',
//   container: './other-run.sh',
//   source: 'manifest',
//   agentName: 'other-agent',
//   cliTarget: 'other-agent',
//   cacheKey: 'webchat:other-agent'
// }
```

## Related Modules

- [server-utils-tty-factories.md](../utils/server-utils-tty-factories.md) - Uses resolved commands
- [server-webchat-handler.md](../handlers/server-handlers-webchat.md) - WebChat handler
- [server-utils-router-env.md](../utils/server-utils-router-env.md) - Router configuration

