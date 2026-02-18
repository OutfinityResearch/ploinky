# Ploinky Agent Workspace Architecture

This document describes how ploinky manages agent directory structures, installs dependencies, creates symlinks, and resolves module imports at runtime.

---

## 1. Workspace Directory Structure

When ploinky initializes a workspace, it creates this layout on the **host** filesystem:

```
<workspace-root>/
|
+-- .ploinky/                        # Ploinky metadata (hidden)
|   +-- agents                       # JSON file: registered agent records
|   +-- enabled_repos.json           # JSON file: enabled repository list
|   +-- routing.json                 # JSON file: container routing table
|   +-- running/                     # Running container state
|   +-- .secrets                     # Secret environment variables (KEY=VALUE)
|   +-- profile                      # Active profile name
|   +-- repos/                       # Cloned agent repositories
|       +-- <repoName>/
|           +-- <agentName>/
|               +-- manifest.json    # Agent configuration
|               +-- code/            # Agent source code (optional subdirectory)
|               +-- .AchillesSkills/ # Agent skills (optional)
|               +-- package.json     # Agent-specific dependencies (optional)
|
+-- agents/                          # Working directories (one per agent)
|   +-- <agentName>/
|       +-- node_modules/            # Installed npm dependencies
|       +-- package.json             # Merged package.json (global + agent)
|       +-- package-lock.json        # Lock file from npm install
|
+-- code/                            # Symlinks to agent source code
|   +-- <agentName> --> .ploinky/repos/<repoName>/<agentName>/code/
|
+-- skills/                          # Symlinks to agent skills
|   +-- <agentName> --> .ploinky/repos/<repoName>/<agentName>/.AchillesSkills/
|
+-- shared/                          # Shared directory accessible to all agents
```

**Key files that manage this:**
- `cli/services/config.js` - Defines all path constants (`WORKSPACE_ROOT`, `AGENTS_WORK_DIR`, `CODE_DIR`, `SKILLS_DIR`, etc.)
- `cli/services/workspaceStructure.js` - Creates directories, symlinks, and manages workspace integrity

### Path Constants (from `config.js`)

| Constant | Resolves To |
|---|---|
| `WORKSPACE_ROOT` | First ancestor directory containing `.ploinky/` |
| `PLOINKY_DIR` | `<WORKSPACE_ROOT>/.ploinky` |
| `REPOS_DIR` | `<WORKSPACE_ROOT>/.ploinky/repos` |
| `AGENTS_FILE` | `<WORKSPACE_ROOT>/.ploinky/agents` |
| `SECRETS_FILE` | `<WORKSPACE_ROOT>/.ploinky/.secrets` |
| `AGENTS_WORK_DIR` | `<WORKSPACE_ROOT>/agents` |
| `CODE_DIR` | `<WORKSPACE_ROOT>/code` |
| `SKILLS_DIR` | `<WORKSPACE_ROOT>/skills` |
| `GLOBAL_DEPS_PATH` | `<ploinky-install>/globalDeps` |
| `TEMPLATES_DIR` | `<ploinky-install>/templates` |

---

## 2. Symlink Creation

Symlinks provide convenient top-level access to agent code and skills that live deep inside `.ploinky/repos/`.

### What Gets Symlinked

| Symlink | Target | Condition |
|---|---|---|
| `$CWD/code/<agentName>` | `.ploinky/repos/<repoName>/<agentName>/code/` | Always (falls back to agent root if no `code/` subdirectory) |
| `$CWD/skills/<agentName>` | `.ploinky/repos/<repoName>/<agentName>/.AchillesSkills/` | Only if `.AchillesSkills/` directory exists |

### Creation Logic (`workspaceStructure.js:createAgentSymlinks`)

1. Checks if `<agentPath>/code/` exists; if yes, symlinks to that; otherwise symlinks to `<agentPath>/` itself
2. Removes any existing symlink at the target location
3. If a **real** file/directory blocks the symlink path, it warns and skips (does not overwrite)
4. Skills symlink is only created if `.AchillesSkills/` actually exists in the agent repo

