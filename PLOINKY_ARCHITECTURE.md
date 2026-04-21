# Ploinky Architecture Reference

## 1. Project Overview

**Ploinky** is a Node.js-based container orchestration platform for managing software agent environments. It provides a CLI shell, HTTP routing server, MCP (Model Context Protocol) integration, web interfaces (WebTTY, WebChat, WebMeet, Dashboard), and SSO capabilities.

- **Package name:** ploinky-cloud
- **Version:** 1.0.0
- **Module system:** ES6 modules (`"type": "module"`)
- **Node requirement:** >= 14.0.0
- **Repository:** https://github.com/PloinkyCloud/ploinky.git

---

## 2. Directory Structure

```
ploinky/
├── bin/                    # Executable entry points (ploinky, p-cli, psh)
├── cli/                    # Main CLI application
│   ├── index.js            # Interactive REPL entry point
│   ├── shell.js            # LLM-powered shell mode
│   ├── commands/           # Command implementations (12 files)
│   ├── services/           # Service layer (32+ files)
│   │   ├── docker/         # Docker container runtime
│   │   ├── bwrap/          # Bubblewrap sandbox runtime
│   │   └── seatbelt/       # macOS Seatbelt sandbox runtime
│   └── server/             # HTTP routing server
│       ├── RoutingServer.js
│       ├── Watchdog.js
│       ├── authHandlers.js
│       ├── handlers/       # Service-specific HTTP handlers
│       └── utils/          # Server utilities (12 files)
├── Agent/                  # Agent server and client libraries
│   ├── server/             # MCP server (AgentServer.mjs, TaskQueue.mjs)
│   └── client/             # MCP clients (Node.js + Browser)
├── dashboard/              # Web dashboard (HTML/CSS/JS)
├── webLibs/                # Bundled web libraries (QR code)
├── globalDeps/             # Global Node.js dependencies for agents
├── tests/                  # E2E + unit test suite
├── docs/                   # Specifications and generated docs
├── .ploinky/               # Workspace configuration
│   ├── enabled_repos.json
│   ├── .secrets
│   ├── .agents.json
│   ├── .profile
│   ├── .history
│   ├── agents/             # Per-agent workspace directories
│   ├── code/               # Symlinks to agent source code
│   ├── skills/             # Symlinks to agent skills
│   └── repos/              # Cloned repositories
└── .github/workflows/      # CI (Docker + Podman daily runs)
```

---

## 3. Entry Points

| Binary | Script | Purpose |
|--------|--------|---------|
| `ploinky` | `bin/ploinky` | Main CLI. Routes `-shell`/`--shell` to shell mode, everything else to `cli/index.js` |
| `p-cli` | `bin/p-cli` | Alias for `ploinky` |
| `ploinky-shell` | `bin/ploinky-shell` | Shell-only mode via `cli/shell.js` (LLM recommendations only) |
| `psh` | `bin/psh` | Short alias for `ploinky sh` |

The `PLOINKY_ROOT` environment variable is exported by the binary and points to the ploinky installation directory.

---

## 4. CLI Command Reference

### 4.1 Command Registry

All commands are defined in `cli/services/commandRegistry.js`:

```
COMMAND           SUBCOMMANDS
─────────────────────────────────────────────
add               repo
update            repo, repos, all
reinstall         agent
enable            repo, agent
disable           repo, agent
start             (none)
restart           (none)
stop              (none)
shutdown          (none)
clean / destroy   (none)
list              agents, repos, routes
status            (none)
shell             (none)
cli               (none)
webconsole        (none)
webtty            (none)
webchat           (none)
webmeet           (none)
dashboard         (none)
sso               enable, disable, status
var               (none)
vars              (none)
echo              (none)
expose            (none)
logs              tail, last
client            methods, status, list, task, task-status
profile           list, validate, show
settings          (none)
help              (none)
exit / quit       (none)
```

### 4.2 Command Details

#### Repository & Agent Management

| Command | Syntax | Description |
|---------|--------|-------------|
| `add repo` | `add repo <name> [url] [branch]` | Clone and register a repository |
| `update` | `update [repo <name>\|all]` | Pull latest changes for one or all repos |
| `enable repo` | `enable repo <name>` | Add repo to enabled_repos.json |
| `disable repo` | `disable repo <name>` | Remove repo from enabled_repos.json |
| `enable agent` | `enable agent <name\|repo/name> [global\|devel [repoName]] [--auth none\|pwd\|sso] [--user U --password P] [as <alias>]` | Register an agent in the workspace |
| `disable agent` | `disable agent <name>` | Unregister an agent |
| `reinstall agent` | `reinstall agent <name>` | Destroy and recreate agent container |

#### Workspace Lifecycle

| Command | Description |
|---------|-------------|
| `start [staticAgent] [port]` | Start agents, launch Router on port (default 8080) |
| `restart [agent\|router]` | Restart specific agent, router, or all |
| `stop` | Stop all configured containers (preserves state) |
| `shutdown` | Stop and remove configured containers |
| `clean` / `destroy` | Remove ALL ploinky containers in workspace |

