# cli/services/dependencyInstaller.js - Dependency Installer

## Overview

Manages npm dependency installation inside agent containers. Implements the dependency merging strategy where core dependencies take precedence over agent dependencies, with caching support to avoid redundant installations.

## Source File

`cli/services/dependencyInstaller.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
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

### writeFileInContainer(containerName, filePath, content)

**Purpose**: Writes a file inside a running container via stdin

**Parameters**:
- `containerName` (string): Target container name
- `filePath` (string): Destination path inside container
- `content` (string): File content

**Behavior**:
- Uses `docker exec -i` with `cat >` to avoid shell-escaping issues

**Implementation**:
```javascript
function writeFileInContainer(containerName, filePath, content) {
    const cmd = `${containerRuntime} exec -i ${containerName} sh -c "cat > ${filePath}"`;
    debugLog(`dockerExec: ${cmd}`);
    execSync(cmd, { input: content });
}
```

### ensureGitAvailable(containerName, log)

**Purpose**: Ensures `git` is present for npm installs that pull from GitHub

**Parameters**:
- `containerName` (string): Target container name
- `log` (Function): Logger (debugLog or console.log)

**Returns**: `{ success: boolean, message: string }`

**Behavior**:
- Checks `git --version`
- Installs git via `apk` or `apt-get` when missing
- Returns failure when no package manager is available

**Implementation**:
```javascript
function ensureGitAvailable(containerName, log = debugLog) {
    try {
        dockerExec(containerName, 'git --version');
        return { success: true, message: 'git available' };
    } catch (_) {}

    const installers = [
        { name: 'apk', check: 'command -v apk', command: 'apk add --no-cache git' },
        { name: 'apt-get', check: 'command -v apt-get', command: 'apt-get update && apt-get install -y git' }
    ];

    for (const installer of installers) {
        try {
            dockerExec(containerName, installer.check);
        } catch (_) {
            continue;
        }

        try {
            log(`[deps] Installing git via ${installer.name}...`);
            dockerExec(containerName, installer.command, { maxBuffer: 1024 * 1024 * 10 });
            return { success: true, message: `git installed via ${installer.name}` };
        } catch (err) {
            log(`[deps] git install via ${installer.name} failed: ${err.message}`);
        }
    }

    return { success: false, message: 'git is required to install dependencies but could not be installed' };
}
```

### ensureBuildTools(containerName, log)

**Purpose**: Ensures native build tooling (python/make/g++) is available for node-gyp

**Parameters**:
- `containerName` (string): Target container name
- `log` (Function): Logger (debugLog or console.log)

**Returns**: `{ success: boolean, message: string }`

**Behavior**:
- Checks for `python3`, `make`, and `g++`
- Installs build tools via `apk` or `apt-get` when missing
- Returns failure when tooling cannot be installed

**Implementation**:
```javascript
function ensureBuildTools(containerName, log = debugLog) {
    const requiredCommands = ['python3', 'make', 'g++'];
    const missing = [];

    for (const command of requiredCommands) {
        try {
            dockerExec(containerName, `command -v ${command}`);
        } catch (_) {
            missing.push(command);
        }
    }

    if (!missing.length) {
        return { success: true, message: 'build tools available' };
    }

    const installers = [
        { name: 'apk', check: 'command -v apk', command: 'apk add --no-cache python3 make g++' },
        { name: 'apt-get', check: 'command -v apt-get', command: 'apt-get update && apt-get install -y python3 make g++' }
    ];

    for (const installer of installers) {
        try {
            dockerExec(containerName, installer.check);
        } catch (_) {
            continue;
        }

        try {
            log(`[deps] Installing build tools via ${installer.name}...`);
            dockerExec(containerName, installer.command, { maxBuffer: 1024 * 1024 * 10 });
            return { success: true, message: `build tools installed via ${installer.name}` };
        } catch (err) {
            log(`[deps] build tool install via ${installer.name} failed: ${err.message}`);
        }
    }

    return { success: false, message: `Missing build tools: ${missing.join(', ')}` };
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
2. $WORKSPACE_PATH/node_modules exists (via CWD passthrough mount)
3. node_modules is not empty

**Implementation**:
```javascript
function needsReinstall(containerName, agentName, agentWorkDir) {
    // agentWorkDir = $CWD/agents/<agentName>/ (accessible via CWD passthrough mount)

    // Check if package.json exists in /code
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { needsInstall: false, reason: 'No package.json found in /code' };
    }

    // Check if node_modules exists (via CWD passthrough mount)
    if (!dirExistsInContainer(containerName, `${agentWorkDir}/node_modules`)) {
        return { needsInstall: true, reason: 'node_modules directory does not exist' };
    }

    // Check if node_modules is empty
    try {
        const output = dockerExec(containerName, `ls "${agentWorkDir}/node_modules" 2>/dev/null | head -1`);
        if (!output) {
            return { needsInstall: true, reason: 'node_modules directory is empty' };
        }
    } catch (_) {
        return { needsInstall: true, reason: 'Cannot read node_modules directory' };
    }

    return { needsInstall: false, reason: 'Dependencies already installed' };
}
```

### resolveAgentPackagePath(agentName, agentPath)

**Purpose**: Locates an agent's `package.json` on the host filesystem

**Parameters**:
- `agentName` (string): Agent name
- `agentPath` (string, optional): Agent root path

**Returns**: (string|null) Path to package.json or null

**Behavior**:
- Checks the workspace symlink under `code/<agentName>`
- Falls back to `<agentPath>/code/package.json` or `<agentPath>/package.json`

### needsHostInstall(agentName, options)

**Purpose**: Determines whether dependency installation is needed based on host cache state

**Parameters**:
- `agentName` (string): Agent name
- `options` (Object):
  - `agentPath` (string, optional): Agent root path
  - `packagePath` (string, optional): Resolved package.json path

**Returns**: `{ needsInstall: boolean, reason: string }`

**Checks**:
1. package.json exists on host (skip if missing)
2. `agents/<agentName>/node_modules` exists
3. node_modules contains at least one entry

**Implementation**:
```javascript
function needsHostInstall(agentName, options = {}) {
    const { agentPath, packagePath } = options;
    const resolvedPackagePath = packagePath || resolveAgentPackagePath(agentName, agentPath);

    if (!resolvedPackagePath) {
        return { needsInstall: false, reason: 'No package.json found' };
    }

    const nodeModulesPath = path.join(getAgentWorkDir(agentName), 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
        return { needsInstall: true, reason: 'node_modules directory does not exist' };
    }

    try {
        const entries = fs.readdirSync(nodeModulesPath);
        if (!entries.length) {
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
2. Check if $WORKSPACE_PATH/node_modules cached (skip if cached unless force)
3. Create agent work directory via CWD passthrough mount
4. Read core package.base.json template
5. Read agent's /code/package.json
6. Merge packages (core takes precedence)
7. Write merged package.json to agent work dir
8. Ensure git is available (apk/apt-get)
9. Ensure build tools are available (python3/make/g++)
10. Run npm install in agent work dir

**Implementation**:
```javascript
function installDependencies(containerName, agentName, agentWorkDir, options = {}) {
    // agentWorkDir = $CWD/agents/<agentName>/ (accessible via CWD passthrough mount)
    const { force = false, verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    // Step 1: Check if /code/package.json exists
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        log(`[deps] No package.json found for ${agentName}, skipping npm install`);
        return { success: true, message: 'No package.json found, skipping npm install' };
    }

    // Step 2: Check cache
    if (!force) {
        const { needsInstall, reason } = needsReinstall(containerName, agentName, agentWorkDir);
        if (!needsInstall) {
            log(`[deps] Using cached node_modules for ${agentName}: ${reason}`);
            return { success: true, message: `Using cached node_modules: ${reason}` };
        }
        log(`[deps] ${agentName}: ${reason}`);
    }

    try {
        // Step 3: Create agent work directory via CWD mount
        dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

        // Step 4-5: Read packages
        const corePackage = readPackageBaseTemplate();
        const agentPackageContent = dockerExec(containerName, 'cat /code/package.json');
        const agentPackage = JSON.parse(agentPackageContent);

        // Step 6: Merge
        const mergedPackage = mergePackageJson(corePackage, agentPackage);
        const mergedJson = JSON.stringify(mergedPackage, null, 2);

        // Step 7: Write merged package.json
        writeFileInContainer(containerName, `${agentWorkDir}/package.json`, mergedJson);

        const gitResult = ensureGitAvailable(containerName, log);
        if (!gitResult.success) {
            return { success: false, message: gitResult.message };
        }

        const toolsResult = ensureBuildTools(containerName, log);
        if (!toolsResult.success) {
            return { success: false, message: toolsResult.message };
        }

        // Step 10: Run npm install in agent work dir
        console.log(`[deps] Installing dependencies for ${agentName}... (this may take a while)`);
        execSync(`${containerRuntime} exec -w "${agentWorkDir}" ${containerName} npm install`, {
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
function installCoreDependencies(containerName, agentName, agentWorkDir) {
    // agentWorkDir = $CWD/agents/<agentName>/ (accessible via CWD mount)
    try {
        debugLog(`[deps] Installing core dependencies for ${agentName}...`);

        // Ensure agent work directory exists via CWD mount
        dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

        // Copy core package.json
        const corePackage = readPackageBaseTemplate();
        const coreJson = JSON.stringify(corePackage, null, 2);
        writeFileInContainer(containerName, `${agentWorkDir}/package.json`, coreJson);

        const gitResult = ensureGitAvailable(containerName);
        if (!gitResult.success) {
            return { success: false, message: gitResult.message };
        }

        const toolsResult = ensureBuildTools(containerName);
        if (!toolsResult.success) {
            return { success: false, message: toolsResult.message };
        }

        // Run npm install in agent work dir
        execSync(`${containerRuntime} exec -w "${agentWorkDir}" ${containerName} npm install`, {
            stdio: 'inherit',
            timeout: 600000
        });

        return { success: true, message: 'Core dependencies installed' };
    } catch (err) {
        return { success: false, message: `Core installation failed: ${err.message}` };
    }
}
```

### installAgentDependencies(containerName, agentName, agentWorkDir)

**Purpose**: Installs agent-specific dependencies (merging with existing)

**Parameters**:
- `containerName` (string): Container name
- `agentName` (string): Agent name
- `agentWorkDir` (string): Agent work directory ($CWD/agents/<agentName>/)

**Returns**: `{ success: boolean, message: string }`

**Implementation**:
```javascript
function installAgentDependencies(containerName, agentName, agentWorkDir) {
    // agentWorkDir = $CWD/agents/<agentName>/ (accessible via CWD mount)
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { success: true, message: 'No agent package.json found' };
    }

    try {
        debugLog(`[deps] Installing agent dependencies for ${agentName}...`);

        // Read current package.json from agent work dir
        let currentPackage;
        try {
            const content = dockerExec(containerName, `cat "${agentWorkDir}/package.json"`);
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
        writeFileInContainer(containerName, `${agentWorkDir}/package.json`, mergedJson);

        const gitResult = ensureGitAvailable(containerName);
        if (!gitResult.success) {
            return { success: false, message: gitResult.message };
        }

        const toolsResult = ensureBuildTools(containerName);
        if (!toolsResult.success) {
            return { success: false, message: toolsResult.message };
        }

        // Run npm install in agent work dir
        execSync(`${containerRuntime} exec -w "${agentWorkDir}" ${containerName} npm install`, {
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
    needsHostInstall,
    installDependencies,
    installCoreDependencies,
    installAgentDependencies
};
```

## Container Directory Structure

```
/code/                              # Agent source code (working directory)
├── package.json                    # Agent's original package.json
├── node_modules/                   # Mounted from $CWD/agents/<agent>/node_modules/
│   ├── achillesAgentLib/
│   ├── mcp-sdk/
│   └── ...
└── ...                             # Agent code

$CWD/agents/<agent>/                # Agent work dir (via CWD mount at same path)
├── package.json                    # Merged core + agent dependencies
├── package-lock.json
├── node_modules/                   # Installed dependencies (mounted to /code/node_modules)
└── ...                             # Runtime data (logs, cache)
```

## Usage Example

```javascript
import { installDependencies, needsReinstall } from './dependencyInstaller.js';

// Check if install needed
const { needsInstall, reason } = needsReinstall('ploinky_basic_node-dev', 'node-dev');
console.log(`Needs install: ${needsInstall}, reason: ${reason}`);

// Install dependencies inside a running container
// Called from lifecycle hooks after the container starts
const result = installDependencies('ploinky_basic_node-dev', 'node-dev', {
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