### When Symlinks Are Created

Symlinks are created during:
- **Agent enable** (`cli/services/agents.js` - `enableAgent()`)
- **Lifecycle hooks** (`cli/services/lifecycleHooks.js` - step 2 of agent lifecycle)
- **Pre-container lifecycle** (`lifecycleHooks.js` - `runPreContainerLifecycle()`)

### Symlink Resolution for Containers

Before mounting paths into containers, symlinks are always **resolved to real paths** using `fs.realpathSync()`. This happens in:
- `agentServiceManager.js:resolveSymlinkPath()` (lines 80-92)
- `dependencyInstaller.js:runPersistentInstall()` (lines 790-804)

This is necessary because Docker/Podman volume mounts don't follow host symlinks reliably.

---

## 3. Dependency Installation

### Global Dependencies

Defined in `globalDeps/package.json`:

```json
{
  "name": "ploinky-global-deps",
  "type": "module",
  "dependencies": {
    "achillesAgentLib": "github:OutfinityResearch/achillesAgentLib",
    "mcp-sdk": "github:PloinkyRepos/MCPSDK#main",
    "flexsearch": "github:PloinkyRepos/flexsearch#main",
    "node-pty": "^1.0.0"
  }
}
```

These four dependencies are available to **every** agent.

### Core Dependency Names (for sync operations)

Hardcoded in `dependencyInstaller.js`:

```javascript
const CORE_DEPENDENCIES = ['achillesAgentLib', 'mcp-sdk', 'flexsearch'];
```

Note: `node-pty` is in the global package.json but not in `CORE_DEPENDENCIES` (it's a native module installed via npm, not synced from ploinky's own `node_modules`).

### Installation Flow

The dependency installation has two main phases:

#### Phase 1: Host-Side Preparation (before container starts)

**Function:** `prepareAgentPackageJson(agentName)` in `dependencyInstaller.js`

1. Reads `globalDeps/package.json` (the 4 global dependencies)
2. Checks if the agent has its own `package.json` at `$CWD/code/<agentName>/package.json`
3. If yes, **merges** agent dependencies into the global ones (agent deps take precedence for version conflicts)
4. Writes the merged `package.json` to `$CWD/agents/<agentName>/package.json`

**Decision logic** (in `agentServiceManager.js`):

```
if agent does NOT use a "start" entry  OR  agent has its own package.json:
    run prepareAgentPackageJson()        # merge global + agent deps
else:
    skip npm install entirely            # agent uses start command with no deps
```

#### Phase 2: In-Container Entrypoint Install (when container starts)

**Function:** `buildEntrypointInstallScript(agentName)` in `dependencyInstaller.js`

The install script is injected into the container's entrypoint command. It runs as a shell snippet **before** the agent's actual command:

```sh
(
    echo "[deps] <agentName>: Installing dependencies...";
    (
      command -v git >/dev/null 2>&1 ||
      (command -v apk >/dev/null 2>&1 && apk add --no-cache git python3 make g++) ||
      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y git python3 make g++)
    ) 2>/dev/null;
    npm install --prefix "$WORKSPACE_PATH";
)
```

Steps:
1. Install `git` + build tools (`python3`, `make`, `g++`) if not present (needed for GitHub deps and native modules like `node-pty`)
2. Run `npm install --prefix "$WORKSPACE_PATH"` (installs from the merged package.json prepared in Phase 1)

#### Phase 3: Manifest Install Hooks (after npm install)

If the manifest or active profile defines an `install` command, it runs **after** the entrypoint deps install:

```javascript
const combinedInstallCmd = [entrypointInstallSnippet, manifestInstallCmd]
    .filter(Boolean)
    .join(' && ');
```

The final container entrypoint becomes:
```sh
cd /code && <entrypoint-deps-install> && <manifest-install-hook> && <agent-command>
```