#### Agent Interaction

| Command | Syntax | Description |
|---------|--------|-------------|
| `shell` | `shell <agentName>` | Open interactive shell in agent container |
| `cli` | `cli <agentName> [args]` | Run the agent's manifest-defined CLI command |
| `client status` | `client status` | MCP ping all agents |
| `client list` | `client list` | Aggregate and list tools from all agents |
| `client methods` | `client methods <agent>` | List tools for specific agent |
| `client task` | `client task <agent> <tool> [params]` | Call an MCP tool on an agent |
| `client task-status` | `client task-status <agent> <taskId>` | Poll async task status |

#### Web Interfaces

| Command | Syntax | Description |
|---------|--------|-------------|
| `webtty` / `webconsole` | `webtty [shell] [--rotate]` | Open terminal access in browser |
| `webchat` | `webchat [--rotate]` | Open chat interface |
| `webmeet` | `webmeet [moderator] [--rotate]` | Open video meeting interface |
| `dashboard` | `dashboard [--rotate]` | Open admin dashboard |

`--rotate` regenerates the access token.

#### Data & Configuration

| Command | Syntax | Description |
|---------|--------|-------------|
| `var` | `var <VAR> <value>` or `VAR=value` | Set a workspace variable in .secrets |
| `vars` | `vars` | List all workspace variables |
| `echo` | `echo <VAR>` | Print a variable's value |
| `expose` | `expose <NAME> [value] [agent]` | Inject env var into agent container |
| `sso enable` | `sso enable` | Enable Keycloak SSO |
| `sso disable` | `sso disable` | Disable SSO |
| `sso status` | `sso status` | Show SSO configuration |
| `profile list` | `profile list` | Show available profiles |
| `profile validate` | `profile validate` | Validate profile configuration |
| `profile show` | `profile show` | Show active profile details |
| `logs tail` | `logs tail` | Stream router logs |
| `logs last` | `logs last` | Show recent router logs |
| `status` | `status` | Show workspace state summary |
| `list agents` | `list agents` | List all known agents |
| `list repos` | `list repos` | List registered repositories |
| `list routes` | `list routes` | List routing table |

---

## 5. Manifest Schema (manifest.json)

Every agent directory must contain a `manifest.json`. Below is the complete schema.

### 5.1 Top-Level Fields

```jsonc
{
  // --- Identity & Image ---
  "container": "node:20-bullseye",     // Docker image (preferred over "image")
  "image": "node:20-bullseye",         // Alternative to "container"
  "about": "Human-readable description",
  "lite-sandbox": false,               // Use bwrap/seatbelt instead of Docker

  // --- Commands ---
  "start": "node server.js",           // Main service start command
  "agent": "node /Agent/server/AgentServer.mjs", // MCP agent server command
  "run": "...",                         // Legacy alias for "agent"
  "cli": "sh",                         // Interactive CLI command
  "update": "apt-get update && ...",    // Container update command
  "commands": {                         // Alternative command block
    "cli": "sh",
    "run": "node server.js"
  },

  // --- Readiness Detection ---
  "readiness": {
    "protocol": "tcp"                   // "tcp" (port open) or "mcp" (handshake)
  },
  // Inference rules when readiness.protocol is not set:
  //   - start only (no agent) → "tcp"
  //   - agent defined or implicit AgentServer → "mcp"

  // --- Authentication ---
  "ploinky": "pwd enable",             // Directives: "pwd enable", "sso enable"
                                        // Supports comma/newline/semicolon delimiters
  "pwd": {
    "users": [
      {
        "username": "admin",            // or "user"
        "password": "secret",
        "name": "Admin User",           // Display name (defaults to username)
        "email": "admin@example.com",   // Optional
        "roles": ["admin"]              // Auto-includes "local" role
      }
    ]
  },

  // --- Volumes ---
  "volumes": {
    "postgres/data": "/var/lib/postgresql/data",
    "test-volumes/data": "/mnt/test-data"
  },
  // Keys are workspace-relative paths. Created automatically if missing.
  // Values are container mount points.

  // --- Dependencies ---
  "enable": [
    "basic/postgres",                   // Enable agent from repo
    "basic/keycloak global",            // Enable in global mode
    "basic/node-dev devel myRepo",      // Enable in devel mode
    "basic/shell as my-shell"           // Enable with alias
  ],
  // Keycloak dependencies are conditionally enabled only if auth mode is "sso"

  // --- Profiles ---
  "profiles": {
    "default": { /* base profile - always applied first */ },
    "dev": { /* merged on top of default */ },
    "qa": { /* merged on top of default */ },
    "prod": { /* merged on top of default */ }
  }
}
```

### 5.2 Profile Fields

Each profile object can contain:

```jsonc
{
  // --- Environment Variables ---
  "env": {
    "NODE_ENV": "production",
    "DATABASE_URL": {                   // Complex variable mapping
      "varName": "HOST_DB_URL",         // Maps from host env var
      "required": false,
      "default": "postgres://localhost/db"
    }
  },
  // OR array format:
  "env": ["NODE_ENV", "DATABASE_URL=postgres://localhost/db"],

  // --- Ports ---
  "ports": [
    "127.0.0.1:__HOST_PORT__:7000",    // __HOST_PORT__ is auto-assigned
    "8180:8180",                        // Fixed host:container mapping
    "5432:5432"
  ],

  // --- Lifecycle Hooks ---
  "preinstall": "ploinky var DB_HOST=localhost", // HOST hook, runs BEFORE container creation
  "install": "npm install",                      // CONTAINER hook, runs inside container
  "postinstall": "node setup.js",                // CONTAINER hook, after install
  "hosthook_aftercreation": "./scripts/init.sh", // HOST hook, after container created
  "hosthook_postinstall": "./verify.sh",         // HOST hook, after all container hooks

  // --- Secrets ---
  "secrets": ["API_KEY", "DB_PASSWORD"],

  // --- Additional Mounts ---
  "mounts": {
    "/host/data": "/container/data"
  }
}
```

### 5.3 Profile Merging Rules

| Field | Merge Strategy |
|-------|---------------|
| `env` | Active profile overrides default by variable name |
| `ports` | Active profile completely replaces default |
| `hooks` (install, preinstall, etc.) | Active profile completely replaces default |
| `secrets` | Concatenated (active adds to default) |
| `mounts` | Deep merge (active overrides matching keys) |

Active profile is stored in `.ploinky/.profile` (defaults to `"dev"`).

### 5.4 Wildcard Environment Variables

Manifest `env` supports wildcard patterns:
- `LLM_MODEL_*` expands to all matching env vars (e.g., LLM_MODEL_GEMMA, LLM_MODEL_CLAUDE)
- `ACHILLES_*`, `OPENAI_*`, `ANTHROPIC_*` follow the same pattern
- Variables ending in `_API_KEY` are excluded from wildcard expansion
- Results are sorted and deduplicated

---

## 6. Agent System

### 6.1 Agent Server (AgentServer.mjs)

MCP server exposing tools, resources, and prompts over Streamable HTTP transport.

**Default endpoint:** `http://0.0.0.0:7000/mcp`

**Configuration loading priority:**
1. `PLOINKY_AGENT_CONFIG` env var
2. `MCP_CONFIG_FILE` env var
3. `AGENT_CONFIG_FILE` env var
4. `PLOINKY_MCP_CONFIG_PATH` env var
5. `/tmp/ploinky/mcp-config.json`
6. `${PLOINKY_CODE_DIR}/mcp-config.json` (default `/code`)
7. `./mcp-config.json` (cwd)

**mcp-config.json schema:**

```jsonc
{
  "maxParallelTasks": 10,
  "taskLogTailBytes": 131072,          // 128KB circular log buffer
  "tools": [
    {
      "name": "tool_name",
      "title": "Human Title",
      "description": "What this tool does",
      "command": "node /code/run.js",   // Spawned as child process
      "cwd": "/code",                   // Working directory (optional)
      "env": { "KEY": "val" },          // Extra env vars (optional)
      "inputSchema": {                  // Zod-validated JSON schema
        "type": "object",
        "properties": {
          "param1": { "type": "string", "description": "..." }
        },
        "required": ["param1"]
      },
      "async": true,                    // Queue-based execution
      "timeout": 300000                 // Per-tool timeout in ms
    }
  ],
  "resources": [
    {
      "name": "resource_name",
      "uri": "ploinky://resource/path", // Fixed URI
      // OR
      "template": "ploinky://files/{path}", // URI template with params
      "command": "cat /code/{path}",
      "mimeType": "text/plain"
    }
  ],
  "prompts": [
    {
      "name": "prompt_name",
      "description": "...",
      "messages": [
        { "role": "user", "content": { "type": "text", "text": "..." } }
      ]
    }
  ]
}
```

**HTTP endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ ok: true, server: 'ploinky-agent-mcp' }` |
| POST | `/mcp` | MCP JSON-RPC 2.0 requests |
| GET | `/getTaskStatus?taskId=<id>` | Async task status and log tail |

**Tool execution flow:**
- Synchronous tools: spawn child process, capture stdout, return result
- Asynchronous tools: enqueue to TaskQueue, return `taskId` immediately, poll via `/getTaskStatus`
- Payload delivered as JSON on stdin to spawned process

### 6.2 TaskQueue (TaskQueue.mjs)

In-memory task queue with disk persistence at `.tasksQueue`.

**Task states:** `pending` → `running` → `completed` | `failed`

**Features:**
- Configurable `maxConcurrent` (default 10)
- Circular log buffer per task (default 128KB) for live progress
- Sequence numbers for incremental log polling
- Interrupted tasks (pending/running at startup) marked as failed
- Disk persistence after every state change

### 6.3 Agent Clients

**Node.js client** (`AgentMcpClient.mjs`):
- Connects via Router at `http://127.0.0.1:8080/mcps/{agentName}/mcp`
- OAuth token caching with 60-second refresh buffer
- Methods: `connect()`, `listTools()`, `callTool()`, `listResources()`, `readResource()`, `ping()`, `close()`

