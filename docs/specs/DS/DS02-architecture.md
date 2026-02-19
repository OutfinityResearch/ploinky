# DS02 - System Architecture

## Summary

Ploinky's architecture follows a modular, layered design with the Ploinky CLI as the central orchestrator. The system manages containerized agents through Docker/Podman, provides HTTP routing via the Router Server, and exposes web interfaces for terminal, chat, and collaborative access. All components communicate through well-defined interfaces with clear separation of concerns.

## Background / Problem Statement

Modern multi-agent systems require:
- Reliable container lifecycle management
- Unified HTTP routing to multiple services
- Secure authentication and session management
- Multiple access interfaces (CLI, web terminal, chat)
- Persistent configuration and state management

The architecture must support these requirements while remaining simple to understand and extend.

## Goals

1. **Modular Design**: Clear separation between CLI, routing, and container management
2. **Scalable Routing**: Support multiple concurrent agents with unified HTTP endpoint
3. **Secure Access**: Token-based authentication for web interfaces
4. **Extensible**: Easy to add new commands, handlers, and interfaces
5. **Container-Agnostic**: Support both Docker and Podman runtimes

## Non-Goals

- High-availability clustering
- Load balancing across multiple hosts
- Container orchestration at Kubernetes scale
- Built-in monitoring/alerting infrastructure

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  CLI Shell   │  │   WebTTY     │  │   WebChat    │  │  Dashboard   │ │
│  │  (readline)  │  │  (xterm.js)  │  │  (custom)    │  │   (HTML)     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
└─────────┼─────────────────┼─────────────────┼─────────────────┼─────────┘
          │                 │                 │                 │
          ▼                 └────────────┬────┴─────────────────┘
┌─────────────────────────────────────────┼───────────────────────────────┐
│                      ROUTING & API LAYER│                                │
│  ┌──────────────────────────────────────▼──────────────────────────────┐│
│  │                      Router Server (HTTP:8088)                       ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ ││
│  │  │ Auth        │  │ MCP Proxy   │  │ Static      │  │ WebSocket   │ ││
│  │  │ Handlers    │  │ Handlers    │  │ Files       │  │ Handlers    │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Agent        │  │ Workspace    │  │ Profile      │  │ Secret       │ │
│  │ Service      │  │ Service      │  │ Service      │  │ Injector     │ │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                                                                │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Docker       │  │ Manifest     │  │ Repository   │  │ Lifecycle    │ │
│  │ Integration  │  │ Registry     │  │ Manager      │  │ Hooks        │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTAINER LAYER                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐│
│  │                    Docker/Podman Runtime                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ ││
│  │  │ Agent 1     │  │ Agent 2     │  │ Agent 3     │  │ Agent N     │ ││
│  │  │ AgentServer │  │ AgentServer │  │ AgentServer │  │ AgentServer │ ││
│  │  │ Port 7000   │  │ Port 7000   │  │ Port 7000   │  │ Port 7000   │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ ││
│  └──────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  User    │───▶│  CLI     │───▶│ Services │───▶│ Docker   │
│          │    │          │    │          │    │          │
│ Commands │    │ Dispatch │    │ Execute  │    │ Manage   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │
                     ▼
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │  Router  │───▶│ Handler  │───▶│  Agent   │
              │  Server  │    │          │    │ Container│
              │ HTTP:8088│    │ Dispatch │    │ HTTP:7000│
              └──────────┘    └──────────┘    └──────────┘
```

## Data Models

### Configuration Hierarchy

```javascript
/**
 * @typedef {Object} PloinkyConfig
 * @property {string} ploinkyRoot - Installation directory
 * @property {string} workspaceRoot - Current workspace (.ploinky/)
 * @property {string} profile - Active profile (dev/qa/prod)
 * @property {Object} routing - Router configuration
 */

/**
 * @typedef {Object} RoutingConfig
 * @property {string} staticAgent - Agent serving static files
 * @property {number} port - Router HTTP port
 * @property {Object.<string, RouteEntry>} routes - Agent route mappings
 */