### Where Dependencies End Up

```
Host:    $CWD/agents/<agentName>/node_modules/    (persisted across container restarts)

Container mounts:
  /code/node_modules      <-- same host directory
  /Agent/node_modules     <-- same host directory (for AgentServer.mjs resolution)
```

Both container paths point to the **same** host directory. This dual-mount is needed because Node.js ESM resolution walks up from the script's location, and `AgentServer.mjs` lives at `/Agent/server/` (not under `/code/`).

### Core Dependencies Sync (Alternative Path)

**Function:** `syncCoreDependencies(agentName)` in `dependencyInstaller.js`

This is a **host-side** optimization that copies core dependencies directly from ploinky's own `node_modules/` to the agent's `node_modules/` without needing npm install:

1. Locates ploinky's `node_modules/` via `PLOINKY_ROOT` env var (or relative path fallback)
2. For each core dep (`achillesAgentLib`, `mcp-sdk`, `flexsearch`):
   - If missing in agent's `node_modules/` -> copies entire module
   - If present -> syncs any missing subdirectories (recursive)

---

## 4. Container Volume Mounts

When a container is created (`agentServiceManager.js:startAgentContainer`), the following volumes are mounted:

| Host Path | Container Path | Mode | Purpose |
|---|---|---|---|
| `<ploinky>/Agent/` | `/Agent` | `ro` (always) | Agent runtime framework (AgentServer.mjs, TaskQueue.mjs) |
| `$CWD/code/<agent>/` (resolved) | `/code` | `rw` or `ro` (profile-dependent) | Agent source code |
| `$CWD/agents/<agent>/node_modules/` | `/code/node_modules` | `rw` | npm dependencies (for agent code imports) |
| `$CWD/agents/<agent>/node_modules/` | `/Agent/node_modules` | `rw` | npm dependencies (for AgentServer.mjs imports) |
| `$CWD/shared/` | `/shared` | `rw` | Shared data between agents |
| `$CWD/agents/<agent>/` | same path | `rw` | CWD passthrough for runtime data |
| `$CWD/skills/<agent>/` (resolved) | `/code/.AchillesSkills` | `rw` or `ro` (profile-dependent) | Skills directory (only if exists) |

**Mount mode is profile-dependent:**
- `dev` profile: code=`rw`, skills=`rw`
- `qa`/`prod` profiles: code=`ro`, skills=`ro`
- Profiles can override via `manifest.profiles.<profile>.mounts.code` and `.skills`

**Additional volumes:** Manifests can declare extra volumes via `manifest.volumes` (object mapping host paths to container paths).

---

## 5. Module Resolution / How Imports Work

### Module System

The entire codebase uses **ES Modules** (`"type": "module"` in all package.json files). No CommonJS is used.

### On the Host (CLI Code)

Standard Node.js ESM resolution. Modules are imported from the local `node_modules/`:

```javascript
// Direct imports from ploinky's own node_modules
import { getPrioritizedModels } from 'achillesAgentLib/utils/LLMClient.mjs';
import { client as mcpClient } from 'mcp-sdk';
```

For dynamic loading with cache busting:
```javascript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const llmPath = require.resolve('achillesAgentLib/utils/LLMClient.mjs');
const mod = await import(`${pathToFileURL(llmPath).href}?v=${version}`);
```

### Inside Containers (Agent Code)

Agent code at `/code/` imports from `/code/node_modules/` via standard ESM resolution (Node walks up from script location).

### Inside Containers (AgentServer.mjs)

`AgentServer.mjs` runs from `/Agent/server/`. Without intervention, Node.js would walk up to `/Agent/node_modules/`, `/node_modules/`, etc. Two mechanisms ensure it finds the right modules:

1. **Dual mount:** `$CWD/agents/<agent>/node_modules/` is mounted at both `/code/node_modules` and `/Agent/node_modules`
2. **NODE_PATH:** Set to `/code/node_modules` as an environment variable in the container