**Browser client** (`MCPBrowserClient.js`):
- Factory: `createAgentClient(baseUrl)`
- SSE (Server-Sent Events) for async responses
- Automatic task polling every 5s (configurable via `PLOINKY_MCP_TASK_POLL_INTERVAL_MS`)
- Reconnection with exponential backoff
- Session management via `mcp-session-id` header

---

## 7. Container Runtimes

Ploinky supports three runtimes. Selection is based on manifest `lite-sandbox` flag and platform availability.

### 7.1 Docker / Podman

**Container creation command:**
```
docker run -d
  --name {containerName}
  --label ploinky.envhash={sha256}
  -w /code
  -v {agentLibPath}:/Agent:ro
  -v {agentCodePath}:/code{:ro in qa/prod}
  -v {nodeModulesDir}:/code/node_modules
  -v {nodeModulesDir}:/Agent/node_modules
  -v {sharedDir}:/shared
  -v {cwd}:{cwd}
  [-v {skillsPath}:/code/skills{:ro in qa/prod}]
  [-v {volumeHost}:{volumeContainer}]
  -p 127.0.0.1:{hostPort}:{containerPort}
  -e AGENT_NAME={name}
  -e WORKSPACE_PATH={path}
  -e PLOINKY_WORKSPACE_ROOT={root}
  -e PLOINKY_MCP_CONFIG_PATH={path}
  -e NODE_PATH=/code/node_modules
  -e PLOINKY_ROUTER_PORT={port}
  [-e {profileEnvVars}]
  {image}
  {entrypoint}
```

**Podman differences:**
- Mount suffix `:z` for SELinux context
- `--network slirp4netns:allow_host_loopback=true`
- `--replace` flag for automatic cleanup

**Entrypoint construction:**
- Agent only: `sh -lc "cd /code && {install} && {agentCmd}"`
- Start only: `sh -c "cd /code && {install} && {startCmd}"`
- Both start + agent: start runs in background `(startCmd &)`, agent in foreground
- Neither: `sh /Agent/server/AgentServer.sh` (default MCP server)

**Stopping:** SIGTERM (5s grace) → SIGKILL. Fleet cleanup in parallel chunks of 8.

**Environment hash:** SHA256 of sorted env map. Stored as container label. Change triggers forced recreation.

### 7.2 Bubblewrap (bwrap) - Linux Sandbox

**Namespace isolation:** `--unshare-pid` only (no network unshare).

**Filesystem layout:**
```
--ro-bind /usr /usr
--ro-bind /lib /lib              (if exists)
--ro-bind /lib64 /lib64          (if exists)
--symlink or --ro-bind /bin /sbin (detects symlinks to /usr)
--ro-bind /etc/{resolv.conf,hosts,passwd,group,nsswitch.conf,ld.so.cache}
--ro-bind /etc/{ssl,ca-certificates,pki,alternatives,crypto-policies}
--proc /proc
--dev /dev
--tmpfs /tmp
--clearenv
--setenv KEY value               (for each variable)
--chdir /code

--ro-bind {agentLibPath} /Agent
--{bind|ro-bind} {agentCodePath} /code
--bind {nodeModulesDir} /code/node_modules
--bind {nodeModulesDir} /Agent/node_modules
--bind {sharedDir} /shared
--bind {cwd} {cwd}
[--{bind|ro-bind} {skillsPath} /code/skills]
[--bind {customVolume} {mountPoint}]
```

**Process management:**
- Spawned detached with `child.unref()`
- PID stored in `.ploinky/bwrap-pids/{agentName}.pid`
- Stopped via process group kill: `kill(-pid, SIGTERM)`, escalate to SIGKILL after 5s
- Zombie detection via `/proc/{pid}/status`
- Health check: `curl -sf http://127.0.0.1:{port}/health`

### 7.3 Seatbelt - macOS Sandbox

**Profile generation (SBPL):**
```scheme
(version 1)
(deny default)
(allow file-read* (subpath "/usr") (subpath "/System") (subpath "/Library") ...)
(allow file-write* (subpath "/tmp") (subpath "/private/tmp"))
(allow network*)
(allow process-fork process-exec process-exec*)
(allow mach-lookup mach-register)
(allow ipc-posix* signal sysctl-read)
(allow file-read* (subpath "{agentLibPath}"))
(allow file-read* file-write* (subpath "{agentCodePath}"))
(allow file-read* file-write* (subpath "{nodeModulesDir}"))
...
```

**Process spawning:**
```
sandbox-exec -f {profilePath} sh -c "{entryCmd}"
```

**Path rewriting:** Container paths (`/code/`, `/Agent/`) are rewritten to actual host paths in entry commands and mcp-config.json (copied to `.ploinky/mcp-config.seatbelt.json`).

**Process state detection:** Uses `ps -p {pid} -o state=` (no `/proc` on macOS).

### 7.4 Runtime Comparison

