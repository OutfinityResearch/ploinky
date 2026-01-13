# DS01 - Vision and Goals

## Summary

Ploinky is a lightweight, technology-agnostic multi-agent runtime platform that orchestrates containerized services. It enables developers to build, deploy, and orchestrate multi-agent systems where each agent runs in isolated containers, communicating through standard I/O streams. The platform bridges the gap between command-line tools and web-based interfaces, providing unified access through terminals, chat interfaces, and collaborative web applications.

The core philosophy is simplicity and universality: **any program that reads from stdin and writes to stdout can become a Ploinky agent**, regardless of the programming language or technology stack used.

## Background / Problem Statement

Modern development requires managing multiple containerized services, AI agents, and development tools. Existing solutions often:

- Require complex orchestration configurations (Kubernetes, Docker Compose)
- Lock developers into specific technology stacks or frameworks
- Lack integrated web interfaces for terminal and chat access
- Don't provide unified agent communication patterns
- Have steep learning curves for simple multi-service setups

Ploinky addresses these gaps by providing a simple, manifest-driven approach to container orchestration with built-in web interfaces and agent communication.

## Goals

1. **Technology Agnosticism**: Support any programming language or runtime through container isolation
2. **Simplicity**: Enable agent creation with minimal JSON manifest configuration
3. **Universal Interface**: Standard I/O (stdin/stdout) as the universal communication layer
4. **Integrated Web Access**: Built-in WebTTY, WebChat, WebMeet, and Dashboard interfaces
5. **Multi-Agent Orchestration**: Support concurrent agents with unified routing
6. **Local-First Development**: Focus on local workspaces with CLI and web interfaces
7. **Container Isolation**: Each agent runs in its own Docker/Podman container
8. **Reproducible Environments**: Manifest-defined, shareable agent configurations

## Non-Goals

- **Production-grade orchestration**: Not intended to replace Kubernetes for large-scale deployments
- **Cloud-native architecture**: Focus is on local development, not cloud infrastructure
- **Custom protocol implementation**: Uses standard HTTP/MCP, not proprietary protocols
- **GUI-first design**: CLI is the primary interface; web UIs are supplementary

## Architecture Overview

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

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Ploinky CLI** | Primary user interface; command parsing; agent management; container lifecycle |
| **Router Server** | HTTP routing (port 8088); request proxying to agents; authentication enforcement |
| **Agent Manager** | Configuration persistence; manifest registry; workspace state |
| **AchillesLib** | LLM-powered skills; skill discovery and execution |
| **Docker/Podman** | Container runtime; image management; networking; isolation |
| **AgentServer** | Per-container MCP server; tool/resource exposure; task queue |

## Data Models

### Agent Concept

```javascript
/**
 * @typedef {Object} Agent
 * @property {string} agentName - Unique identifier for the agent
 * @property {string} repoName - Repository containing the agent definition
 * @property {string} containerImage - Docker image URI (e.g., "node:20-bullseye")
 * @property {string} projectPath - Absolute path to project directory
 * @property {string} runMode - "isolated" | "global" | "devel"
 * @property {string} type - "agent" | "service" | "tool"
 * @property {Date} createdAt - Agent creation timestamp
 * @property {Object} config - Container configuration (binds, env, ports)
 */
```

### Manifest Schema

```javascript
/**
 * @typedef {Object} Manifest
 * @property {string} container - Docker image URI (required)
 * @property {string} [image] - Alternative to container
 * @property {string} [about] - Human-readable description
 * @property {string} [install] - Installation command(s)
 * @property {string|string[]} [preinstall] - Pre-container creation commands
 * @property {string|string[]} [postinstall] - Post-container start commands
 * @property {string} [update] - Update command
 * @property {string} [start] - Sidecar command
 * @property {string} [agent] - Agent command to execute
 * @property {string} [cli] - CLI command entry point
 * @property {string} [run] - Default command
 * @property {Array|Object} [env] - Environment variables
 * @property {Array|string} [ports] - Port mappings
 * @property {Object} [volumes] - Volume mappings
 * @property {Object} [expose] - Exposed environment variables
 * @property {string[]} [enable] - Agent dependencies
 * @property {Object} [repos] - Repository definitions
 * @property {Object} [health] - Health probe configuration
 */
```