```javascript
// In agentServiceManager.js (line 346)
args.push('-e', 'NODE_PATH=/code/node_modules');
```

### Key Imports in AgentServer.mjs

```javascript
import { zod } from 'mcp-sdk';                      // Zod schema library re-exported from MCP SDK
const { types, streamHttp, mcp } = await import('mcp-sdk');  // Dynamic import of MCP SDK components
```

### Entry Point Resolution

The `bin/ploinky` script:
1. Sets `PLOINKY_ROOT` to the ploinky installation directory
2. Runs `node cli/index.js` with all arguments

```bash
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
export PLOINKY_ROOT=$(realpath "$SCRIPT_DIR/..")
node "$SCRIPT_DIR/../cli/index.js" "$@"
```

`PLOINKY_ROOT` is then used by `dependencyInstaller.js` to locate ploinky's own `node_modules/` for core dependency syncing.

### No Custom Resolution

The codebase does **not** use:
- Import maps
- Custom module resolvers
- tsconfig/jsconfig path aliases
- Monorepo workspaces
- `.npmrc` or custom package manager configs

All resolution is standard Node.js ESM + the `NODE_PATH` env var inside containers.

---

## 6. Agent Lifecycle Summary

The complete flow from enabling an agent to having it running:

```
1. ENABLE AGENT
   agents.js:enableAgent()
   +-- Clone/update repo into .ploinky/repos/<repoName>/
   +-- Read manifest.json

2. WORKSPACE SETUP
   workspaceStructure.js:initWorkspaceStructure()
   +-- Create directories: .ploinky/, agents/, code/, skills/

3. SYMLINK CREATION
   workspaceStructure.js:createAgentSymlinks()
   +-- code/<agentName>  -->  .ploinky/repos/<repo>/<agent>/code/
   +-- skills/<agentName> --> .ploinky/repos/<repo>/<agent>/.AchillesSkills/

4. PRE-CONTAINER LIFECYCLE
   lifecycleHooks.js:runPreContainerLifecycle()
   +-- Run hosthook_preinstall if defined in manifest
   +-- Create workspace structure & symlinks
   +-- Create agent work directory

5. HOST-SIDE DEPENDENCY PREP
   dependencyInstaller.js:prepareAgentPackageJson()
   +-- Read globalDeps/package.json (4 core deps)
   +-- Merge with agent's package.json (if exists)
   +-- Write merged package.json to agents/<agentName>/package.json

6. CONTAINER CREATION
   agentServiceManager.js:startAgentContainer()
   +-- Resolve symlinks to real paths
   +-- Create node_modules directory on host
   +-- Build volume mount arguments
   +-- Build entrypoint: install snippet + manifest hook + agent command
   +-- docker/podman run

7. IN-CONTAINER INSTALL (entrypoint)
   +-- Install git + build tools if missing
   +-- npm install --prefix $WORKSPACE_PATH
   +-- Run manifest install hook (if defined)

8. AGENT STARTS
   +-- If manifest has "agent" + "start": run start cmd, launch agent as sidecar
   +-- If manifest has "agent" only: run agent command
   +-- If neither: run AgentServer.sh (default MCP server with restart loop)

9. POST-CONTAINER LIFECYCLE
   +-- Run profile lifecycle hooks (if using profiles)
   +-- Or run postinstall hook (if not using profiles)
```

---

## 7. Ploinky Project Structure (Development)