/**
 * @typedef {Object} RouteEntry
 * @property {number} containerPort - Port inside container
 * @property {number} hostPort - Port mapped to host
 * @property {string} [hostIp] - Optional host IP binding
 */
```

### Service Layer Interfaces

```javascript
// Agent Service Interface
interface AgentService {
  loadAgent(agentName: string): Promise<AgentConfig>;
  startAgent(agentName: string, options?: StartOptions): Promise<void>;
  stopAgent(agentName: string): Promise<void>;
  restartAgent(agentName: string): Promise<void>;
  getAgentStatus(agentName: string): Promise<AgentStatus>;
  listAgents(): Promise<AgentConfig[]>;
}

// Workspace Service Interface
interface WorkspaceService {
  loadWorkspace(): Promise<WorkspaceConfig>;
  saveWorkspace(config: WorkspaceConfig): Promise<void>;
  initWorkspace(): Promise<void>;
  getEnabledRepos(): Promise<string[]>;
  getEnabledAgents(): Promise<string[]>;
}

// Docker Service Interface
interface DockerService {
  createContainer(config: ContainerConfig): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  execInContainer(containerId: string, command: string): Promise<ExecResult>;
  getContainerStatus(containerId: string): Promise<ContainerStatus>;
}
```

## API Contracts

### CLI Command Dispatch

```javascript
/**
 * Command dispatch flow
 * @param {string[]} args - Command line arguments
 * @returns {Promise<void>}
 */
async function dispatchCommand(args) {
  const [command, ...subArgs] = args;

  switch (command) {
    case 'start':
      return handleStart(subArgs);
    case 'stop':
      return handleStop(subArgs);
    case 'shell':
      return handleShell(subArgs);
    case 'enable':
      return handleEnable(subArgs);
    // ... other commands
  }
}
```

### Router HTTP Endpoints

| Endpoint Pattern | Handler | Purpose |
|------------------|---------|---------|
| `GET /` | `dashboard.js` | Redirect to dashboard |
| `GET /dashboard` | `dashboard.js` | Dashboard HTML |
| `GET /status` | `status.js` | System status JSON |
| `GET /webtty/:agent` | `webtty.js` | WebTTY interface |
| `GET /webchat/:agent` | `webchat.js` | WebChat interface |
| `GET /webmeet` | `webmeet.js` | WebMeet interface |
| `* /mcps/:agent/*` | `routerHandlers.js` | MCP proxy to agent |
| `GET /blobs/:id` | `blobs.js` | File blob access |

### Agent MCP Protocol

```javascript
/**
 * MCP Request format
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: object;
}

/**
 * MCP Response format
 */
interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
```

## Behavioral Specification

### Startup Sequence

```
1. User executes: ploinky start <agent> <port>

2. CLI parses command, validates arguments

3. Workspace service loads .ploinky/agents registry

4. For each enabled agent:
   a. Load manifest.json
   b. Resolve container image
   c. Check if container exists
   d. If not exists: create container with mounts
   e. Start container
   f. Wait for health check (if defined)
   g. Register route in routing.json

5. Router server starts on specified port

6. Router loads routing.json

7. System ready - agents accessible via router
```

### Request Routing Flow

```
1. HTTP request arrives at Router (port 8088)

2. Router extracts path: /mcps/<agent>/...

3. Authentication check:
   a. Check token in query params or header
   b. Validate against .ploinky/.secrets
   c. Reject if invalid

4. Route lookup:
   a. Find agent in routing.json
   b. Get container port mapping
   c. Build upstream URL

5. Proxy request:
   a. Forward to container:7000
   b. Stream response back to client