| Feature | Docker | Bwrap | Seatbelt |
|---------|--------|-------|----------|
| Platform | Linux/macOS | Linux | macOS |
| Isolation | Full container | PID namespace | Profile-based |
| Network | Bridged/host | Host (shared) | Host (shared) |
| Filesystem | Union FS + bind | Bind mounts | Real paths |
| Overhead | High | Low | Low |
| Image support | Yes | No (host binaries) | No (host binaries) |
| Port mapping | Docker publish | Direct host port | Direct host port |

---

## 8. Routing Server (RoutingServer.js)

Single-process HTTP server on port 8080 (configurable via `PORT`).

### 8.1 Request Routing

| Path Pattern | Handler | Auth Required |
|-------------|---------|---------------|
| `/health` | Health check JSON | No |
| `/auth/*` | Authentication handlers | No |
| `/webtty/*` | WebTTY handler | Yes |
| `/webchat/*` | WebChat handler | Yes |
| `/dashboard/*` | Dashboard handler | Yes |
| `/webmeet/*` | WebMeet handler | Yes |
| `/status/*` | Status page handler | Yes |
| `/upload` | Workspace file upload | Yes |
| `/blobs/*` | Blob storage | Yes |
| `/mcp`, `/mcp/` | Router MCP info | Yes |
| `/mcps/{agent}/mcp/*` | Agent MCP proxy | Agent or user auth |
| `/mcps/{agent}/task*` | Agent task status proxy | Agent or user auth |
| `/services/explorer/office/*` | Explorer service proxy | No |
| `/*` | Static file serving | Varies |

### 8.2 Authentication Modes

| Mode | Cookie | Mechanism |
|------|--------|-----------|
| `sso` | `ploinky_sso` | OAuth2/OIDC via Keycloak |
| `local` | `ploinky_local` | Username/password, bcrypt hashes |
| `none` | (none) | Public access |

**SSO configuration env vars:**
- `KEYCLOAK_URL` / `SSO_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_CLIENT_SECRET`
- `KEYCLOAK_REDIRECT_URI`

**Identity propagation to agents (headers):**
- `X-Ploinky-User-Id`, `X-Ploinky-User`, `X-Ploinky-User-Email`
- `X-Ploinky-User-Roles`, `X-Ploinky-Session-Id`
- `Authorization: Bearer {token}`

**Agent-to-agent auth:**
- Client credentials grant via `/auth/agent-token`
- Requires `PLOINKY_AGENT_CLIENT_ID` and `PLOINKY_AGENT_CLIENT_SECRET`
- JWT access tokens with auto-refresh

### 8.3 MCP Aggregation

The router aggregates tools and resources from all registered agents:
- `/mcp` returns combined tool/resource listings
- Tool calls proxied to the owning agent
- Agent annotations include name and metadata
- Session-based rate limiting with 7-day auto-expiry

### 8.4 Global State

```javascript
globalState = {
  webtty:    { sessions: Map },
  webchat:   { sessions: Map },
  dashboard: { sessions: Map },
  webmeet:   { sessions: Map, participants: Map,
               chatHistory: [], nextMsgId, currentSpeaker },
  status:    { sessions: Map }
}
```

### 8.5 Health Endpoint Response

```json
{
  "status": "healthy",
  "uptime": 3600,
  "memory": { "rss": 45.2, "heapUsed": 30.1, "heapTotal": 50.0 },
  "sessions": { "webtty": 2, "webchat": 1, "dashboard": 0, "webmeet": 0 }
}
```

---

## 9. Watchdog (Watchdog.js)

Supervises the routing server process with restart logic.

### 9.1 Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_RESTARTS_IN_WINDOW` | 5 | Max restarts before circuit breaker |
| `RESTART_WINDOW_MS` | 60000 | Window for restart counting |
| `INITIAL_BACKOFF_MS` | 1000 | First restart delay |
| `MAX_BACKOFF_MS` | 30000 | Maximum restart delay |
| `BACKOFF_MULTIPLIER` | 2 | Exponential backoff factor |
| `HEALTH_CHECK_INTERVAL_MS` | 30000 | Health poll frequency |
| `HEALTH_CHECK_TIMEOUT_MS` | 5000 | Per-check timeout |
| `HEALTH_CHECK_FAILURES_THRESHOLD` | 3 | Failures before forced restart |

### 9.2 Restart Decision Tree

```
Exit code 0 (clean)         → NO restart
Exit code 2 (config error)  → NO restart
Exit code >= 100 (fatal)    → NO restart, exit with same code
SIGTERM/SIGINT (external)   → NO restart
Health check threshold hit  → ALWAYS restart
All other exits             → Restart with exponential backoff
```

### 9.3 Circuit Breaker

Trips when `MAX_RESTARTS_IN_WINDOW` restarts occur within `RESTART_WINDOW_MS`. Exits with code 100.

### 9.4 Health Check Flow

1. Every 30s: `GET http://127.0.0.1:{PORT}/health`
2. Parse JSON, verify `status === 'healthy'`
3. On failure: increment counter, log warning
4. If failures >= 3: `kill(pid, SIGTERM)`, set `pendingHealthCheckRestart`
5. On success: reset failure counter