## API Contracts

### CLI Command Interface

All CLI commands follow a consistent pattern:
```
<command> [subcommand] [arguments...] [options]
```

### Router HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/mcps/<agent>/mcp` | MCP protocol endpoint |
| GET | `/webtty/<agent>` | WebTTY terminal interface |
| GET | `/webchat/<agent>` | WebChat interface |
| GET | `/webmeet` | WebMeet collaborative interface |
| GET | `/dashboard` | System dashboard |
| GET | `/status` | System status JSON |

### Agent Communication

Agents communicate via Model Context Protocol (MCP):
```
Client → Router (8088) → /mcps/<agent>/mcp → Agent Container (7000) → AgentServer.mjs
```

## Behavioral Specification

### Agent Lifecycle State Machine

```
                    ┌──────────┐
                    │ DISABLED │
                    └────┬─────┘
                         │ enable agent
                         ▼
                    ┌──────────┐
                    │ ENABLED  │
                    └────┬─────┘
                         │ start
                         ▼
    ┌───────────────┬──────────┬───────────────┐
    │               │ STARTING │               │
    │               └────┬─────┘               │
    │                    │ container ready     │
    │                    ▼                     │
    │               ┌──────────┐               │
    │ restart ◄─────│ RUNNING  │─────► stop    │
    │               └────┬─────┘               │
    │                    │                     │
    │                    ▼                     │
    │               ┌──────────┐               │
    │               │ STOPPED  │               │
    │               └────┬─────┘               │
    │                    │ shutdown/destroy    │
    │                    ▼                     │
    │               ┌──────────┐               │
    └───────────────│ REMOVED  │───────────────┘
                    └──────────┘
```

### Workspace Initialization Sequence

1. User runs `ploinky` or `p-cli` command
2. CLI loads configuration from `.ploinky/` directory
3. Enabled agents are loaded from `.ploinky/agents` registry
4. User enables agents via `enable agent <name>`
5. User starts workspace via `start <agent> <port>`
6. Router server starts on specified port
7. Agent containers are created/started
8. AgentServer starts inside each container on port 7000
9. Router begins proxying requests to agents

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLOINKY_DEBUG` | Enable debug logging | `false` |
| `PLOINKY_ROOT` | Ploinky installation directory | Auto-detected |
| `CONTAINER_RUNTIME` | `docker` or `podman` | Auto-detected |

### Directory Structure

```
$CWD/.ploinky/
├── agents                    # JSON registry of enabled agents
├── enabled_repos.json        # List of active repositories
├── .secrets                  # Key-value secrets file
├── routing.json              # Router configuration (generated)
├── repos/                    # Cloned agent repositories
│   └── <repo>/
│       └── <agent>/
│           └── manifest.json
└── running/
    └── router.pid            # Router process ID
```

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| Agent not found | "Agent '<name>' not found in enabled repositories" |
| Container start failure | Log error, attempt restart based on health probes |
| Port conflict | "Port <port> already in use" |
| Missing manifest | Create minimal manifest with defaults |
| Invalid manifest JSON | "Failed to parse manifest.json: <error>" |

## Security Considerations

- **Container Isolation**: Each agent runs in separate container with limited host access
- **Token-Based Auth**: Web interfaces protected by 32-byte random tokens
- **Read-Only Mounts**: Agent tools mounted read-only at `/Agent`
- **Environment Isolation**: Variables only exposed to specified agents
- **SSO Support**: Optional Keycloak integration with PKCE OAuth flow

## Performance Requirements

- **Startup Time**: Workspace should start within 30 seconds (excluding image pulls)
- **Router Latency**: Request proxying should add < 10ms latency
- **Concurrent Agents**: Support at least 10 concurrent agent containers
- **Memory**: CLI should use < 100MB memory; Router < 200MB

## Success Criteria

1. Developer can create and start a custom agent in < 5 minutes
2. Multi-agent application deployable with single `start` command
3. Web interfaces accessible within 5 seconds of workspace start
4. Agent communication works across all supported container runtimes
5. Configuration shareable via manifest.json files

## References

- [DS02 - Architecture](./DS02-architecture.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS04 - Manifest Schema](./DS04-manifest-schema.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