6. Log request completion
```

### Container Lifecycle States

```
┌──────────────────────────────────────────────────────────┐
│                 Container State Machine                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────┐   create   ┌─────────┐   start   ┌───────┐ │
│  │ (none)  │──────────▶│ CREATED │─────────▶│RUNNING│ │
│  └─────────┘            └─────────┘           └───┬───┘ │
│       ▲                      │                    │     │
│       │                      │ remove             │stop │
│       │                      ▼                    ▼     │
│       │                 ┌─────────┐          ┌───────┐  │
│       └─────────────────│ REMOVED │◀─────────│STOPPED│  │
│           remove        └─────────┘  remove  └───────┘  │
│                                                  │      │
│                              ┌───────────────────┘      │
│                              │ start                    │
│                              ▼                          │
│                         ┌───────┐                       │
│                         │RUNNING│ (loop back)           │
│                         └───────┘                       │
└──────────────────────────────────────────────────────────┘
```

## Configuration

### Workspace Directory Structure

The workspace is any directory containing a `.ploinky/` subdirectory. Ploinky discovers it by walking up from `process.cwd()` until it finds `.ploinky/`.

```
<workspace-root>/
│
├── .ploinky/                        # Ploinky metadata (hidden)
│   ├── agents                       # JSON file: registered agent records
│   ├── enabled_repos.json           # JSON file: enabled repository list
│   ├── routing.json                 # JSON file: container routing table
│   ├── running/                     # Running container state
│   │   └── router.pid              # Router process ID
│   ├── .secrets                     # Secret environment variables (KEY=VALUE)
│   ├── profile                      # Active profile name (e.g., "dev")
│   └── repos/                       # Cloned agent repositories
│       └── <repoName>/
│           └── <agentName>/
│               ├── manifest.json    # Agent configuration
│               ├── code/            # Agent source code (optional subdirectory)
│               ├── .AchillesSkills/ # Agent skills (optional)
│               └── package.json     # Agent-specific dependencies (optional)
│
├── agents/                          # Working directories (one per agent)
│   └── <agentName>/
│       ├── node_modules/            # Installed npm dependencies
│       ├── package.json             # Merged package.json (global + agent)
│       └── package-lock.json        # Lock file from npm install
│
├── code/                            # Symlinks to agent source code
│   └── <agentName> --> .ploinky/repos/<repoName>/<agentName>/code/
│
├── skills/                          # Symlinks to agent skills
│   └── <agentName> --> .ploinky/repos/<repoName>/<agentName>/.AchillesSkills/
│
└── shared/                          # Shared directory accessible to all agents
```

**Key source files:**
- `cli/services/config.js` — Defines all path constants
- `cli/services/workspaceStructure.js` — Creates directories, symlinks, verifies integrity

#### Path Constants (from `config.js`)

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

### Symlinks

Symlinks provide convenient top-level access to agent code and skills that live deep inside `.ploinky/repos/`.

| Symlink | Target | Condition |
|---|---|---|
| `$CWD/code/<agentName>` | `.ploinky/repos/<repo>/<agent>/code/` | Always (falls back to agent root if no `code/` subdirectory) |
| `$CWD/skills/<agentName>` | `.ploinky/repos/<repo>/<agent>/.AchillesSkills/` | Only if `.AchillesSkills/` exists |

**Creation logic** (`workspaceStructure.js:createAgentSymlinks()`):

1. Checks if `<agentPath>/code/` exists; if yes, symlinks to that; otherwise symlinks to `<agentPath>/` itself
2. Removes any existing symlink at the target location
3. If a **real** file/directory blocks the symlink path, it warns and skips (does not overwrite)
4. Skills symlink is only created if `.AchillesSkills/` actually exists in the agent repo

**When symlinks are created:**
- Agent enable (`agents.js:enableAgent()`)
- Pre-container lifecycle (`lifecycleHooks.js:runPreContainerLifecycle()`)

**Symlink resolution for containers:** Before mounting into containers, symlinks are **resolved to real paths** via `fs.realpathSync()` (in `agentServiceManager.js:resolveSymlinkPath()`) because Docker/Podman volume mounts don't follow host symlinks reliably.

### Module Resolution

The entire codebase uses **ES Modules** (`"type": "module"` in all package.json files).

**On the host (CLI code):** Standard Node.js ESM resolution from ploinky's own `node_modules/`:

```javascript
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

