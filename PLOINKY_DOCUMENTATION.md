# Ploinky Documentation

## Overview

Ploinky is a lightweight, technology-agnostic multi-agent runtime platform that orchestrates containerized services. Any program that reads from stdin and writes to stdout can become a Ploinky agent, regardless of programming language. Each agent runs in an isolated Docker/Podman container with the workspace mounted.

### Key Features

- **Container-Based Isolation**: Each agent runs in its own Docker/Podman container
- **Technology Agnostic**: Agents can be implemented in any language
- **Multi-Agent Orchestration**: Support for multiple concurrent agents with unified routing
- **Web Interfaces**: WebTTY (terminal), Webchat, Webmeet (collaboration), and Dashboard
- **MCP Protocol**: Model Context Protocol for agent communication
- **Local-First**: Focuses on local workspaces with CLI and web interfaces

### Prerequisites

- Node.js 18+
- Docker or Podman
- Git

---

## Architecture

### High-Level Architecture

```
                     ┌──────────────────────────────────────────────────┐
                     │              Ploinky CLI (Main App)               │
                     │     cli/index.js, cli/commands/, cli/services/   │
                     └─────────────────────┬────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
      ┌───────▼────────┐          ┌───────▼────────┐          ┌───────▼────────┐
      │  Router Server │          │ Agent Manager  │          │ AchillesLib    │
      │   (HTTP:8088)  │          │ (.ploinky/)    │          │ Skills         │
      └───────┬────────┘          └───────┬────────┘          └────────────────┘
              │                           │
              │                   ┌───────▼────────┐
              │                   │  Manifest      │
              │                   │  Registry      │
              │                   │ (.ploinky/     │
              │                   │  agents)       │
              │                   └───────┬────────┘
              │                           │
      ┌───────▼───────────────────────────▼────────────────────────────┐
      │              Docker/Podman Containers                           │
      │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
      │  │ Agent 1     │  │ Agent 2     │  │ Agent N     │             │
      │  │ (port 7001) │  │ (port 7002) │  │ (port 700N) │             │
      │  │ MCP Server  │  │ MCP Server  │  │ MCP Server  │             │
      │  └─────────────┘  └─────────────┘  └─────────────┘             │
      └────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
ploinky/
├── bin/                          # Entry point executables
│   ├── ploinky                   # Main CLI launcher (bash wrapper)
│   ├── p-cli                     # Legacy CLI entry point
│   ├── ploinky-shell             # Dedicated shell mode launcher
│   └── achilles-cli              # Achilles agent library CLI
│
├── cli/                          # Core CLI application (Node.js)
│   ├── index.js                  # Main CLI entry point (~400 lines)
│   │
│   ├── commands/                 # Command handlers
│   │   ├── cli.js                # Main command dispatch
│   │   ├── client.js             # Remote agent client operations
│   │   ├── llmSystemCommands.js  # LLM integration for suggestions
│   │   ├── repoAgentCommands.js  # Repository and agent management
│   │   ├── envVarCommands.js     # Environment variable handling
│   │   ├── sessionControl.js     # Session lifecycle management
│   │   ├── ssoCommands.js        # SSO/authentication commands
│   │   └── webttyCommands.js     # WebTTY configuration
│   │
│   ├── services/                 # Core service modules
│   │   ├── config.js             # Configuration constants
│   │   ├── agents.js             # Agent lifecycle and manifest handling
│   │   ├── workspace.js          # Agent registry persistence
│   │   ├── repos.js              # Repository management
│   │   ├── workspaceUtil.js      # Workspace startup/lifecycle
│   │   ├── secretVars.js         # Secret management
│   │   ├── bootstrapManifest.js  # Manifest directive processing
│   │   │
│   │   └── docker/               # Docker integration layer
│   │       ├── common.js         # Container utilities
│   │       ├── interactive.js    # Interactive exec and shells
│   │       ├── containerFleet.js # Container lifecycle management
│   │       ├── agentServiceManager.js # Agent service orchestration
│   │       ├── agentCommands.js  # Command execution in containers
│   │       └── healthProbes.js   # Liveness/readiness checks
│   │
│   └── server/                   # HTTP Routing Server (Node.js)
│       ├── RoutingServer.js      # Main server
│       ├── routerHandlers.js     # Agent request proxying
│       ├── authHandlers.js       # Token/auth enforcement
│       │
│       ├── handlers/             # HTTP endpoint handlers
│       │   ├── webtty.js         # Terminal via WebSocket
│       │   ├── webchat.js        # Chat interface with agents
│       │   ├── webmeet.js        # Collaborative meetings
│       │   └── dashboard.js      # Web-based UI
│       │
│       ├── mcp-proxy/            # MCP protocol bridge
│       │   └── index.js          # MCP request handling
│       │
│       └── auth/                 # Authentication layer
│           ├── service.js        # Auth orchestration
│           ├── jwt.js            # JWT token handling
│           ├── pkce.js           # PKCE OAuth flow
│           └── keycloakClient.js # Keycloak integration
│
├── Agent/                        # Shared agent runtime (mounted in containers)
│   ├── server/
│   │   ├── AgentServer.mjs       # MCP server implementation
│   │   ├── AgentServer.sh        # Supervisor shell script
│   │   └── TaskQueue.mjs         # Asynchronous task queue
│   │
│   ├── client/
│   │   ├── AgentMcpClient.mjs    # MCP client for agents
│   │   └── MCPBrowserClient.js   # Browser-side MCP client
│   │
│   └── default_cli.sh            # Default CLI fallback
│
├── .ploinky/                     # Workspace state directory
│   ├── agents                    # JSON registry of enabled agents
│   ├── enabled_repos.json        # List of active repositories
│   ├── .secrets                  # Key-value secrets file
│   ├── routing.json              # Router configuration (generated)
│   ├── repos/                    # Cloned agent repositories
│   │   └── basic/                # Default repository
│   │       ├── shell/
│   │       ├── node-dev/
│   │       ├── ubuntu-bash/
│   │       ├── postgres/
│   │       └── ...
│   └── running/                  # Runtime state
│       └── router.pid            # Router process ID
│
├── tests/                        # Test suites
│   ├── cli/                      # CLI regression tests
│   ├── smoke/                    # Fast smoke tests
│   └── unit/                     # Unit tests
│
└── package.json                  # Node.js project metadata
```

