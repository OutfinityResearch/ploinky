# cli/services/docker/agentHooks.js - Agent Hooks

## Overview

Implements agent lifecycle hooks for installation and post-installation phases. Runs hook commands in temporary containers or within existing containers.

## Source File

`cli/services/docker/agentHooks.js`

## Dependencies

```javascript
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildEnvFlags } from '../secretVars.js';
import { normalizeLifecycleCommands } from './agentCommands.js';
import { containerRuntime, flagsToArgs, waitForContainerRunning } from './common.js';
```

## Constants

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');
```

## Internal Functions

### ensureSharedHostDir()

**Purpose**: Ensures shared host directory exists

**Returns**: (string) Path to shared directory

**Implementation**:
```javascript
function ensureSharedHostDir() {
    const dir = path.resolve(process.cwd(), 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}
```

## Public API

### runInstallHook(agentName, manifest, agentPath, cwd)

**Purpose**: Runs the install hook in a temporary container

**Parameters**:
- `agentName` (string): Agent name for logging
- `manifest` (Object): Agent manifest with install command
- `agentPath` (string): Path to agent code
- `cwd` (string): Working directory inside container

**Behavior**:
1. Creates temporary container with same image as agent
2. Mounts: cwd (rw), Agent library (ro), code (ro), shared (rw)
3. Optionally mounts node_modules if PLOINKY_ROOT is set
4. Injects environment variables from manifest
5. Runs install command in `/bin/sh -lc`

**Volume Mounts**:

| Host Path | Container Path | Mode |
|-----------|----------------|------|
| `$CWD` | `$CWD` | rw |
| `Agent/` | `/Agent` | ro |
| `$agentPath` | `/code` | ro |
| `shared/` | `/shared` | rw |
| `node_modules/` | `/node_modules` | ro (optional) |

**Implementation**:
```javascript
function runInstallHook(agentName, manifest, agentPath, cwd) {
    const installCmd = String(manifest.install || '').trim();
    if (!installCmd) return;

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = projectRoot ? path.join(projectRoot, 'node_modules') : null;
    const sharedDir = ensureSharedHostDir();
    const volZ = runtime === 'podman' ? ':z' : '';
    const roZ = runtime === 'podman' ? ':ro,z' : ':ro';

    const args = ['run', '--rm', '-w', cwd,
        '-v', `${cwd}:${cwd}${volZ}`,
        '-v', `${AGENT_LIB_PATH}:/Agent${roZ}`,
        '-v', `${path.resolve(agentPath)}:/code${roZ}`,
        '-v', `${sharedDir}:/shared${volZ}`
    ];
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }
    if (nodeModulesPath) {
        args.push('-v', `${nodeModulesPath}:/node_modules${roZ}`);
    }
    const envFlags = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags.length) args.push(...envFlags);
    console.log(`[install] ${agentName}: cd '${cwd}' && ${installCmd}`);
    args.push(image, '/bin/sh', '-lc', `cd '${cwd}' && ${installCmd}`);
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error(`[install] ${agentName}: command exited with ${res.status}`);
    }
}
```

### runPostinstallHook(agentName, containerName, manifest, cwd)

**Purpose**: Runs postinstall commands inside a running container

**Parameters**:
- `agentName` (string): Agent name for logging
- `containerName` (string): Container to exec into
- `manifest` (Object): Agent manifest with postinstall commands
- `cwd` (string): Working directory inside container

**Behavior**:
1. Waits for container to be running
2. Executes each postinstall command sequentially
3. Restarts container after all commands complete
4. Waits for container to be running after restart

**Implementation**:
```javascript
function runPostinstallHook(agentName, containerName, manifest, cwd) {
    const commands = normalizeLifecycleCommands(manifest?.postinstall);
    if (!commands.length) return;

    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[postinstall] ${agentName}: container not running; cannot execute postinstall commands.`);
    }

    for (const cmd of commands) {
        console.log(`[postinstall] ${agentName}: cd '${cwd}' && ${cmd}`);
        const res = spawnSync(containerRuntime, ['exec', containerName, 'sh', '-lc', `cd '${cwd}' && ${cmd}`], { stdio: 'inherit' });
        if (res.status !== 0) {
            throw new Error(`[postinstall] ${agentName}: command exited with ${res.status}`);
        }
    }

    console.log(`[postinstall] ${agentName}: restarting container ${containerName}`);
    const restartRes = spawnSync(containerRuntime, ['restart', containerName], { stdio: 'inherit' });
    if (restartRes.status !== 0) {
        throw new Error(`[postinstall] ${agentName}: restart failed with code ${restartRes.status}`);
    }

    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[postinstall] ${agentName}: container did not reach running state after restart.`);
    }
}
```

## Exports

```javascript
export {
    ensureSharedHostDir,
    runInstallHook,
    runPostinstallHook
};
```

## Hook Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Startup Hooks                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. hosthook_aftercreation (host)                               │
│     │ - Runs on host before container starts                    │
│     │ - Can prepare files, generate configs                     │
│     ▼                                                           │
│  2. install (temporary container)                               │
│     │ - runInstallHook()                                        │
│     │ - Runs in fresh container with same image                 │
│     │ - Code mounted read-only                                  │
│     │ - Good for npm install, pip install                       │
│     ▼                                                           │
│  3. Container starts                                            │
│     │ - Main agent process begins                               │
│     ▼                                                           │
│  4. postinstall (running container)                             │
│     │ - runPostinstallHook()                                    │
│     │ - Runs inside the agent container                         │
│     │ - Container restarted after completion                    │
│     ▼                                                           │
│  5. hosthook_postinstall (host)                                 │
│     │ - Runs on host after container is ready                   │
│     │ - Can validate, register, notify                          │
│     ▼                                                           │
│  6. Agent ready for traffic                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { runInstallHook, runPostinstallHook } from './agentHooks.js';

const manifest = {
    image: 'node:18-alpine',
    install: 'npm ci --production',
    postinstall: ['npm run build', 'npm run migrate']
};

// Run install in temporary container
runInstallHook('node-dev', manifest, '/path/to/agent', '/code');

// Run postinstall in running container
runPostinstallHook('node-dev', 'ploinky_basic_node-dev_proj_abc', manifest, '/code');
```

## Related Modules

- [docker-agent-commands.md](./docker-agent-commands.md) - Command normalization
- [docker-common.md](./docker-common.md) - Container utilities
- [docker-agent-service-manager.md](./docker-agent-service-manager.md) - Agent lifecycle
- [service-secret-vars.md](../utils/service-secret-vars.md) - Environment flags