**Inside containers (agent code at `/code/`):** Standard ESM resolution walks up to `/code/node_modules/`.

**Inside containers (AgentServer.mjs at `/Agent/server/`):** Node.js would walk up to `/Agent/node_modules/` which is empty by default. Two mechanisms fix this:

1. **Dual mount** — `$CWD/agents/<agent>/node_modules/` is mounted at both `/code/node_modules` and `/Agent/node_modules`
2. **NODE_PATH** — Set to `/code/node_modules` as a container environment variable

```javascript
// In agentServiceManager.js
args.push('-e', 'NODE_PATH=/code/node_modules');
```

No custom resolvers, import maps, path aliases, `.npmrc`, or monorepo workspaces are used.

### Entry Point Resolution

The `bin/ploinky` script sets `PLOINKY_ROOT` and launches the CLI:

```bash
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
export PLOINKY_ROOT=$(realpath "$SCRIPT_DIR/..")
node "$SCRIPT_DIR/../cli/index.js" "$@"
```

`PLOINKY_ROOT` is used by `dependencyInstaller.js` to locate ploinky's own `node_modules/` for core dependency syncing.

### Ploinky Source Layout (Development)

```
<ploinky-install>/
├── bin/                     # CLI executables (ploinky, p-cli, psh, achilles-cli)
├── cli/                     # Core CLI application
│   ├── index.js             # Interactive shell & command handler
│   ├── shell.js             # Shell interaction & TTY handling
│   ├── commands/            # User command handlers
│   ├── server/              # HTTP server & web interfaces
│   │   ├── auth/            # Authentication (JWT, PKCE, Keycloak, SSO)
│   │   ├── handlers/        # HTTP request handlers
│   │   ├── webchat/         # Web chat interface
│   │   ├── webmeet/         # WebRTC meeting interface
│   │   ├── webtty/          # Web terminal interface
│   │   ├── mcp-proxy/       # MCP protocol proxy
│   │   ├── static/          # Static file serving
│   │   └── utils/           # Server utilities
│   └── services/            # Business logic
│       ├── config.js                # Workspace root discovery & path constants
│       ├── agents.js                # Agent lifecycle management
│       ├── repos.js                 # Repository management
│       ├── workspaceStructure.js    # Directory & symlink management
│       ├── dependencyInstaller.js   # Dependency installation
│       ├── lifecycleHooks.js        # Lifecycle hook execution
│       ├── profileService.js        # Profile management
│       ├── bootstrapManifest.js     # Manifest parsing
│       ├── secretInjector.js        # Secret env injection
│       └── docker/                  # Container orchestration
│           ├── agentServiceManager.js   # Container creation & volume mounts
│           ├── containerFleet.js        # Multi-container management
│           ├── common.js               # Shared container utilities
│           └── healthProbes.js          # Health checking
├── Agent/                   # Agent runtime framework (mounted ro in containers)
│   ├── server/
│   │   ├── AgentServer.mjs  # MCP server (tools, resources, prompts)
│   │   ├── AgentServer.sh   # Shell wrapper with restart loop
│   │   └── TaskQueue.mjs    # Async task queue manager
│   └── client/
│       ├── AgentMcpClient.mjs    # Agent-to-agent MCP client
│       └── MCPBrowserClient.js   # Browser-side MCP client
├── globalDeps/              # Global dependency definitions
│   └── package.json         # The 4 core deps every agent gets
├── package.json             # Ploinky's own dependencies
├── tests/                   # Test suites
├── webLibs/                 # Browser-side libraries
└── dashboard/               # Dashboard components
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLOINKY_ROOT` | Auto-detected | Ploinky installation directory |
| `PLOINKY_DEBUG` | `false` | Enable debug logging |
| `PLOINKY_PROFILE` | `dev` | Active profile |
| `CONTAINER_RUNTIME` | Auto-detected | `docker` or `podman` |
| `ROUTER_PORT` | `8088` | Default router HTTP port |

