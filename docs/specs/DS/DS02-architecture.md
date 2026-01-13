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

### Directory Structure

```
$CWD/
├── .ploinky/                    # Workspace configuration root
│   ├── agents                   # JSON: enabled agents registry
│   ├── enabled_repos.json       # JSON: list of enabled repos
│   ├── .secrets                 # Key-value secrets (gitignored)
│   ├── routing.json             # Generated: router config
│   ├── profile                  # Current active profile
│   ├── repos/                   # Cloned agent repositories
│   │   └── <repo>/
│   │       └── <agent>/
│   │           └── manifest.json
│   └── running/
│       └── router.pid           # Router process ID
│
├── agents/                      # Agent working directories
│   └── <agent>/
│       ├── node_modules/        # Isolated dependencies
│       ├── package.json
│       └── data/
│
├── code/                        # Symlinks to agent code
│   └── <agent> -> .ploinky/repos/<repo>/<agent>/code/
│
└── skills/                      # Symlinks to agent skills
    └── <agent> -> .ploinky/repos/<repo>/<agent>/.AchillesSkills/
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

## References

- [DS01 - Vision](./DS01-vision.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS06 - Web Interfaces](./DS06-web-interfaces.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
- [DS11 - Container Runtime](./DS11-container-runtime.md)
