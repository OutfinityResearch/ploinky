# cli/services/lifecycleHooks.js - Lifecycle Hooks

## Overview

Implements the complete profile lifecycle for agent startup. Provides functions to execute hooks on the host and within containers, managing the full 12-step agent initialization process. Profile-specific `env` values are merged into the hook environment and secrets are validated before hook execution.

## Source File

`cli/services/lifecycleHooks.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { containerRuntime } from './docker/common.js';
import { debugLog } from './utils.js';
import { getProfileConfig, getProfileEnvVars } from './profileService.js';
import { validateSecrets, getSecrets, createEnvWithSecrets, formatMissingSecretsError } from './secretInjector.js';
import { installDependencies } from './dependencyInstaller.js';
import {
    initWorkspaceStructure,
    createAgentSymlinks,
    createAgentWorkDir
} from './workspaceStructure.js';
```

## Public API

### executeHostHook(scriptPath, env, options)

**Purpose**: Executes a hook script on the host machine

**Parameters**:
- `scriptPath` (string): Path to script
- `env` (Object): Environment variables
- `options` (Object):
  - `cwd` (string): Working directory (default: process.cwd())
  - `timeout` (number): Timeout in ms (default: 300000)

**Returns**: `{ success: boolean, message: string, output?: string }`

**Behavior**:
1. Resolves script path (absolute or relative to cwd)
2. Makes script executable (chmod 755)
3. Executes with merged environment
4. Captures stdout/stderr

**Implementation**:
```javascript
export function executeHostHook(scriptPath, env = {}, options = {}) {
    const { cwd = process.cwd(), timeout = 300000 } = options;

    if (!scriptPath) {
        return { success: true, message: 'No hook script specified' };
    }

    const resolvedPath = path.isAbsolute(scriptPath) ? scriptPath : path.join(cwd, scriptPath);

    if (!fs.existsSync(resolvedPath)) {
        return { success: false, message: `Hook script not found: ${resolvedPath}` };
    }

    try {
        fs.chmodSync(resolvedPath, '755');
    } catch (_) {}

    const hookEnv = {
        ...process.env,
        ...env,
        PLOINKY_HOOK_TYPE: 'host'
    };

    try {
        debugLog(`[hook] Executing host hook: ${resolvedPath}`);
        const output = execSync(resolvedPath, {
            cwd,
            env: hookEnv,
            stdio: 'pipe',
            timeout
        }).toString();

        return { success: true, message: 'Hook executed successfully', output };
    } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        const stdout = err.stdout ? err.stdout.toString() : '';
        return {
            success: false,
            message: `Hook execution failed: ${err.message}`,
            output: stdout + stderr
        };
    }
}
```

### executeContainerHook(containerName, script, env, options)

**Purpose**: Executes a hook script inside a running container

**Parameters**:
- `containerName` (string): Container name
- `script` (string): Script content or command
- `env` (Object): Environment variables
- `options` (Object):
  - `timeout` (number): Timeout in ms (default: 300000)
  - `workdir` (string): Working directory (default: '/code')

**Returns**: `{ success: boolean, message: string, output?: string }`

**Implementation**:
```javascript
export function executeContainerHook(containerName, script, env = {}, options = {}) {
    const { timeout = 300000, workdir = '/code' } = options;

    if (!script) {
        return { success: true, message: 'No hook script specified' };
    }

    try {
        const envFlags = [];
        for (const [key, value] of Object.entries(env)) {
            envFlags.push('-e', `${key}=${String(value ?? '')}`);
        }

        debugLog(`[hook] Executing container hook in ${containerName}: ${script}`);
        const result = spawnSync(containerRuntime, [
            'exec',
            ...envFlags,
            '-w',
            workdir,
            containerName,
            'sh',
            '-c',
            script
        ], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout
        });

        if (result.status === 0) {
            return { success: true, message: 'Hook executed successfully', output: result.stdout };
        }

        const output = `${result.stdout || ''}${result.stderr || ''}`;
        const errorMessage = result.error ? result.error.message : `command exited with ${result.status}`;
        return {
            success: false,
            message: `Hook execution failed: ${errorMessage}`,
            output
        };
    } catch (err) {
        return {
            success: false,
            message: `Hook execution failed: ${err.message}`,
            output: err.output ? err.output.toString() : ''
        };
    }
}
```

### runProfileLifecycle(agentName, profileName, options)

**Purpose**: Runs the complete 12-step profile lifecycle

