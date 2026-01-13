# cli/services/dependencyInstaller.js - Dependency Installer

## Overview

Manages npm dependency installation inside agent containers. Implements the dependency merging strategy where core dependencies take precedence over agent dependencies, with caching support to avoid redundant installations.

## Source File

`cli/services/dependencyInstaller.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { containerRuntime } from './docker/common.js';
import { TEMPLATES_DIR } from './config.js';
import { getAgentWorkDir, getAgentCodePath, getPackageBaseTemplatePath } from './workspaceStructure.js';
import { debugLog } from './utils.js';
```

## Internal Functions

### dockerExec(containerName, command, options)

**Purpose**: Executes a command inside a running container

**Parameters**:
- `containerName` (string): Target container name
- `command` (string): Shell command to execute
- `options` (Object): execSync options

**Returns**: (string) Command output trimmed

**Implementation**:
```javascript
function dockerExec(containerName, command, options = {}) {
    const cmd = `${containerRuntime} exec ${containerName} sh -c "${command.replace(/"/g, '\\"')}"`;
    debugLog(`dockerExec: ${cmd}`);
    return execSync(cmd, { stdio: options.stdio || 'pipe', ...options }).toString().trim();
}
```

### fileExistsInContainer(containerName, filePath)

**Purpose**: Checks if a file exists inside the container

**Parameters**:
- `containerName` (string): Target container
- `filePath` (string): Path to check

**Returns**: (boolean) True if file exists

**Implementation**:
```javascript
function fileExistsInContainer(containerName, filePath) {
    try {
        dockerExec(containerName, `test -f ${filePath} && echo "yes"`);
        return true;
    } catch (_) {
        return false;
    }
}
```

### dirExistsInContainer(containerName, dirPath)

**Purpose**: Checks if a directory exists inside the container

**Parameters**:
- `containerName` (string): Target container
- `dirPath` (string): Path to check

**Returns**: (boolean) True if directory exists

**Implementation**:
```javascript
function dirExistsInContainer(containerName, dirPath) {
    try {
        dockerExec(containerName, `test -d ${dirPath} && echo "yes"`);
        return true;
    } catch (_) {
        return false;
    }
}
```

### readPackageBaseTemplate()

**Purpose**: Reads the base package.json template

**Returns**: (Object) Parsed package.json template

**Default Template**:
```javascript
{
    name: 'ploinky-agent-runtime',
    version: '1.0.0',
    type: 'module',
    dependencies: {
        'achillesAgentLib': 'github:OutfinityResearch/achillesAgentLib',
        'mcp-sdk': 'github:PloinkyRepos/MCPSDK#main',
        'node-pty': '^1.0.0',
        'flexsearch': 'github:PloinkyRepos/flexsearch#main'
    }
}
```

**Implementation**:
```javascript
function readPackageBaseTemplate() {
    const templatePath = getPackageBaseTemplatePath();
    if (fs.existsSync(templatePath)) {
        return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    }
    // Return default template if file doesn't exist
    return {
        name: 'ploinky-agent-runtime',
        version: '1.0.0',
        type: 'module',
        dependencies: {
            'achillesAgentLib': 'github:OutfinityResearch/achillesAgentLib',
            'mcp-sdk': 'github:PloinkyRepos/MCPSDK#main',
            'node-pty': '^1.0.0',
            'flexsearch': 'github:PloinkyRepos/flexsearch#main'
        }
    };
}
```

### mergePackageJson(corePackage, agentPackage)

**Purpose**: Merges two package.json objects (core takes precedence)

**Parameters**:
- `corePackage` (Object): Core package.json (takes precedence)
- `agentPackage` (Object): Agent's package.json

**Returns**: (Object) Merged package.json

**Merge Strategy**:
- Core dependencies override agent dependencies
- Agent devDependencies are merged in
- Agent scripts are preserved
- Agent name is used if available

**Implementation**:
```javascript
function mergePackageJson(corePackage, agentPackage) {
    const merged = { ...corePackage };

    // Merge dependencies, with core taking precedence
    if (agentPackage.dependencies) {
        merged.dependencies = {
            ...agentPackage.dependencies,
            ...corePackage.dependencies  // Core dependencies override
        };
    }

    // Merge devDependencies if present
    if (agentPackage.devDependencies) {
        merged.devDependencies = {
            ...(merged.devDependencies || {}),
            ...agentPackage.devDependencies
        };
    }

    // Keep agent's scripts
    if (agentPackage.scripts) {
        merged.scripts = agentPackage.scripts;
    }

    // Use agent's name if available
    if (agentPackage.name) {
        merged.name = agentPackage.name;
    }

    return merged;
}
```

## Public API

### setupAgentWorkDir(agentName)

**Purpose**: Sets up the agent working directory on the host

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Path to agent working directory

**Implementation**:
```javascript
function setupAgentWorkDir(agentName) {
    const workDir = getAgentWorkDir(agentName);
    if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
    }
    return workDir;
}
```

### needsReinstall(containerName, agentName)

**Purpose**: Checks if npm install needs to be run

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name

**Returns**: `{ needsInstall: boolean, reason: string }`

**Checks**:
1. /code/package.json exists
2. /agent/node_modules exists
3. /agent/node_modules is not empty

**Implementation**:
```javascript
function needsReinstall(containerName, agentName) {
    // Check if package.json exists in /code
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { needsInstall: false, reason: 'No package.json found in /code' };
    }

    // Check if node_modules exists
    if (!dirExistsInContainer(containerName, '/agent/node_modules')) {
        return { needsInstall: true, reason: 'node_modules directory does not exist' };
    }

    // Check if node_modules is empty
    try {
        const output = dockerExec(containerName, 'ls /agent/node_modules 2>/dev/null | head -1');
        if (!output) {
            return { needsInstall: true, reason: 'node_modules directory is empty' };
        }
    } catch (_) {
        return { needsInstall: true, reason: 'Cannot read node_modules directory' };
    }

    return { needsInstall: false, reason: 'Dependencies already installed' };
}
```

### installDependencies(containerName, agentName, options)

**Purpose**: Installs dependencies inside the container

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name
- `options` (Object):
  - `force` (boolean): Force reinstall (default: false)
  - `verbose` (boolean): Verbose logging (default: false)

**Returns**: `{ success: boolean, message: string }`

**Installation Steps**:
1. Check if /code/package.json exists (skip if not)
2. Check if /agent/node_modules cached (skip if cached unless force)
3. Create /agent directory
4. Read core package.base.json template
5. Read agent's /code/package.json
6. Merge packages (core takes precedence)
7. Write merged package.json to /agent/package.json
8. Run npm install in /agent

**Implementation**:
```javascript
async function installDependencies(containerName, agentName, options = {}) {
    const { force = false, verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    // Step 1: Check if /code/package.json exists
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        log(`[deps] No package.json found for ${agentName}, skipping npm install`);
        return { success: true, message: 'No package.json found, skipping npm install' };
    }

    // Step 2: Check cache
    if (!force) {
        const { needsInstall, reason } = needsReinstall(containerName, agentName);
        if (!needsInstall) {
            log(`[deps] Using cached node_modules for ${agentName}: ${reason}`);
            return { success: true, message: `Using cached node_modules: ${reason}` };
        }
        log(`[deps] ${agentName}: ${reason}`);
    }

    try {
        // Step 3: Create /agent directory
        dockerExec(containerName, 'mkdir -p /agent');

        // Step 4-5: Read packages
        const corePackage = readPackageBaseTemplate();
        const agentPackageContent = dockerExec(containerName, 'cat /code/package.json');
        const agentPackage = JSON.parse(agentPackageContent);

        // Step 6: Merge
        const mergedPackage = mergePackageJson(corePackage, agentPackage);
        const mergedJson = JSON.stringify(mergedPackage, null, 2);

        // Step 7: Write merged package.json
        const escapedJson = mergedJson.replace(/'/g, "'\\''");
        dockerExec(containerName, `echo '${escapedJson}' > /agent/package.json`);

        // Step 8: Run npm install
        console.log(`[deps] Installing dependencies for ${agentName}... (this may take a while)`);
        execSync(`${containerRuntime} exec -w /agent ${containerName} npm install`, {
            stdio: 'inherit',
            timeout: 600000 // 10 minute timeout
        });

        return { success: true, message: 'Dependencies installed successfully' };
    } catch (err) {
        console.error(`[deps] Failed to install dependencies for ${agentName}: ${err.message}`);
        return { success: false, message: `Installation failed: ${err.message}` };
    }
}
```

### installCoreDependencies(containerName, agentName)

**Purpose**: Installs core dependencies only (without agent dependencies)

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name

**Returns**: `{ success: boolean, message: string }`

**Implementation**:
```javascript
async function installCoreDependencies(containerName, agentName) {
    try {
        debugLog(`[deps] Installing core dependencies for ${agentName}...`);

        // Ensure /agent directory exists
        dockerExec(containerName, 'mkdir -p /agent');

        // Copy core package.json
        const corePackage = readPackageBaseTemplate();
        const coreJson = JSON.stringify(corePackage, null, 2);
        const escapedJson = coreJson.replace(/'/g, "'\\''");
        dockerExec(containerName, `echo '${escapedJson}' > /agent/package.json`);

        // Run npm install
        execSync(`${containerRuntime} exec -w /agent ${containerName} npm install`, {
            stdio: 'inherit',
            timeout: 600000
        });

        return { success: true, message: 'Core dependencies installed' };
    } catch (err) {
        return { success: false, message: `Core installation failed: ${err.message}` };
    }
}
```

### installAgentDependencies(containerName, agentName)

**Purpose**: Installs agent-specific dependencies (merging with existing)

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name

**Returns**: `{ success: boolean, message: string }`

**Implementation**:
```javascript
async function installAgentDependencies(containerName, agentName) {
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { success: true, message: 'No agent package.json found' };
    }

    try {
        debugLog(`[deps] Installing agent dependencies for ${agentName}...`);

        // Read current /agent/package.json
        let currentPackage;
        try {
            const content = dockerExec(containerName, 'cat /agent/package.json');
            currentPackage = JSON.parse(content);
        } catch (_) {
            currentPackage = readPackageBaseTemplate();
        }

        // Read agent package.json
        const agentContent = dockerExec(containerName, 'cat /code/package.json');
        const agentPackage = JSON.parse(agentContent);

        // Merge and write
        const mergedPackage = mergePackageJson(currentPackage, agentPackage);
        const mergedJson = JSON.stringify(mergedPackage, null, 2);
        const escapedJson = mergedJson.replace(/'/g, "'\\''");
        dockerExec(containerName, `echo '${escapedJson}' > /agent/package.json`);

        // Run npm install
        execSync(`${containerRuntime} exec -w /agent ${containerName} npm install`, {
            stdio: 'inherit',
            timeout: 600000
        });

        return { success: true, message: 'Agent dependencies installed' };
    } catch (err) {
        return { success: false, message: `Agent installation failed: ${err.message}` };
    }
}
```

## Exports

```javascript
export {
    dockerExec,
    fileExistsInContainer,
    dirExistsInContainer,
    readPackageBaseTemplate,
    mergePackageJson,
    setupAgentWorkDir,
    needsReinstall,
    installDependencies,
    installCoreDependencies,
    installAgentDependencies
};
```

## Container Directory Structure

```
/agent/
├── package.json      # Merged core + agent dependencies
├── node_modules/     # Installed dependencies (cached)
│   ├── achillesAgentLib/
│   ├── mcp-sdk/
│   └── ...
/code/
├── package.json      # Agent's original package.json
└── ...               # Agent code
```

## Usage Example

```javascript
import { installDependencies, needsReinstall } from './dependencyInstaller.js';

// Check if install needed
const { needsInstall, reason } = needsReinstall('ploinky_basic_node-dev', 'node-dev');
console.log(`Needs install: ${needsInstall}, reason: ${reason}`);

// Install dependencies
const result = await installDependencies('ploinky_basic_node-dev', 'node-dev', {
    force: false,
    verbose: true
});

if (result.success) {
    console.log(result.message);
} else {
    console.error(result.message);
}
```

## Related Modules

- [service-workspace-structure.md](../workspace/service-workspace-structure.md) - Workspace paths
- [docker-common.md](../docker/docker-common.md) - Container runtime
- [service-lifecycle-hooks.md](./service-lifecycle-hooks.md) - Lifecycle integration