---

## Manifest File Reference

Agent behavior is defined in `manifest.json` files located in `.ploinky/repos/<repoName>/<agentName>/manifest.json`.

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `container` | string | **Yes** | Docker image URI (e.g., `node:20-bullseye`) |
| `image` | string | No | Alternative to `container` |
| `about` | string | No | Human-readable description |

### Lifecycle Hooks (Profile-Based)

Lifecycle hooks are now defined under `profiles.default` (or other named profiles). All hooks must be single command strings.

| Field | Type | Execution Context | Description |
|-------|------|-------------------|-------------|
| `hosthook_aftercreation` | string | Host | Runs on host after container creation |
| `preinstall` | string | Container | Runs before main install |
| `install` | string | Container | Main installation command |
| `postinstall` | string | Container | Runs after install completes |
| `hosthook_postinstall` | string | Host | Runs on host after container postinstall |

**Legacy fields (still supported):**
| Field | Type | Description |
|-------|------|-------------|
| `update` | string | Update command (informational) |
| `start` | string | Sidecar command to start alongside main agent |

**Profile Merging:** The `default` profile is always applied first, then the active profile is merged on top. See PROFILE_SYSTEM_SPEC.md for details.

### Entry Point Commands

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent command to execute in the container |
| `commands.run` | string | Legacy field for agent command (fallback for `agent`) |
| `cli` | string | CLI command entry point (e.g., `bash`, `sh`) |
| `run` | string | Default command to run |

### Environment Variables (Profile-Based)

Environment variables are now defined under `profiles.default.env` (or other named profiles).

**Format 1: Array of strings (simple)**
```json
{
  "profiles": {
    "default": {
      "env": ["VAR_NAME", "VAR_NAME=default_value"]
    }
  }
}
```