**Parameters**:
- `agentName` (string): Agent name
- `profileName` (string): Profile name
- `options` (Object):
  - `containerName` (string): Container name
  - `agentPath` (string): Path to agent directory
  - `repoName` (string): Repository name
  - `manifest` (Object): Agent manifest
  - `skipContainer` (boolean): Skip container steps
  - `verbose` (boolean): Verbose logging

**Returns**:
```javascript
{
    success: boolean,
    steps: [{
        step: number,
        name: string,
        success: boolean,
        error?: string,
        output?: string
    }],
    errors: string[]
}
```

**Lifecycle Steps**:

| Step | Name | Location | Description |
|------|------|----------|-------------|
| 1 | workspace_init | HOST | Initialize workspace structure |
| 2 | symlinks | HOST | Create symbolic links |
| 3 | container_create | EXTERNAL | Container creation (handled externally) |
| 4 | hosthook_aftercreation | HOST | Post-creation host hook |
| 5 | container_start | EXTERNAL | Container start (handled externally) |
| 6-7 | dependencies | CONTAINER | Install dependencies |
| 8 | preinstall | CONTAINER | Pre-install hook |
| 9 | install | CONTAINER | Install hook |
| 10 | postinstall | CONTAINER | Post-install hook |
| 11 | hosthook_postinstall | HOST | Post-install host hook |
| 12 | agent_ready | N/A | Final status |

### runPreContainerLifecycle(agentName, repoName, agentPath)

**Purpose**: Runs pre-container steps only

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `agentPath` (string): Path to agent directory

**Returns**: `{ success: boolean, errors: string[] }`

**Steps**: workspace_init, symlinks

### runPostStartLifecycle(containerName, agentName, profileName, options)

**Purpose**: Runs post-container-start steps

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name
- `profileName` (string): Profile name
- `options` (Object): repoName, agentPath, verbose

**Returns**: `{ success: boolean, errors: string[] }`

**Steps**: dependencies, preinstall, install, postinstall, hosthook_postinstall

**Notes**:
- Validates required secrets before executing container hooks.
- Merges `profiles.<name>.env` into the hook environment.

### printLifecycleSummary(result)

**Purpose**: Prints formatted lifecycle summary

**Parameters**:
- `result` (Object): Result from runProfileLifecycle

**Output Format**:
```
Lifecycle Summary:
------------------
  ✓ Step 1: workspace init
  ✓ Step 2: symlinks
  ✓ Step 4: hosthook aftercreation
  ...

All lifecycle steps completed successfully.
```

## Exports

```javascript
export {
    executeHostHook,
    executeContainerHook,
    runProfileLifecycle,
    runPreContainerLifecycle,
    runPostStartLifecycle,
    printLifecycleSummary
};
```

## Profile Configuration Hooks

```json
{
    "profiles": {
        "prod": {
            "secrets": ["API_KEY", "DB_PASSWORD"],
            "hosthook_aftercreation": "scripts/setup-host.sh",
            "preinstall": "npm ci --production",
            "install": "npm run build",
            "postinstall": "npm run migrate",
            "hosthook_postinstall": "scripts/notify-ready.sh"
        }
    }
}
```

## Environment Variables Passed to Hooks

- `PLOINKY_HOOK_TYPE` - 'host' or 'container'
- `PLOINKY_PROFILE` - Active profile
- `PLOINKY_PROFILE_ENV` - Environment (development/qa/production)
- `PLOINKY_AGENT_NAME` - Agent name
- `PLOINKY_REPO_NAME` - Repository name
- `PLOINKY_CWD` - Current working directory
- `PLOINKY_CONTAINER_NAME` - Container name
- Plus any secrets from profile configuration

## Usage Example

```javascript
import {
    runProfileLifecycle,
    printLifecycleSummary,
    executeHostHook
} from './lifecycleHooks.js';

// Run full lifecycle
const result = runProfileLifecycle('node-dev', 'prod', {
    containerName: 'ploinky_basic_node-dev_proj_abc',
    agentPath: '/path/to/agent',
    repoName: 'basic',
    verbose: true
});

printLifecycleSummary(result);

if (!result.success) {
    console.error('Lifecycle errors:', result.errors);
}

// Run single host hook
const hookResult = executeHostHook('scripts/setup.sh', {
    MY_VAR: 'value'
}, {
    cwd: '/path/to/agent',
    timeout: 60000
});
```

## Related Modules

- [service-profile.md](./service-profile.md) - Profile configuration
- [service-secret-injector.md](./service-secret-injector.md) - Secret handling
- [service-dependency-installer.md](./service-dependency-installer.md) - Dependencies
- [service-workspace-structure.md](../workspace/service-workspace-structure.md) - Workspace setup