**Logging:** JSONL format to `{LOGS_DIR}/watchdog.log`.

---

## 10. Agent Lifecycle

### 10.1 Execution Order (12 Phases)

```
 Phase  Where       Hook/Step
───────────────────────────────────────────────────
  1     HOST        Workspace structure init (.ploinky/agents/, code/, skills/)
  2     HOST        Symbolic links creation (code/<agent> → source, skills/<agent> → skills)
  3     HOST        preinstall hook (can run `ploinky var` commands)
  4     EXTERNAL    Container/sandbox creation (docker run / bwrap / sandbox-exec)
  5     HOST        hosthook_aftercreation hook
  6     EXTERNAL    Container process starts
  7     CONTAINER   Core dependencies installed (achillesAgentLib, mcp-sdk, flexsearch)
  8     CONTAINER   Agent dependencies installed (from agent's package.json)
  9     CONTAINER   install hook
 10     CONTAINER   postinstall hook
 11     HOST        hosthook_postinstall hook
 12     DETECTION   Readiness probe succeeds (TCP port open or MCP handshake)
```

### 10.2 Hook Execution Context

**Host hooks** (preinstall, hosthook_aftercreation, hosthook_postinstall):
- Auto-detect: inline command (contains `&&`, `||`, `|`) vs. file path
- Executed via `execSync` with inherited stdio
- Environment includes profile env, secrets, and ploinky variables

**Container hooks** (install, postinstall):
- Executed via `docker exec` (or equivalent)
- Working directory: `/code`
- Environment passed via `-e` flags

### 10.3 Readiness Probes

| Protocol | Detection Method | Default When |
|----------|-----------------|--------------|
| `tcp` | Port becomes reachable | Only `start` is defined |
| `mcp` | MCP handshake succeeds | `agent` is defined or implicit AgentServer |

**Timeouts:**
- Default: 120 seconds
- With dependency installation: 600 seconds (10 minutes)
- Configurable via `PLOINKY_STATIC_AGENT_READY_TIMEOUT_MS` etc.

### 10.4 Health Probes (Liveness/Readiness)

Agents can define health probe scripts that run periodically:
- Exponential backoff on failure: base 10s, max 300s
- Reset after 600s of stable uptime
- Failed liveness probes trigger container restart

---

## 11. Agent Registry (.agents.json)

```jsonc
{
  "ploinky_agentName": {
    "type": "agent",
    "agentName": "shortName",
    "repoName": "basic",
    "containerImage": "node:18-alpine",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "projectPath": "/workspace/.ploinky/agents/agentName",
    "runMode": "isolated",              // "isolated" | "global" | "devel"
    "develRepo": "repoName",           // Only for devel mode
    "alias": "optional-alias",
    "config": {
      "binds": [
        { "source": "/path/on/host", "target": "/path/in/container" }
      ],
      "env": ["KEY=value"],
      "ports": [
        { "containerPort": 7000 }
      ]
    },
    "auth": {
      "mode": "none",                  // "none" | "local" | "sso"
      "usersVar": "PLOINKY_AUTH_AGENTNAME_USERS"
    },
    "runtime": "docker"                // "docker" | "bwrap" | "seatbelt"
  },
  "_config": {
    "static": {
      "agent": "repo/agentName",
      "container": "containerName",
      "hostPath": "/path/to/agent/source",
      "port": 8080
    }
  }
}
```

### 11.1 Run Modes

| Mode | Workspace Directory | Use Case |
|------|-------------------|----------|
| `isolated` (default) | `.ploinky/agents/<agentName>` | Standard per-agent isolation |
| `global` | Workspace root `$WORKSPACE_ROOT` | Agent needs full workspace access |
| `devel` | `.ploinky/repos/<repoName>` | Development against repo source |

---

## 12. Mount System

### 12.1 Core Mounts (Always Present)

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `{ploinkyRoot}/Agent` | `/Agent` | ro | Agent server library |
| `{repoPath}/{agentDir}` | `/code` | rw (dev), ro (qa/prod) | Agent source code |
| `{agentWorkDir}/node_modules` | `/code/node_modules` | rw | NPM packages |
| `{agentWorkDir}/node_modules` | `/Agent/node_modules` | rw | Shared NPM packages |
| `{sharedDir}` | `/shared` | rw | Cross-agent shared files |
| `{agentWorkDir}` | `{agentWorkDir}` | rw | CWD passthrough for npm |

### 12.2 Optional Mounts

| Source | Target | Condition |
|--------|--------|-----------|
| `{agentDir}/skills` | `/code/skills` | If skills directory exists in source |
| Manifest `volumes` keys | Manifest `volumes` values | Workspace-relative paths auto-created |
| Profile `mounts` keys | Profile `mounts` values | Per-profile additional mounts |

### 12.3 Mount Mode by Profile

| Profile | Code Mount | Skills Mount |
|---------|-----------|-------------|
| `default`, `dev` | Read-write | Read-write |
| `qa`, `prod` | Read-only | Read-only |

---

## 13. Dependency System

