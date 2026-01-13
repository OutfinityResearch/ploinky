# cli/services/docker/agentCommands.js - Agent Commands

## Overview

Provides utilities for parsing agent manifest commands and launching sidecar processes in containers. Handles the `start` and `agent` commands from manifest files.

## Source File

`cli/services/docker/agentCommands.js`

## Dependencies

```javascript
import { spawnSync } from 'child_process';
import { containerRuntime, flagsToArgs, waitForContainerRunning } from './common.js';
```

## Constants

```javascript
const DEFAULT_AGENT_ENTRY = 'sh /Agent/server/AgentServer.sh';
```

## Public API

### readManifestStartCommand(manifest)

**Purpose**: Extracts the `start` command from manifest

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string) Start command or empty string

**Implementation**:
```javascript
function readManifestStartCommand(manifest) {
    if (!manifest) return '';
    const value = manifest.start;
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed;
}
```

### readManifestAgentCommand(manifest)

**Purpose**: Extracts the agent command from manifest with fallback

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**:
```javascript
{
    raw: string,      // Original command from manifest
    resolved: string  // Command to use (with default fallback)
}
```

**Resolution Order**:
1. `manifest.agent`
2. `manifest.commands.run`
3. Default: `sh /Agent/server/AgentServer.sh`

**Implementation**:
```javascript
function readManifestAgentCommand(manifest) {
    if (!manifest) return { raw: '', resolved: DEFAULT_AGENT_ENTRY };
    const rawValue = ((manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '').trim();
    return {
        raw: rawValue,
        resolved: rawValue || DEFAULT_AGENT_ENTRY
    };
}
```

### splitCommandArgs(command)

**Purpose**: Splits a command string into arguments array

**Parameters**:
- `command` (string): Command string

**Returns**: (string[]) Array of arguments

**Implementation**:
```javascript
function splitCommandArgs(command) {
    const trimmed = typeof command === 'string' ? command.trim() : '';
    if (!trimmed) return [];
    return flagsToArgs([trimmed]);
}
```

### launchAgentSidecar({ containerName, agentCommand, agentName })

**Purpose**: Launches a sidecar command in a running container

**Parameters**:
- `containerName` (string): Container name
- `agentCommand` (string): Command to execute
- `agentName` (string): Agent name for logging

**Behavior**:
1. Waits for container to be running (max 10 seconds)
2. Executes command in detached mode (`-d`)
3. Throws on failure

**Implementation**:
```javascript
function launchAgentSidecar({ containerName, agentCommand, agentName }) {
    const command = (agentCommand || '').trim();
    if (!command) return;
    const startArgs = splitCommandArgs(command);
    if (!startArgs.length) return;
    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[start] ${agentName || containerName}: container not running; cannot launch agent command.`);
    }
    const execArgs = ['exec', '-d', containerName, ...startArgs];
    const execRes = spawnSync(containerRuntime, execArgs, { stdio: 'inherit' });
    if (execRes.status !== 0) {
        throw new Error(`[start] ${agentName || containerName}: failed to launch start command (exit ${execRes.status}).`);
    }
    console.log(`[start] ${agentName || containerName}: start command launched directly.`);
}
```

### normalizeLifecycleCommands(entry)

**Purpose**: Normalizes lifecycle commands to array format

**Parameters**:
- `entry` (string|string[]): Command(s) from manifest

**Returns**: (string[]) Array of commands

**Implementation**:
```javascript
function normalizeLifecycleCommands(entry) {
    if (Array.isArray(entry)) {
        return entry
            .filter((cmd) => typeof cmd === 'string')
            .map((cmd) => cmd.trim())
            .filter(Boolean);
    }
    if (typeof entry === 'string') {
        const trimmed = entry.trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
}
```

## Exports

```javascript
export {
    DEFAULT_AGENT_ENTRY,
    launchAgentSidecar,
    normalizeLifecycleCommands,
    readManifestAgentCommand,
    readManifestStartCommand,
    splitCommandArgs
};
```

## Manifest Command Fields

| Field | Description | Default |
|-------|-------------|---------|
| `start` | Sidecar command to run after container starts | (none) |
| `agent` | Main agent process command | `sh /Agent/server/AgentServer.sh` |
| `commands.run` | Alternate agent command location | (none) |

## Usage Example

```javascript
import {
    readManifestAgentCommand,
    readManifestStartCommand,
    launchAgentSidecar
} from './agentCommands.js';

const manifest = {
    agent: 'node /code/server.js',
    start: 'npm run worker'
};

// Get agent command
const { raw, resolved } = readManifestAgentCommand(manifest);
console.log('Agent command:', resolved);

// Get start command
const startCmd = readManifestStartCommand(manifest);
console.log('Start command:', startCmd);

// Launch sidecar after container is running
launchAgentSidecar({
    containerName: 'ploinky_basic_node-dev_proj_abc123',
    agentCommand: startCmd,
    agentName: 'node-dev'
});
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container utilities
- [docker-agent-service-manager.md](./docker-agent-service-manager.md) - Agent lifecycle
- [docker-agent-hooks.md](./docker-agent-hooks.md) - Lifecycle hooks