**Format 2: Array of objects (complex)**
```json
{
  "profiles": {
    "default": {
      "env": [
        {
          "name": "INSIDE_VAR_NAME",
          "varName": "SOURCE_VAR_NAME",
          "required": true,
          "value": "default_value"
        }
      ]
    }
  }
}
```

**Format 3: Object mapping (key-value)**
```json
{
  "profiles": {
    "default": {
      "env": {
        "INSIDE_VAR_NAME": {
          "varName": "SOURCE_VAR_NAME",
          "required": false,
          "default": "default_value"
        },
        "SIMPLE_VAR": "default_value"
      }
    }
  }
}
```

### Port Mappings

```json
{
  "ports": [
    "7000",                    // container port only
    "8000:8000",               // hostPort:containerPort
    "127.0.0.1:8000:8000",     // hostIp:hostPort:containerPort
    "0.0.0.0:5432:5432"        // all interfaces
  ]
}
```

Or single port:
```json
{
  "port": "7000"
}
```

### Volume Mappings

```json
{
  "volumes": {
    "postgres/data": "/var/lib/postgresql/data",
    "/absolute/path": "/container/path"
  }
}
```

### Exposed Environment Variables

```json
{
  "expose": {
    "EXPOSED_VAR_NAME": "literal_value",
    "ANOTHER_VAR": "$SOURCE_VAR_NAME"
  }
}
```

### Agent Dependencies (Enable Directives)

```json
{
  "enable": [
    "agentName",
    "agentName global",
    "agentName devel repoName",
    "agentName global as myAlias"
  ]
}
```

### Repository Definitions

```json
{
  "repos": {
    "repoName": "https://github.com/user/repo.git"
  }
}
```

---

## Manifest Examples

### Simple Agent (node-dev)

```json
{
  "container": "node:20-bullseye",
  "update": "npm update -g typescript ts-node nodemon jest mocha chai eslint prettier webpack vite npm-check-updates yarn pnpm",
  "run": "node",
  "profiles": {
    "default": {
      "install": "npm install -g typescript ts-node nodemon jest mocha chai eslint prettier webpack vite npm-check-updates yarn pnpm"
    }
  }
}
```

### Database Agent (postgres)

```json
{
  "container": "docker.io/library/postgres:16-alpine",
  "about": "PostgreSQL database server for Keycloak and other applications",
  "agent": "postgres",
  "ports": [
    "0.0.0.0:5432:5432"
  ],
  "volumes": {
    "postgres/data": "/var/lib/postgresql/data"
  },
  "profiles": {
    "default": {
      "env": [
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "PGDATA"
      ]
    }
  }
}
```

### Complex Agent with Environment (keycloak)

```json
{
  "container": "quay.io/keycloak/keycloak:24.0",
  "about": "Keycloak identity provider used to secure Ploinky workspaces via SSO.",
  "start": "start --hostname-strict=false --http-enabled=true --proxy-headers forwarded",
  "ports": [
    "0.0.0.0:9090:9090"
  ],
  "volumes": {
    "keycloak/keycloak-data": "/opt/keycloak/data"
  },
  "profiles": {
    "default": {
      "env": {
        "KC_HTTP_PORT": {
          "varName": "SSO_HTTP_PORT",
          "required": "false",
          "default": "9090"
        },
        "KEYCLOAK_ADMIN": {
          "varName": "SSO_ADMIN",
          "required": "false",
          "default": "admin"
        },
        "KEYCLOAK_ADMIN_PASSWORD": {
          "varName": "SSO_ADMIN_PASSWORD",
          "required": "false",
          "default": "admin"
        }
      }
    }
  }
}
```

### Web Automation Agent (puppeteer)

```json
{
  "container": "ghcr.io/puppeteer/puppeteer:latest",
  "update": "npm update -g puppeteer-cli",
  "run": "node",
  "about": "Headless Chrome automation. Web scraping, testing, screenshots",
  "profiles": {
    "default": {
      "install": "npm install -g puppeteer-cli"
    }
  }
}
```

---

## CLI Commands Reference

### Repository Management