### 13.1 Dependency Declaration

Dependencies are declared in manifest `enable` array:

```json
"enable": [
  "basic/postgres",              // repo/agent
  "basic/keycloak global",       // with run mode
  "basic/node-dev devel myRepo", // devel mode with repo
  "basic/shell as my-shell"      // with alias
]
```

### 13.2 Resolution Algorithm

1. Parse each entry: extract repo, agent, mode, alias
2. Build dependency graph (directed acyclic)
3. Detect cycles (error if found)
4. Sort topologically into waves
5. Start wave 0 (no dependencies) in parallel
6. Wait for readiness, then start wave 1, etc.

Keycloak dependencies are conditionally included only when agent auth mode is `"sso"`.

### 13.3 Global Dependencies

Installed from `globalDeps/package.json` into agent workspace:

| Package | Source | Purpose |
|---------|--------|---------|
| `achillesAgentLib` | GitHub: OutfinityResearch | Agent framework library |
| `mcp-sdk` | GitHub: PloinkyRepos | MCP protocol SDK |
| `flexsearch` | GitHub: PloinkyRepos (fork) | Full-text search |
| `node-pty` | npm ^1.0.0 | Terminal emulation |

---

## 14. Profile System

### 14.1 Active Profile

Stored in `.ploinky/.profile`. Valid values: `"default"`, `"dev"`, `"qa"`, `"prod"`. Defaults to `"dev"`.

### 14.2 Merge Behavior

The active profile is always merged on top of `"default"`:

```
final_config = merge(manifest.profiles.default, manifest.profiles[activeProfile])
```

See Section 5.3 for field-level merge rules.

---

## 15. Secret & Environment Variable System

### 15.1 Three-Layer Resolution

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `process.env` | Host process environment |
| 2 | `.ploinky/.secrets` | KEY=VALUE file (supports `$VAR` references) |
| 3 | `.env` | Workspace root .env file |

### 15.2 Injection into Containers

- Env flags (`-e KEY=value`) passed to Docker/bwrap
- SHA256-based caching detects config changes (triggers recreation)
- Auto-generated persistent secrets (e.g., encryption keys)
- Variables with `_API_KEY` suffix excluded from wildcard expansion

### 15.3 CLI Operations

| Command | Behavior |
|---------|----------|
| `var DB_HOST=localhost` | Write to .secrets |
| `var DB_HOST localhost` | Same (space syntax) |
| `vars` | List all variables |
| `echo DB_HOST` | Print resolved value |
| `expose DB_HOST localhost myAgent` | Inject into running agent |

---

## 16. Web Interfaces

### 16.1 WebTTY / WebConsole

Browser-based terminal access with:
- PTY process via `node-pty` (local) or Docker exec (container)
- Server-Sent Events (SSE) for output streaming
- POST endpoints for input and resize
- Global limit: 20 concurrent TTYs, 3 per session
- Reconnection debounce: 1000ms
- Configurable shell via `webtty [shell]` command

### 16.2 WebChat

Chat interface with:
- Transcript capture and storage
- Rating/feedback tracking
- Encryption of sensitive content
- Token rotation via `--rotate`

### 16.3 WebMeet

Video meeting interface with:
- Participant tracking
- Chat history (public + private)
- Speaker queue management
- Audio/text strategies (TTS)

### 16.4 Dashboard

Admin dashboard with 6 pages:

| Page | Features |
|------|----------|
| Login | API key authentication |
| Landing | Stats (agents, requests, errors, uptime), quick actions |
| Virtual Hosts | CRUD for agent deployments, start/stop |
| Repositories | Add/remove agent repos |
| Observability | Log viewer (10-5000 lines), performance charts (Chart.js) |
| Configurations | Workers, metrics retention, log level |

**Theme:** Light/dark mode toggle, CSS variables, localStorage persistence.

**API prefix:** `/management/api/`

---

## 17. Built-in Agent Manifests

The `basic` repository ships these pre-built agents:

| Agent | Image | Purpose |
|-------|-------|---------|
| alpine-bash | Alpine | Minimal shell |
| debian-bash | Debian | Debian shell |
| ubuntu-bash | Ubuntu | Ubuntu shell |
| fedora-bash | Fedora | Fedora shell |
| rocky-bash | Rocky Linux | Rocky shell |
| shell | (configurable) | Generic shell with web UI |
| node-dev | Node.js | Node.js development |
| postgres | PostgreSQL | Database server |
| keycloak | Keycloak | SSO/identity provider |
| docker-agent | docker:24-cli | Docker-in-Docker |
| clamav-scanner | ClamAV | Antivirus scanning |
| curl-agent | (with curl) | HTTP client |
| github-cli-agent | (with gh) | GitHub CLI |
| gitlab-cli-agent | (with glab) | GitLab CLI |
| postman-cli | (with Newman) | API testing |
| puppeteer-agent | (with Puppeteer) | Browser automation |

---

## 18. Testing Infrastructure

### 18.1 E2E Tests

Shell-based lifecycle testing through 7 stages:

