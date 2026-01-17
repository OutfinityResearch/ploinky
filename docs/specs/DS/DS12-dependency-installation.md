# DS12 - Dependency Installation

## Summary

Ploinky manages Node.js dependencies for agents by installing them in the workspace `agents/<agent>/` directory via the running agent container's CWD mount, then mounting `node_modules` into the container at `/code/node_modules`. This specification documents the dependency installation process, core dependencies, and the installation strategy.

## Background / Problem Statement

Agents require Node.js dependencies to function. The dependency installation must:
- Provide core dependencies required by all agents (achillesAgentLib, flexsearch, mcp-sdk, node-pty)
- Support agent-specific dependencies defined in the agent's package.json
- Persist dependencies across container restarts
- Work with read-only `/code` mounts in qa/prod profiles

## Goals

1. **Core Dependencies**: Provide 4 global dependencies to all agents
2. **Agent Dependencies**: Support agent-specific package.json
3. **Persistence**: Dependencies survive container restarts
4. **In-Container Installation**: Install inside running container via CWD mount
5. **Caching**: Skip reinstall if dependencies unchanged

## Non-Goals

- Support for package managers other than npm
- Monorepo/workspace configurations
- Private npm registry authentication

## Architecture Overview

### Dependency Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEPENDENCY INSTALLATION                            │
│                      (inside running agent container)                        │
│                                                                              │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │ Core package.json│         │Agent package.json│                          │
│  │ (4 global deps)  │         │ (/code/)         │                          │
│  └────────┬─────────┘         └────────┬─────────┘                          │
│           │                            │                                     │
│           ▼                            ▼                                     │
│  ┌─────────────────────┐     ┌─────────────────────┐                        │
│  │ npm install #1      │     │ npm install #2      │                        │
│  │ (core deps)         │ ──► │ (agent deps added)  │                        │
│  └─────────────────────┘     └─────────────────────┘                        │
│                                        │                                     │
│                                        ▼                                     │
│                    ┌──────────────────────────┐                             │
│                    │ $CWD/agents/<agent>/     │                             │
│                    │   ├── package.json       │                             │
│                    │   ├── package-lock.json  │                             │
│                    │   └── node_modules/      │                             │
│                    └──────────────────────────┘                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

                                   │
                                   ▼ (mounted into container)

┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT CONTAINER                                    │
│                                                                              │
│  /code/                                                                      │
│  ├── index.js           (from .ploinky/repos/<repo>/<agent>/code/)          │
│  ├── package.json       (agent's original package.json)                     │
│  └── node_modules/      (mounted from $CWD/agents/<agent>/node_modules/)    │
│      ├── achillesAgentLib/                                                  │
│      ├── flexsearch/                                                        │
│      ├── mcp-sdk/                                                           │
│      └── node-pty/                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Models

### Core Package Template

```javascript
/**
 * Core package.json template with global dependencies.
 * Located at: ploinky/templates/package.base.json
 */
{
  "name": "ploinky-agent-runtime",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "achillesAgentLib": "github:OutfinityResearch/achillesAgentLib",
    "mcp-sdk": "github:PloinkyRepos/MCPSDK#main",
    "node-pty": "^1.0.0",
    "flexsearch": "github:PloinkyRepos/flexsearch#main"
  }
}
```

### Installation State

```javascript
/**
 * @typedef {Object} InstallState
 * @property {boolean} needsInstall - Whether installation is needed
 * @property {string} reason - Why installation is/isn't needed
 * @property {boolean} hasCoreModules - Core dependencies exist
 * @property {boolean} hasAgentPackage - Agent has package.json
 */
```

## API Contracts

### Dependency Installation

All operations (file copying, npm install) run **inside the running agent container**. The CWD mount at the same path ensures that writes persist to the host filesystem.

```javascript
// cli/services/dependencyInstaller.js

/**
 * Install dependencies for an agent inside a running container.
 * Called from lifecycle hooks after the container starts.
 *
 * Process (all inside running container):
 * 1. Create $CWD/agents/<agent>/ directory
 * 2. Copy core package.json (with 4 global deps) to $CWD/agents/<agent>/package.json
 * 3. Run npm install in $CWD/agents/<agent>/
 * 4. If agent has /code/package.json, copy it to $CWD/agents/<agent>/package.json
 * 5. Run npm install again (adds agent deps to existing node_modules)
 *
 * @param {string} containerName - The running container name
 * @param {string} agentName - The agent name
 * @param {object} options - Options
 * @returns {{ success: boolean, message: string }}
 */
export function installDependencies(containerName, agentName, options = {}) {
  const agentWorkDir = getAgentWorkDir(agentName);  // $CWD/agents/<agent>/
  const nodeModulesPath = path.join(agentWorkDir, 'node_modules');

  // Check if already installed (on host)
  const hasCoreModules = fs.existsSync(path.join(nodeModulesPath, 'mcp-sdk'));
  if (!options.force && hasCoreModules) {
    return { success: true, message: 'Using cached node_modules' };
  }

  // All following operations run INSIDE the running container

  // Step 1: Create agent work dir inside container
  dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

  // Step 2: Copy core package.json inside container
  const corePackage = readPackageBaseTemplate();
  writeFileInContainer(containerName, `${agentWorkDir}/package.json`, JSON.stringify(corePackage, null, 2));

  // Step 3: Run npm install inside container (installs 4 global deps)
  runNpmInstallInContainer(containerName, agentWorkDir);

  // Step 4: If agent has package.json, copy and install (adds to existing node_modules)
  if (fileExistsInContainer(containerName, '/code/package.json')) {
    // Copy agent's package.json from /code
    dockerExec(containerName, `cp /code/package.json "${agentWorkDir}/package.json"`);
    // Run npm install (adds agent deps to existing node_modules)
    runNpmInstallInContainer(containerName, agentWorkDir);
  }

  return { success: true, message: 'Dependencies installed' };
}

/**
 * Run npm install inside a container at the specified working directory.
 *
 * @param {string} containerName - The container name
 * @param {string} workDir - Working directory (host path accessible via CWD mount)
 */
function runNpmInstallInContainer(containerName, workDir) {
  execSync(`docker exec -w "${workDir}" ${containerName} npm install`, {
    stdio: 'inherit',
    timeout: 600000
  });
}
```

## Behavioral Specification

### Installation Flow

All operations run **inside the running agent container** via CWD mount:

```
1. Agent Container Started
   │
   ├─► Container running with CWD mount ($CWD:$CWD)
   │
2. Lifecycle Hook Triggers installDependencies()
   │
   ├─► Check if $CWD/agents/<agent>/node_modules/mcp-sdk exists (on host)
   │   │
   │   ├─► YES: Skip installation, use cached
   │   │
   │   └─► NO: Continue to installation
   │
3. Create Directory (inside running container)
   │
   ├─► docker exec <container> mkdir -p "$CWD/agents/<agent>/"
   │
4. Install Core Dependencies (inside running container)
   │
   ├─► Write core package.json to $CWD/agents/<agent>/package.json
   │
   ├─► docker exec -w "$CWD/agents/<agent>" <container> npm install
   │
5. Install Agent Dependencies (if package.json exists in /code)
   │
   ├─► docker exec <container> cp /code/package.json "$CWD/agents/<agent>/package.json"
   │
   ├─► docker exec -w "$CWD/agents/<agent>" <container> npm install
   │   (npm adds agent deps to existing node_modules)
   │
6. Ready
   │
   └─► node_modules available at /code/node_modules via mount
```

### Core Dependencies

| Package | Source | Purpose |
|---------|--------|---------|
| `achillesAgentLib` | github:OutfinityResearch/achillesAgentLib | Agent framework and skill system |
| `mcp-sdk` | github:PloinkyRepos/MCPSDK#main | MCP protocol implementation |
| `flexsearch` | github:PloinkyRepos/flexsearch#main | Full-text search for document indexing |
| `node-pty` | ^1.0.0 | PTY support for interactive terminals |

### Directory Structure

```
$CWD/                           # Workspace root
├── .ploinky/
│   └── repos/
│       └── <repo>/
│           └── <agent>/
│               └── code/
│                   ├── index.js
│                   └── package.json    # Agent's package.json (source)
│
├── agents/                      # Agent working directories
│   └── <agent>/
│       ├── package.json         # package.json used for npm install
│       ├── package-lock.json
│       └── node_modules/        # Installed dependencies
│           ├── achillesAgentLib/
│           ├── flexsearch/
│           ├── mcp-sdk/
│           └── node-pty/
│
├── code/                        # Symlinks to agent source
│   └── <agent> -> ../.ploinky/repos/<repo>/<agent>/code/
│
└── skills/                      # Symlinks to agent skills
    └── <agent> -> ../.ploinky/repos/<repo>/<agent>/.AchillesSkills/
```

### Container Mounts for Dependencies

```javascript
// In agentServiceManager.js
const args = [
  'run', '-d',
  '--name', containerName,
  '-w', '/code',

  // Agent source code
  '-v', `${agentCodePath}:/code${codeMountMode}`,

  // Node modules from host (read-only in container)
  '-v', `${agentNodeModulesPath}:/code/node_modules:ro`,

  // CWD passthrough for workspace access (rw for npm install)
  '-v', `${cwd}:${cwd}`,

  // ... other mounts
];
```

## Configuration

### Package Base Template

Location: `ploinky/templates/package.base.json`

```json
{
  "name": "ploinky-agent-deps",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "achillesAgentLib": "file:../../ploinky/node_modules/achillesAgentLib",
    "flexsearch": "^0.7.43",
    "@anthropic-ai/sdk": "^0.52.0",
    "node-pty": "^1.0.0"
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLOINKY_SKIP_DEPS` | Skip dependency installation | `false` |
| `NODE_PATH` | Node module search path | `/code/node_modules` |

## Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| npm install failed | Network, permission, or package error | Check npm logs, retry |
| Package not found | Invalid dependency in package.json | Fix package.json |
| Permission denied | Can't write to agents/ directory | Check directory permissions |
| Timeout | npm install taking too long | Increase timeout, check network |

## Security Considerations

- **Host Filesystem Access**: npm install writes to host via CWD mount
- **Package Integrity**: Consider using package-lock.json
- **Network Access**: npm needs network to fetch packages
- **Untrusted Packages**: Agent package.json could include malicious deps

## Success Criteria

1. Core dependencies (4 packages) installed for all agents
2. Agent-specific dependencies added correctly via second npm install
3. Dependencies persist across container restarts
4. Cached dependencies reused when unchanged
5. Works with read-only /code mount

## References

- [DS11 - Container Runtime](./DS11-container-runtime.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [npm Documentation](https://docs.npmjs.com/)