| Command | Description |
|---------|-------------|
| `add repo <url>` | Add a new repository |
| `enable repo <name>` | Enable a repository |
| `disable repo <name>` | Disable a repository |
| `list repos` | List all repositories |

### Agent Operations

| Command | Description |
|---------|-------------|
| `enable agent <name> [mode] [as alias]` | Enable an agent |
| `disable agent <name>` | Disable an agent |
| `refresh agent <name>` | Rebuild and restart agent container |
| `list agents` | List all enabled agents |

**Agent Modes:**
- `isolated` (default): Agent gets its own project directory
- `global`: Uses current working directory
- `devel <repo>`: Points to development repo path

### Workspace Control

| Command | Description |
|---------|-------------|
| `start [agent] [port]` | Start workspace with router |
| `stop` | Stop containers (don't remove) |
| `restart [agent]` | Restart agent(s) |
| `shutdown` | Stop and remove containers |
| `destroy` | Full cleanup of workspace |
| `clean` | Clean temporary files |
| `status` | Show workspace status |

### Interactive Access

| Command | Description |
|---------|-------------|
| `shell <agent>` | Interactive shell in agent container |
| `cli <agent> [args]` | Run agent's CLI command |
| `webtty` | Start web terminal interface |
| `webconsole` | Combined TTY + Chat interface |
| `webmeet` | Collaborative meeting interface |

### Client Operations

| Command | Description |
|---------|-------------|
| `client methods <agent>` | List available agent methods |
| `client status <agent>` | Check agent health |
| `client task <agent> [params]` | Send task to agent |
| `client task-status` | Check task status |
| `client list` | List active clients |

### Variable Management

| Command | Description |
|---------|-------------|
| `var <NAME> <value>` | Set a variable |
| `vars` | List all variables |
| `echo <VAR>` | Print variable value |
| `expose <ENV_NAME> <value> [agent]` | Expose variable to agent |

### Logging & Monitoring

| Command | Description |
|---------|-------------|
| `logs tail [router\|webtty]` | Tail logs |
| `logs last <count> [router\|webtty]` | Show last N log entries |

### System Commands

| Command | Description |
|---------|-------------|
| `help [topic]` | Show help |
| `settings` or `/settings` | Open settings menu |

---

## Configuration Files

### `.ploinky/agents` (JSON Agent Registry)

```json
{
  "ploinky_basic_node-dev_projectDir_hash": {
    "agentName": "node-dev",
    "repoName": "basic",
    "containerImage": "node:20-bullseye",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "projectPath": "/absolute/path/to/project",
    "runMode": "isolated",
    "type": "agent",
    "config": {
      "binds": [
        { "source": "/host/path", "target": "/container/path", "ro": false }
      ],
      "env": [
        { "name": "VAR_NAME" }
      ],
      "ports": [
        { "containerPort": 7000, "hostPort": 12345, "hostIp": "127.0.0.1" }
      ]
    }
  },
  "_config": {
    "static": {
      "agent": "node-dev",
      "container": "containerName"
    }
  }
}
```

### `.ploinky/enabled_repos.json`

```json
[
  "basic",
  "cloud",
  "custom-repo"
]
```

### `.ploinky/.secrets`

```bash
# Secrets and variables
API_KEY=sk-12345...
WEBTTY_TOKEN=abc123def456...
WEBCHAT_TOKEN=xyz789...
```

### `.ploinky/routing.json` (Runtime Generated)

```json
{
  "staticAgent": "demo",
  "port": 8080,
  "routes": {
    "demo": {
      "containerPort": 7000,
      "hostPort": 12345
    }
  }
}
```

---

## Agent Communication

### MCP Protocol

Agents communicate using the Model Context Protocol (MCP) over HTTP. The routing server proxies requests from `/mcps/<agent>/*` to the agent's container.

**Request Flow:**
```
Client → Router (8088) → /mcps/<agent>/mcp → Agent Container (7000) → AgentServer.mjs
```

### Agent Server

Each container runs `AgentServer.mjs` which:
- Listens on port 7000 (default)
- Implements MCP server protocol
- Manages task queue with configurable concurrency
- Exposes tools and resources via MCP

### Agent-to-Agent Communication

Agents can communicate with each other through the router:

```javascript
// From AgentMcpClient.mjs
getAgentMcpUrl(agentName)  // Returns /mcps/<agentName>/mcp
```

---

## Predefined Repositories

| Repository | Description |
|------------|-------------|
| `basic` | Default base agents (shell, node-dev, postgres, etc.) |
| `cloud` | Cloud infrastructure agents |
| `vibe` | Vibe coding agents |
| `security` | Security and scanning tools |
| `extra` | Additional utility agents |
| `demo` | Demo agents and examples |

### Available Agents in `basic` Repository

- `alpine-bash` - Alpine Linux shell
- `clamav-scanner` - Antivirus scanner
- `curl-agent` - HTTP client
- `debian-bash` - Debian shell
- `docker-agent` - Docker management
- `fedora-bash` - Fedora shell
- `github-cli-agent` - GitHub CLI
- `gitlab-cli-agent` - GitLab CLI
- `keycloak` - Identity provider
- `node-dev` - Node.js development
- `postgres` - PostgreSQL database
- `postman-cli` - API testing
- `puppeteer-agent` - Browser automation
- `rocky-bash` - Rocky Linux shell
- `shell` - Generic shell
- `ubuntu-bash` - Ubuntu shell

---

## Skills System (AchillesAgentLib)

Ploinky integrates with AchillesAgentLib for LLM-powered skills.

### Skill Types

| File Extension | Type | Purpose |
|----------------|------|---------|
| `skill.md` | Claude | Simple Claude skill |
| `cgskill.md` | CodeGeneration | Execute JavaScript |
| `iskill.md` | Interactive | Multi-turn conversations |
| `mskill.md` | MCP | Orchestrate MCP tools |
| `oskill.md` | Orchestrator | Compose multiple skills |
| `tskill.md` | DBTable | Database operations |

### Skill Discovery

Skills are discovered in `.AchillesSkills/` directories throughout the project hierarchy.

**Important:** Per `CLAUDE.md` instructions, do not edit `.generated.mjs` files directly. Update `tskill.md` and the `.mjs` file will be regenerated.

---

## Workflow Examples

### Starting a Workspace

```bash
# Start CLI
p-cli

# Enable an agent
enable agent node-dev

# Start workspace with router
start node-dev 8088

# Access web console
webconsole node-dev myPassword
```

### Running Commands in Agent

```bash
# Interactive shell
shell node-dev

# Run CLI command
cli node-dev node --version

# Send task via client
client task node-dev --parameters '{"command": "npm list"}'
```

### Managing Variables

```bash
# Set a variable
var DATABASE_URL postgres://localhost:5432/mydb

# Expose to agent
expose DATABASE_URL $DATABASE_URL node-dev

# List variables
vars
```

---

## Authentication

### Token-Based Security

Web interfaces use 32-byte random tokens stored in `.ploinky/.secrets`:

- `WEBTTY_TOKEN` - WebTTY access
- `WEBCHAT_TOKEN` - Webchat access
- `DASHBOARD_TOKEN` - Dashboard access

### SSO Integration

Ploinky supports Keycloak SSO with:
- PKCE OAuth flow
- JWT token validation
- Session management

---

## Health Checks

Agents can define health probes in their manifest:

```json
{
  "health": {
    "liveness": {
      "script": "liveness_probe.sh",
      "interval": 2,
      "timeout": 5
    },
    "readiness": {
      "script": "readiness_probe.sh",
      "interval": 5,
      "timeout": 10
    }
  }
}
```

- **Liveness probes**: Auto-restart container on failure
- **Readiness probes**: Validate startup before routing traffic

---

## Testing

Run tests with:

```bash
# All tests
./tests/run-all.sh

# Specific test suite
./tests/cli/test_all.sh
./tests/smoke/run.sh
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `mcp-sdk` | Model Context Protocol implementation |
| `node-pty` | Interactive terminal sessions |
| `flexsearch` | Full-text search |
| `achillesAgentLib` | LLM agent library (installed via postinstall) |

---

## License

MIT License