## Error Handling

### Error Categories

| Category | HTTP Status | Recovery |
|----------|-------------|----------|
| Configuration Error | N/A (CLI) | Display error, exit |
| Container Error | 500 | Retry with backoff |
| Authentication Error | 401/403 | Prompt for valid token |
| Agent Not Found | 404 | List available agents |
| Upstream Timeout | 504 | Retry or report failure |

### Error Response Format

```javascript
{
  error: {
    code: 'AGENT_NOT_FOUND',
    message: 'Agent "my-agent" not found in enabled agents',
    details: {
      available: ['node-dev', 'shell', 'postgres'],
      suggestion: 'Run: ploinky enable agent my-agent'
    }
  }
}
```

## Security Considerations

### Authentication Flow

```
1. User requests web interface

2. Router checks for auth token:
   - Query param: ?token=<token>
   - Cookie: ploinky_token=<token>
   - Header: Authorization: Bearer <token>

3. Token validation:
   - Compare against .ploinky/.secrets
   - Check token expiration (if applicable)

4. If valid: proceed to handler
   If invalid: redirect to login or return 401
```

### Security Boundaries

| Component | Trust Level | Access |
|-----------|-------------|--------|
| CLI | Full | All operations |
| Router | Limited | HTTP routing only |
| Web UI | Authenticated | Per-interface access |
| Agent Container | Sandboxed | Isolated filesystem |

## Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| CLI startup | < 500ms | Excluding container starts |
| Router startup | < 1s | Excluding agent health checks |
| Request latency overhead | < 10ms | Router proxy overhead |
| Container start | < 5s | Excluding image pulls |
| Max concurrent agents | 20+ | Memory dependent |

## Success Criteria

1. Clean separation between CLI, services, and container layers
2. All HTTP endpoints documented and consistent
3. Error messages actionable with clear recovery steps
4. Configuration changes take effect without restart (where applicable)
5. Debug mode provides comprehensive logging

## Bootstrap & First-Time Setup

### Bootstrap Flow (cli/services/ploinkyboot.js)

On first run, Ploinky bootstraps the workspace:

```
bootstrap():
├─ ensureDefaultRepo():
│   ├─ Create .ploinky/repos/ if needed
│   ├─ Check if .ploinky/repos/basic/ exists
│   └─ If not: git clone https://github.com/PloinkyRepos/Basic.git
│
└─ Ensure 'basic' is in enabled_repos.json
```

### Server Manager (cli/services/serverManager.js)

Manages port allocation and token generation for web interface servers:

| Function | Description |
|----------|-------------|
| `findAvailablePort(min, max)` | Random port in 10000-60000 range, verify TCP availability |
| `isPortAvailable(port)` | Bind test on 127.0.0.1 |
| `ensureServerConfig(name, opts)` | Allocate port + generate 32-byte token for web component |
| `loadServersConfig()` | Load from `.ploinky/servers.json` |
| `saveServersConfig(config)` | Persist to `.ploinky/servers.json` |
| `getAllServerStatuses()` | Check PID files for running web servers |
| `isServerRunning(pidFile)` | Check process by PID file |
| `stopServer(pidFile, name)` | Send SIGTERM to server process |

Configuration persisted in `.ploinky/servers.json`:

```json
{
  "webtty": { "port": 12345, "token": "abc123...", "command": null },
  "webchat": { "port": 12346, "token": "def456...", "command": null },
  "webmeet": { "port": 12347, "token": "ghi789...", "agent": null },
  "dashboard": { "port": 12348, "token": "jkl012..." }
}
```

## References

- [DS01 - Vision](./DS01-vision.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS06 - Web Interfaces](./DS06-web-interfaces.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
- [DS11 - Container Runtime & Dependencies](./DS11-container-runtime.md)
- [DS13 - Watchdog & Reliability](./DS13-watchdog-reliability.md)
- [DS14 - LLM Integration](./DS14-llm-integration.md)
- [DS15 - Logging & Observability](./DS15-logging-observability.md)