```
<ploinky-install>/
+-- bin/                     # CLI executables
|   +-- ploinky              # Main entry point (sets PLOINKY_ROOT, runs cli/index.js)
|   +-- p-cli               # Alias
|   +-- ploinky-shell        # Shell mode launcher
|   +-- psh                  # Shell alias
|   +-- achilles-cli         # Achilles framework CLI
|
+-- cli/                     # Core CLI application
|   +-- index.js             # Interactive shell & command handler
|   +-- shell.js             # Shell interaction & TTY handling
|   +-- commands/            # User command handlers
|   +-- server/              # HTTP server & web interfaces
|   |   +-- auth/            # Authentication (JWT, PKCE, Keycloak, SSO)
|   |   +-- handlers/        # HTTP request handlers
|   |   +-- webchat/         # Web chat interface
|   |   +-- webmeet/         # WebRTC meeting interface
|   |   +-- webtty/          # Web terminal interface
|   |   +-- mcp-proxy/       # MCP protocol proxy
|   |   +-- static/          # Static file serving
|   |   +-- utils/           # Server utilities
|   +-- services/            # Business logic
|       +-- config.js        # Workspace root discovery & path constants
|       +-- agents.js        # Agent lifecycle management
|       +-- repos.js         # Repository management
|       +-- workspaceStructure.js   # Directory & symlink management
|       +-- dependencyInstaller.js  # Dependency installation
|       +-- lifecycleHooks.js       # Lifecycle hook execution
|       +-- profileService.js       # Profile management
|       +-- bootstrapManifest.js    # Manifest parsing
|       +-- secretInjector.js       # Secret env injection
|       +-- docker/                 # Container orchestration
|           +-- agentServiceManager.js  # Container creation & volume mounts
|           +-- containerFleet.js       # Multi-container management
|           +-- common.js              # Shared container utilities
|           +-- healthProbes.js        # Health checking
|
+-- Agent/                   # Agent runtime framework (mounted ro in containers)
|   +-- server/
|   |   +-- AgentServer.mjs  # MCP server (tools, resources, prompts)
|   |   +-- AgentServer.sh   # Shell wrapper with restart loop
|   |   +-- TaskQueue.mjs    # Async task queue manager
|   +-- client/
|       +-- AgentMcpClient.mjs    # Agent-to-agent MCP client
|       +-- MCPBrowserClient.js   # Browser-side MCP client
|
+-- globalDeps/              # Global dependency definitions
|   +-- package.json         # The 4 core deps every agent gets
|
+-- package.json             # Ploinky's own dependencies
+-- tests/                   # Test suites
+-- webLibs/                 # Browser-side libraries
+-- dashboard/               # Dashboard components
```

---

## 8. Container Filesystem Layout (at runtime)

Inside a running agent container:

```
/
+-- Agent/                        # Ploinky agent framework (ro)
|   +-- server/
|   |   +-- AgentServer.mjs
|   |   +-- AgentServer.sh
|   |   +-- TaskQueue.mjs
|   +-- node_modules/             # --> host: $CWD/agents/<agent>/node_modules/ (rw)
|
+-- code/                         # Agent source code (rw or ro per profile)
|   +-- main.mjs                  # (example agent entry)
|   +-- package.json              # Agent's own package.json
|   +-- .AchillesSkills/          # Skills directory (if mounted)
|   +-- node_modules/             # --> host: $CWD/agents/<agent>/node_modules/ (rw)
|
+-- shared/                       # Shared data between agents (rw)
|
+-- $CWD/agents/<agent>/          # CWD passthrough mount (rw)
```

Note: `/code/node_modules` and `/Agent/node_modules` point to the **same** host directory.

---

## 9. Environment Variables Set in Containers

| Variable | Value | Purpose |
|---|---|---|
| `WORKSPACE_PATH` | `$CWD/agents/<agentName>/` | Agent working directory |
| `AGENT_NAME` | `<agentName>` | Agent identifier |
| `NODE_PATH` | `/code/node_modules` | Module resolution for AgentServer.mjs |
| `PLOINKY_MCP_CONFIG_PATH` | `/tmp/ploinky/mcp-config.json` | MCP configuration file path |
| `PLOINKY_ROUTER_PORT` | Port from routing.json (default `8080`) | Router port for inter-agent communication |
| Profile env vars | From `manifest.profiles.<profile>.env` | Profile-specific configuration |
| Secret vars | From `.ploinky/.secrets` | Secret environment variables |