```
PREPARE → START → STOP → START AGAIN → RESTART → DESTROY → NODE UNIT
```

**Test library:** `tests/lib.sh` (1325 lines) with assertion functions, container helpers, port allocation, and result tracking.

**Timeouts:** ACTION=240s, VERIFY=300s, START_ACTION=420s.

### 18.2 Unit Tests

10 Node.js test files using native `node:test` module:

| Test | Coverage |
|------|----------|
| healthProbes.test.js | Probe config, backoff logic |
| watchdog.test.js | Restart decisions, circuit breaker |
| taskQueue.test.mjs | Task execution, concurrency |
| profileSystem.test.mjs | Profile selection, persistence |
| startupReadiness.test.mjs | Protocol inference |
| paramParser.test.mjs | Parameter string parsing |
| coralAgentManifest.test.mjs | Wildcard env expansion |
| wildcardEnv.test.mjs | Pattern matching utilities |
| wildcardEnvIntegration.test.mjs | End-to-end env expansion |
| localAuthCredentials.test.mjs | Password hashing, sessions |

### 18.3 E2E Test Categories (33+)

Health probes, workspace status, dashboard UI, WebMeet auth, demo agent dependencies, preinstall verification, MCP client operations, router aggregation, CLI variables, WebChat tokens, SSO guest context, router static assets, watchdog restart, env filtering, global/devel modes, health probe failures, alias testing, volume mounts, manifest ports.

### 18.4 CI/CD

Two GitHub Actions workflows (daily cron):
- **tests-docker.yml** — 03:00 UTC on ubuntu-24.04
- **tests-podman.yml** — 03:30 UTC on ubuntu-24.04 (installs podman)

Both: checkout → Node.js 22 → npm install → run test suite → upload logs → commit report.

---

## 19. Configuration Files Summary

| File | Purpose |
|------|---------|
| `.ploinky/enabled_repos.json` | List of enabled repository names |
| `.ploinky/.agents.json` | Agent registry with container config |
| `.ploinky/.secrets` | KEY=VALUE secret storage |
| `.ploinky/.profile` | Active profile name |
| `.ploinky/.history` | CLI command history (up to 1000) |
| `.ploinky/routing.json` | Agent-to-port routing table |
| `.ploinky/bwrap-pids/` | PID files for bwrap processes |
| `.ploinky/repos/` | Cloned agent repositories |
| `.ploinky/agents/` | Per-agent workspace directories |
| `.ploinky/code/` | Symlinks to agent source code |
| `.ploinky/skills/` | Symlinks to agent skills directories |

---

## 20. Environment Variables Reference

### 20.1 Ploinky System Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLOINKY_ROOT` | (set by bin script) | Ploinky installation directory |
| `PLOINKY_WORKSPACE_ROOT` | (cwd) | Workspace root directory |
| `PLOINKY_ROUTER_URL` | `http://127.0.0.1:8080` | Router base URL |
| `PLOINKY_ROUTER_PORT` | `8080` | Router port |
| `PLOINKY_NO_TTY` | (unset) | Disable TTY allocation |
| `PLOINKY_MCP_CONFIG_PATH` | (auto) | Path to mcp-config.json |
| `PLOINKY_MCP_TASK_POLL_INTERVAL_MS` | `5000` | Task polling interval |
| `PLOINKY_AGENT_CLIENT_ID` | (auto) | Agent OAuth client ID |
| `PLOINKY_AGENT_CLIENT_SECRET` | (auto) | Agent OAuth client secret |
| `PLOINKY_AGENT_CONFIG` | (unset) | Override agent config path |
| `PLOINKY_CODE_DIR` | `/code` | Agent code directory in container |
| `PLOINKY_AGENT_LIB_DIR` | `/Agent` | Agent library directory |
| `PLOINKY_BRANCH` | (unset) | Override ploinky branch for tests |
| `PLOINKY_WATCHDOG_TEST_MODE` | (unset) | Enable watchdog test buffer |
| `CONTAINER_RUNTIME` | (auto-detected) | Force `docker` or `podman` |

### 20.2 Agent Container Variables (Injected)

| Variable | Description |
|----------|-------------|
| `AGENT_NAME` | Agent short name |
| `WORKSPACE_PATH` | Agent workspace directory |
| `PLOINKY_WORKSPACE_ROOT` | Parent workspace root |
| `PLOINKY_MCP_CONFIG_PATH` | MCP config file path |
| `NODE_PATH` | `/code/node_modules` |
| `PLOINKY_ROUTER_PORT` | Router port number |
| `PORT` | Agent listening port |

### 20.3 Readiness Timeout Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLOINKY_STATIC_AGENT_READY_TIMEOUT_MS` | `120000` | Static agent timeout |
| `PLOINKY_DEPENDENCY_AGENT_READY_TIMEOUT_MS` | `600000` | Dependency agent timeout |
| `PLOINKY_STATIC_AGENT_READY_INTERVAL_MS` | (varies) | Probe interval |
| `PLOINKY_STATIC_AGENT_READY_PROBE_TIMEOUT_MS` | (varies) | Per-probe timeout |
