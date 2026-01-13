# cli/services/workspaceUtil.js - Workspace Utilities

## Overview

High-level workspace management utilities including workspace startup, CLI execution, shell access, and agent refresh operations. Orchestrates agent enabling, container management, and router lifecycle.

## Source File

`cli/services/workspaceUtil.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as utils from './utils.js';
import * as agentsSvc from './agents.js';
import * as workspaceSvc from './workspace.js';
import * as dockerSvc from './docker/index.js';
import { applyManifestDirectives } from './bootstrapManifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

## Internal Functions

### getAgentCmd(manifest)

**Purpose**: Gets agent run command from manifest

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string) Agent command or empty string

**Implementation**:
```javascript
function getAgentCmd(manifest) {
    return (manifest.agent && String(manifest.agent)) ||
           (manifest.commands && manifest.commands.run) || '';
}
```

### getCliCmd(manifest)

**Purpose**: Gets CLI command from manifest with default fallback

**Parameters**:
- `manifest` (Object): Agent manifest

**Returns**: (string) CLI command (defaults to '/Agent/default_cli.sh')

**Implementation**:
```javascript
function getCliCmd(manifest) {
    const explicitCli = (manifest.cli && String(manifest.cli)) ||
        (manifest.commands && manifest.commands.cli);

    if (explicitCli) {
        return explicitCli;
    }

    return '/Agent/default_cli.sh';
}
```

### shellQuote(str)

**Purpose**: Safely quotes string for shell execution

**Parameters**:
- `str` (string): String to quote

**Returns**: (string) Safely quoted string

**Implementation**:
```javascript
function shellQuote(str) {
    if (str === undefined || str === null) return "''";
    const s = String(str);
    if (s.length === 0) return "''";
    return `'${s.replace(/'/g, "'\\''")}'`;
}
```

### wrapCliWithWebchat(command)

**Purpose**: Optionally wraps CLI command with webchat interface

**Parameters**:
- `command` (string): Original CLI command

**Returns**: (string) Wrapped or original command

**Environment Variables**:
- `PLOINKY_SKIP_MANIFEST_CLI_WEBCHAT=1` - Skip wrapping
- `PLOINKY_MANIFEST_CLI_WEBCHAT=1` - Enable wrapping

**Implementation**:
```javascript
function wrapCliWithWebchat(command) {
    const trimmed = (command || '').trim();
    if (!trimmed) return trimmed;
    if (process.env.PLOINKY_SKIP_MANIFEST_CLI_WEBCHAT === '1') {
        return trimmed;
    }
    const enableWrap = process.env.PLOINKY_MANIFEST_CLI_WEBCHAT === '1';
    if (!enableWrap) {
        return trimmed;
    }
    if (/^(?:\/Agent\/bin\/)?webchat\b/.test(trimmed) ||
        /^ploinky\s+webchat\b/.test(trimmed)) {
        return trimmed;
    }
    return `/Agent/bin/webchat -- ${shellQuote(trimmed)}`;
}
```

### findAgentManifest(agentName)

**Purpose**: Finds manifest path for an agent

**Parameters**:
- `agentName` (string): Agent name or repo/agent

**Returns**: (string) Path to manifest.json

**Implementation**:
```javascript
function findAgentManifest(agentName) {
    const { manifestPath } = utils.findAgent(agentName);
    return manifestPath;
}
```

## Public API

### startWorkspace(staticAgentArg, portArg, options)

**Purpose**: Starts the workspace with a static agent and launches the router

**Parameters**:
- `staticAgentArg` (string): Static agent name (optional for subsequent starts)
- `portArg` (string|number): Port number (default: 8080)
- `options` (Object):
  - `refreshComponentToken` (Function): Token refresh callback
  - `ensureComponentToken` (Function): Token ensure callback
  - `enableAgent` (Function): Custom agent enabler
  - `killRouterIfRunning` (Function): Router kill callback

**Behavior**:
1. Enables static agent if not already enabled
2. Applies manifest directives (repos, enable sections)
3. Deduplicates agent registry entries
4. Processes enable directives from static agent manifest
5. Creates container services for all agents
6. Updates routing configuration
7. Spawns Watchdog process in background
8. Outputs dashboard URL

**Implementation** (key sections):
```javascript
async function startWorkspace(staticAgentArg, portArg, options = {}) {
    // Resolve static agent and enable if needed
    if (staticAgentArg) {
        let alreadyEnabled = false;
        // Check if already enabled
        // Enable if needed
        if (!alreadyEnabled) {
            agentsSvc.enableAgent(staticAgentArg);
        }

        // Save static config
        const cfg = workspaceSvc.getConfig() || {};
        cfg.static = { agent: staticAgentArg, port: parseInt(portArg || '0', 10) || 8080 };
        workspaceSvc.setConfig(cfg);
    }

    // Apply manifest directives
    await applyManifestDirectives(cfg0.static.agent);

    // Deduplicate registry
    const dedup = {};
    // ... deduplication logic

    // Ensure agent services
    for (const name of names) {
        const { containerName, hostPort } = dockerSvc.ensureAgentService(
            shortAgentName, manifest, agentPath,
            { containerName: name, alias: rec.alias }
        );
        cfg.routes[routeKey] = { container: containerName, hostPort, ... };
    }

    // Save routing config
    fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));

    // Spawn watchdog
    const child = spawn(process.execPath, [routerPath], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, PORT: String(staticPort) }
    });
    child.unref();

    console.log(`[start] Dashboard: http://127.0.0.1:${staticPort}/dashboard`);
}
```

### runCli(agentName, args)

**Purpose**: Runs CLI command inside agent container

**Parameters**:
- `agentName` (string): Agent name or alias
- `args` (string[]): Additional CLI arguments

**Behavior**:
1. Resolves agent from registry or name
2. Gets CLI command from manifest
3. Optionally wraps with webchat
4. Ensures agent container is running
5. Attaches interactive session

**Implementation**:
```javascript
async function runCli(agentName, args) {
    if (!agentName) {
        throw new Error('Usage: cli <agentName> [args...]');
    }

    // Resolve agent
    const registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
    const manifestLookup = registryRecord
        ? `${registryRecord.record.repoName}/${registryRecord.record.agentName}`
        : agentName;

    const { manifestPath, shortAgentName } = utils.findAgent(manifestLookup);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Get and wrap CLI command
    const cliBase = getCliCmd(manifest);
    const rawCmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
    const cmd = wrapCliWithWebchat(rawCmd);

    // Ensure container and attach
    const containerInfo = dockerSvc.ensureAgentService(shortAgentName, manifest, agentDir);
    dockerSvc.attachInteractive(containerName, projPath, cmd);
}
```

### runShell(agentName)

**Purpose**: Opens interactive shell in agent container

**Parameters**:
- `agentName` (string): Agent name or alias

**Behavior**:
1. Resolves agent from registry
2. Ensures container is running
3. Attaches interactive `/bin/sh` session

**Implementation**:
```javascript
async function runShell(agentName) {
    if (!agentName) {
        throw new Error('Usage: shell <agentName>');
    }

    // Resolve agent
    const registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
    const { manifestPath, shortAgentName } = utils.findAgent(manifestLookup);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Ensure container and attach shell
    const containerInfo = dockerSvc.ensureAgentService(shortAgentName, manifest, agentDir);
    const cmd = '/bin/sh';

    console.log(`[shell] container: ${containerName}`);
    console.log(`[shell] command: ${cmd}`);
    console.log(`[shell] agent: ${shortAgentName}`);

    dockerSvc.attachInteractive(containerName, projPath, cmd);
}
```

### refreshAgent(agentName)

**Purpose**: Refreshes (re-creates) an agent container

**Parameters**:
- `agentName` (string): Agent name or alias

**Behavior**:
1. Validates agent is currently running
2. Stops and removes existing container
3. Creates new container with same configuration
4. Updates routing configuration
5. Starts router if not running

**Implementation**:
```javascript
async function refreshAgent(agentName) {
    if (!agentName) {
        throw new Error('Usage: refresh agent <name>');
    }

    const { stopAndRemove, ensureAgentService, isContainerRunning } = dockerSvc;

    // Resolve and validate
    const registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
    const resolved = utils.findAgent(lookup);
    const containerName = registryRecord?.containerName;

    if (!isContainerRunning(containerName)) {
        console.error(`Agent '${agentName}' is not running.`);
        return;
    }

    console.log(`Refreshing (re-creating) agent '${agentName}'...`);

    // Stop, remove, and recreate
    stopAndRemove(containerName);
    const { containerName: newContainerName, hostPort } = await ensureAgentService(
        short, manifest, agentPath
    );

    // Update routing
    cfg.routes[routeKey] = {
        container: newContainerName,
        hostPort,
        ...
    };
    fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));

    // Ensure router is running
    if (!isRouterUp(cfg.port)) {
        const child = spawn(process.execPath, [routerPath], { ... });
        console.log(`[refresh] Watchdog launched (pid ${child.pid})`);
    }
}
```

## Exports

```javascript
export { startWorkspace, runCli, runShell, refreshAgent };
```

## Routing Configuration

Location: `.ploinky/routing.json`

```json
{
    "port": 8080,
    "static": {
        "agent": "basic/node-dev",
        "container": "ploinky_basic_node-dev_proj_abc",
        "hostPath": "/path/to/agent"
    },
    "routes": {
        "node-dev": {
            "container": "ploinky_basic_node-dev_proj_abc",
            "hostPath": "/path/to/agent",
            "repo": "basic",
            "agent": "node-dev",
            "hostPort": 3001
        }
    }
}
```

## Usage Example

```javascript
import { startWorkspace, runCli, runShell, refreshAgent } from './workspaceUtil.js';

// Start workspace with static agent
await startWorkspace('basic/node-dev', 8080, {
    killRouterIfRunning: () => { /* kill logic */ }
});

// Run CLI command
await runCli('node-dev', ['--help']);

// Open shell
await runShell('node-dev');

// Refresh (recreate) agent
await refreshAgent('node-dev');
```

## Related Modules

- [service-workspace.md](./service-workspace.md) - Workspace storage
- [service-agents.md](../agents/service-agents.md) - Agent management
- [docker-index.md](../docker/docker-index.md) - Container operations
- [server-watchdog.md](../../server/server-watchdog.md) - Process management
