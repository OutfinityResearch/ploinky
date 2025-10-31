# Unified Ploinky Guide
Ploinky - AI Agent Deployment System

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

# Ploinky

Secure AI Agent Deployment & Development Platform

Deploy AI agents in isolated Linux containers. Perfect for running untrusted code safely.

## Quick Start Demos

🚀 Initialize
📦 List Repos
✅ Enable Demo
▶️ Start Agent
📊 Status

ploinky@workspace

🔒

### Isolated Containers

Each agent runs in its own container with restricted access to ensure complete isolation.

📦

### Repository System

Organize agents in repositories. Enable/disable repos as needed.

🌐

### Web Interfaces

Transform any CLI tool into a modern web interface with WebConsole, WebChat, and Dashboard.

🔧

### Easy Configuration

Simple manifest.json defines container image, dependencies, and commands.

🚀

### Development Workflow

Seamless development with hot-reload support and integrated debugging tools.

🔄

### Production Ready

Deploy the same containerized agents to production with built-in health checks.

## Introduction to Agents

In Ploinky, an "agent" is a tool that you can use and modify. It's an abstract concept and doesn't necessarily refer to a Large Language Model (LLM). Agents can be anything from a simple script to a complex application.

Agents are organized in repositories, which can contain multiple agents. You can easily add new repositories, and modify existing agents to fit your needs.

### Using Agents

You can interact with agents in two main ways:

- Individually: You can run an agent's command-line interface directly using the cli command. For example: cli my-agent --input "some data". Agents can be designed to accept various input formats, such as JSON, natural language, or any other convention.

- Integrated with Ploinky: By enabling an agent, it becomes part of the Ploinky workspace. The Ploinky server will expose the agent on a local port, which allows you to build applications that interact with your agents through a simple API on localhost. When you open the web interface, you will need to provide a token, which can be found in /.ploinky/.secrets.

## Getting Started

### Prerequisites

Ploinky uses containers to run agents in isolated environments. Therefore, you need to have a container runtime installed on your system. Ploinky supports both Docker and Podman.

#### Docker

On Debian-based Linux distributions (like Ubuntu), you can install Docker with:

```
sudo apt-get update && sudo apt-get install docker-ce docker-ce-cli containerd.io
```

For other operating systems or more detailed instructions, please refer to the official Docker documentation.

#### Podman

On Debian-based Linux distributions (like Ubuntu), you can install Podman with:

```
sudo apt-get update && sudo apt-get install podman
```

For other operating systems or more detailed instructions, please refer to the official Podman documentation.

### Installation

```
$ git clone https://github.com/ploinkyRepos/ploinky.git
$ cd ploinky
$ npm install
```

View CLI Reference
Learn Architecture

## Usage

### From within the project directory

When you are in the project directory, you can use the ploinky command directly. Here are the first steps to get you started:

- Run ploinky to initialize your workspace

- Enable the demo repository: enable repo demo

- Start demo agent: start demo

### Globally from any directory

To use ploinky from anywhere, you need to add its location to your shell's configuration file (e.g., .bashrc, .zshrc).

Add the following line to your ~/.bashrc or ~/.zshrc file, replacing ~/path/to/ploinky with the actual path to your ploinky directory:

```
export PATH="$PATH:~/path/to/ploinky/bin"
```

After adding the line, restart your shell or run source ~/.bashrc (or source ~/.zshrc). You can then use p-cli or ploinky from any directory. For example:

```
ploinky list agents
```

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Documentation •
Architecture


---

CLI Reference - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

### Quick Navigation

- Repository Management

- Agent Operations

- Workspace Commands

- Variables & Environment

- Web Interfaces

- Client Operations

- System Management

- Logging & Monitoring

# CLI Command Reference

Complete reference for all Ploinky CLI commands. Commands are organized by category for easy navigation.

Note on command prefixes: The commands in this documentation are shown without the ploinky prefix, assuming they are run from within the project's interactive shell. For global usage from your system's terminal, prepend each command with ploinky (e.g., ploinky list agents).

## Repository Management

### add repo

Add a repository to your local environment.

```
add repo  [url]
```

Parameter
Description

<name>
Repository name (basic, cloud, vibe, security, extra, demo) or custom name

[url]
Git URL for custom repositories (optional for predefined repos)

Predefined repositories:

- basic - Essential tools and shell environments

- cloud - AWS, Azure, GCP integrations

- vibe - Social media and communication tools

- security - Authentication and encryption utilities

- extra - Additional utilities and helpers

- demo - Example agents and tutorials

```
# Examples
add repo cloud                                    # Add predefined cloud repository
add repo myrepo https://github.com/user/repo.git  # Add custom repository
```

### enable repo

Enable a repository for agent listings.

```
enable repo
```

```
# Example
enable repo cloud
```

### disable repo

Disable a repository from agent listings.

```
disable repo
```

### list repos

List all available repositories and their status.

```
list repos
```

### update repo

Pull latest changes from remote for a repository.

```
update repo
```

```
# Example
update repo basic
```

## Agent Operations

### enable agent

Register an agent in workspace registry for management. Supports run location modes.

```
enable agent  [global|devel [repoName]]
```

Mode
Behavior

isolated (omitted)
Agent runs inside a new subfolder named <agentName> in the current project directory.

global
Agent runs in the current project directory.

devel <repoName>
Agent runs inside .ploinky/repos/<repoName> (repo must exist).

```
# Examples
enable agent demo                    # isolated (creates ./demo)
enable agent demo global             # run in current directory
enable agent demo devel simulator    # run inside .ploinky/repos/simulator
```

Note: Using enable agent is optional. You can enable repo then start <agent> directly; the agent will use the isolated mode and a subfolder <agentName> will be created.

### refresh agent

Stops, removes, and re-creates the agent's container. This is a destructive operation that ensures the agent starts from a clean state. This command only has an effect if the agent's container is currently running.

```
refresh agent
# Example
refresh agent demo  # stop, remove, and re-create the container for the 'demo' agent
```

### list agents

List all available agents from enabled repositories.

```
list agents
```

### disable agent

Remove an enabled agent from the workspace registry. The agent container must be destroyed first.

```
disable
```

```
# Examples
disable demo               # remove short-named agent (if unambiguous)
disable repoName/demo      # remove agent using repo-qualified name
```

Note: If the agent is configured as the static workspace agent (via start), disabling it also clears the static configuration once the agent entry is removed.

## Workspace Commands

### start

Start agents from .ploinky/agents and launch Router.

```
start [staticAgent] [port]
```

Parameter
Description

[staticAgent]
Primary agent to serve static files (required first time)

[port]
Router port (default: 8080)

```
# First time setup
start demo 8080

# Subsequent starts (uses saved configuration)
start
```

### shell

Open interactive shell session in agent container.

```
shell
```

Attaches to a persistent container with full TTY support. Exit shell by typing "exit" to return to host.

### cli

Run the agent's CLI command interactively. The manifest command is launched through the WebChat wrapper for a consistent chat-enabled TTY.

```
cli  [args...]
```

```
# Examples
cli MyAPI --help
cli PyBot --version
```

### WebTTY Agent Shortcuts

Inside the Web Console/WebTTY, you can prefix a command with an agent name to run it inside that agent’s container via its CLI.

```
# In WebTTY shell
demo whoami     # opens 'cli demo', runs 'whoami', exits; shows only the command output
demo ls /       # same: runs 'ls /' inside the demo container and prints only its output

# Notes
- Output is trimmed to the subcommand’s result (not the intermediate 'cli demo'/'exit' steps).
- Requires the agent to define a cli command in its manifest; otherwise an error is shown.
- Works in WebTTY/WebConsole sessions that use bash (default). If bash is unavailable, the fallback shell may not support this shortcut.
- Equivalent to: open cli , run the subcommand, then exit.
```

### status

Show workspace status including agents, router, and web services.

```
status
```

### list routes

List configured routes from .ploinky/routing.json.

```
list routes
```

```
# Example output
Routing configuration (.ploinky/routing.json):
- Port: 8088
- Static: agent=demo root=/path/to/demo/agent
Configured routes:
- demo: hostPort=7001 container=ploinky_project_service_demo
```

### restart

Restarts services. If an agent name is provided, it performs a non-destructive stop and start of that agent's container, preserving the container ID. This only affects running containers. If no agent name is provided, it restarts all agents and the router.

```
restart [agentName]
```

```
# Examples
restart          # Restart all agents and the router
restart MyAPI    # Stop and then start the existing container for MyAPI
```

## Variables & Environment

### var

Set a workspace variable (stored in .ploinky/.secrets).

```
var
```

Variable
Description
Default

WEBTTY_TOKEN
WebConsole authentication token
(randomly generated)

WEBCHAT_TOKEN
WebChat authentication token
(randomly generated)

WEBDASHBOARD_TOKEN
Dashboard authentication token
(randomly generated)

WEBMEET_TOKEN
WebMeet authentication token
(randomly generated)

```
# Examples
var API_KEY sk-123456789
var WEBTTY_TOKEN deadbeef
var WEBTTY_PORT 9000
```

### vars

List all workspace variables.

```
vars
```

### echo

Print the resolved value of a variable.

```
echo
```

```
# Examples
echo API_KEY      # Show raw value
echo $PROD_KEY    # Show resolved alias
```

### expose

Expose a workspace variable to an agent. If the value is omitted, the command defaults to using $<ENV_NAME>. When the agent argument is omitted, the static agent configured via start is used.

```
expose  [] [agent]
```

```
# Examples
expose DATABASE_URL $DB_URL myAgent
expose API_KEY $PROD_KEY            # Uses static agent
expose AUTO_SECRET demo             # Uses value from $AUTO_SECRET
```

## Web Interfaces

### webconsole / webtty

Prepare access for the Web Console (synonyms). Prints URL with token. Use --rotate to mint a new token.

```
webconsole [shell] [--rotate]
webtty [shell] [--rotate]
```

```
# Examples
webconsole
webconsole --rotate
webtty sh
webtty /bin/zsh
```

Access at: http://127.0.0.1:8080/webtty?token=<WEBTTY_TOKEN>

Shell options: sh, zsh, dash, ksh, csh, tcsh, fish, or absolute path. When a shell is provided, the router is restarted (if previously configured) so changes apply immediately; otherwise changes take effect on next start.

### webchat

Prepare access for the WebChat interface. The command now only manages the access token and prints the router URL.

```
webchat [--rotate]
```

```
# Examples
webchat              # ensure token and show URL
webchat --rotate     # mint a new token
```

Access at: http://127.0.0.1:8080/webchat?token=<WEBCHAT_TOKEN>

### dashboard

Prepare access for the Dashboard. Prints URL with token. Use --rotate to mint a new token.

```
dashboard [--rotate]
```

Access at: http://127.0.0.1:8080/dashboard?token=<WEBDASHBOARD_TOKEN>

### webmeet

Prepare access for WebMeet and optionally set a moderator agent. Prints URL with token.

```
webmeet [moderatorAgent] [--rotate]
```

Parameter
Description

[moderatorAgent]
Agent to use as moderator

--rotate
Generate a new token

Access at: http://localhost:8080/webmeet (proxied by the router)

## Client Operations

### client tool

Invoke any MCP tool exposed by your agents. RouterServer aggregates every registered MCP endpoint and routes the call to the agent that implements the requested tool.

```
client tool  [--agent ] [--parameters  | -p ] [-key value ...]
```

#### Arguments

Parameter
Description

<toolName>
Name of the MCP tool to execute. Must be unique across agents unless --agent is provided.

[--agent <agent>]
Optional agent to target when multiple agents expose the same tool.

[--parameters <params> | -p <params>]
Comma-separated list parsed into structured values (supports nested keys and arrays, e.g., user.name=Jane,hobbies[]=read,write).

[-key value ...]
Additional flag-style parameters appended individually. Flags without a value become booleans.

#### Examples

```
# Simple text echo
client tool echo -text "hello from cli"

# Disambiguate when multiple agents share a tool name
client tool plan --agent demo -p steps[]=research,build,ship

# Mix comma parameters with flag-style overrides
client tool process -p "config.level=high,filters[]=active" --dry-run
```

### client list tools

List every MCP tool exposed by the agents managed by the router. The output is formatted as a readable bullet list.

```
client list tools
```

Example output:
- [demo] echo - Echo back provided text
- [demo] list_things - List example items for a given category
- [simulator] echo - Echo back provided text
If one of the agents fails to respond, the command prints a Warnings section listing the affected agents.

### client list resources

List every MCP resource (e.g., health://status) exposed by registered agents.

```
client list resources
```

Example output:
- [demo] health://status - Health probe result
- [simulator] health://status - Health probe result

### client status

Ping a specific agent over MCP and report whether the session responds.

```
client status
```

Example output:
simulator: ok=true
MCP ping succeeded.

## System Management

### stop

Stop all containers and services (preserves containers).

```
stop
```

### clean / destroy / shutdown

Stops and Removes all Ploinky containers from the workspace.

```
clean
destroy
```

Warning: These commands are irreversible. All container data will be lost.

## Logging & Monitoring

### logs tail

Follow router logs in real-time.

```
logs tail [router]
```

```
# Examples
logs tail router    # Follow router logs
```

### logs last

Show last N router log lines.

```
logs last
```

```
# Examples
logs last 100           # Last 100 lines from router
```

## Help System

### help

Show general help or detailed help for specific commands.

```
help [command]
```

```
# Examples
help           # General help
help add       # Help for add command
help cli       # Help for cli command
```

## Configuration Files

### Workspace Directory Structure

```
.ploinky/
├── agents/           # Agent registry
├── repos/            # Downloaded repositories
├── routing.json      # Router configuration
├── .secrets          # Environment variables
└── running/          # PID files
├── router.pid
├── webtty.pid
├── webchat.pid
└── dashboard.pid
logs/                 # Application logs
└── router.log
```

### Agent Manifest (manifest.json)

```
{
"container": "node:18-alpine",     // Container image
"install": "npm install",          // Installation command
"update": "npm update",            // Update command
"cli": "node repl.js",            // CLI command for 'ploinky cli'
"agent": "node server.js",        // Service command
"about": "Description",           // Agent description
"env": ["API_KEY", "DB_URL"],    // Required environment variables
"enable": ["other-agent"],       // Auto-enable other agents
"repos": {                       // Auto-add repositories
"repo1": "https://..."
}
}
```

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
Architecture


---

Architecture - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

### Architecture Components

- System Overview

- Core Components

- Container Management

- Routing Server

- Workspace System

- Security Model

- Web Services

- Agent MCP Bridge

# Ploinky Architecture

Technical architecture and implementation details of the Ploinky AI agent deployment system.

## System Overview

Ploinky is built as a modular system with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                     User Interface                       │
│  (CLI Commands / Web Console / Chat / Dashboard)         │
└─────────────────────────────────────────────────────────┘
│
┌─────────────────────────────────────────────────────────┐
│                    Ploinky CLI Core                      │
│  (Command Handler / Service Manager / Config)            │
└─────────────────────────────────────────────────────────┘
│
┌───────────────────┼───────────────────┐
│                   │                   │
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Routing Server│   │  Web Services │   │Container Mgmt │
│   (HTTP API)  │   │  (WebTTY/Chat)│   │ (Docker/Podman)│
└───────────────┘   └───────────────┘   └───────────────┘
│                   │                   │
┌─────────────────────────────────────────────────────────┐
│                    Agent Containers                      │
│         (Isolated Linux containers per agent)            │
└─────────────────────────────────────────────────────────┘
```

### Key Design Principles

- Isolation First: Every agent runs in its own container

- Workspace Scoped: All configuration is local to the project directory

- Zero Global State: No system-wide installation or configuration

- Git-Friendly: Configuration stored in .ploinky folder, can be gitignored

- Runtime Agnostic: Supports Docker and Podman transparently

## Core Components

### CLI Command System (cli/commands/cli.js)

The main entry point that handles all user commands:

```
// Command routing structure
handleCommand(args) {
switch(command) {
case 'add':      // Repository management
case 'enable':   // Agent/repo activation
case 'start':    // Workspace initialization
case 'shell':    // Interactive container access
case 'webchat':  // Web interface launchers
// ... more commands
}
}
```

### Service Layer (cli/services/)

Service
Responsibility

workspace.js
Manages .ploinky directory and configuration

docker/
Container lifecycle management modules (runtime helpers, interactive commands, agent management)

repos.js
Repository management and agent discovery

agents.js
Agent registration and configuration

secretVars.js
Environment variable and secrets management

config.js
Global configuration constants

help.js
Help system and documentation

## Container Management

### Container Lifecycle

Ploinky manages containers with specific naming conventions and lifecycle hooks:

```
// Container naming convention
function getAgentContainerName(agentName, repoName) {
const proj = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
const wsid = crypto.createHash('sha256')
.update(process.cwd())
.digest('hex')
.substring(0, 6);
return `ploinky_${proj}_${wsid}_agent_${agentName}`;
}

// Service container (for API endpoints)
function getServiceContainerName(agentName) {
// Similar but with _service_ prefix
return `ploinky_${proj}_${wsid}_service_${agentName}`;
}
```

### Volume Mounts

Each container gets specific volume mounts for security:

```
{
binds: [
{ source: process.cwd(), target: process.cwd() },      // Workspace
{ source: '/Agent', target: '/Agent' },                // Agent runtime
{ source: agentPath, target: '/code' }                 // Agent code
]
}
```

### Runtime Detection

Automatically detects and uses available container runtime:

```
function getRuntime() {
try {
execSync('docker --version', { stdio: 'ignore' });
return 'docker';
} catch {
try {
execSync('podman --version', { stdio: 'ignore' });
return 'podman';
} catch {
throw new Error('No container runtime found');
}
}
}
```

## Routing Server

### Purpose

The RoutingServer (cli/server/RoutingServer.js) acts as a reverse proxy, routing API requests to appropriate agent containers:

```
// routing.json structure
{
"port": 8088,
"static": {
"agent": "demo",
"container": "ploinky_myproject_abc123_service_demo",
"hostPath": "/path/to/demo/agent"
},
"routes": {
"agent1": {
"container": "ploinky_myproject_abc123_service_agent1",
"hostPort": 7001
},
"agent2": {
"container": "ploinky_myproject_abc123_service_agent2",
"hostPort": 7002
}
}
}
```

### Request Flow

- Client sends request to http://localhost:8088/apis/agent1/method

- RoutingServer extracts agent name from path

- Looks up agent's container port in routing.json

- Proxies request to http://localhost:7001/api/method

- Returns response to client

### Static File Serving

The router serves static files from the host filesystem in two ways:

- Static agent root (existing): requests like /index.html map to static.hostPath in routing.json.

- Agent-specific static routing (new): requests like /demo/ui/index.html map to the hostPath of the demo agent from routes.demo.hostPath.

```
// Static agent root
GET /index.html            → routing.static.hostPath/index.html
GET /assets/app.js         → routing.static.hostPath/assets/app.js

// Agent-specific static routing
GET /demo/ui/index.html    → routing.routes.demo.hostPath/ui/index.html
GET /simulator/app.js      → routing.routes.simulator.hostPath/app.js
```

### Blob Storage API

The router exposes a simple blob storage API for large files with streaming upload/download.

```
// Upload (streaming)
POST /blobs/
Headers:
Content-Type: application/octet-stream
X-Mime-Type: text/plain   # optional; falls back to Content-Type
X-File-Name: report.pdf   # optional; original filename for metadata
Body: raw bytes (streamed)

Response: 201 Created
{ "id": "", "url": "/blobs//", "size": N, "mime": "text/plain", "agent": "", "filename": "report.pdf" }

// Download (streaming, supports Range)
GET /blobs//
HEAD /blobs//
- Streams bytes from /blobs/ with metadata from .../blobs/.json
- Sets Content-Type, Content-Length, Accept-Ranges, and supports partial responses (206)
```

## Workspace System

### Directory Structure

```
.ploinky/
├── agents/              # Agent registry (JSON)
├── repos/               # Cloned agent repositories
│   ├── basic/
│   │   ├── shell/
│   │   │   └── manifest.json
│   │   └── node-dev/
│   │       └── manifest.json
│   ├── demo/
│   │   ├── demo/
│   │   └── simulator/
│   └── custom-repo/
├── routing.json         # Router configuration
├── .secrets            # Environment variables
└── running/            # Process PID files
├── router.pid
├── webtty.pid
├── webchat.pid
└── dashboard.pid
logs/                   # Application logs
└── router.log
```

### Agent Registry (agents/)

JSON file storing enabled agents and their configuration:

```
{
"ploinky_project_abc123_agent_demo": {
"agentName": "demo",
"repoName": "demo",
"containerImage": "node:18-alpine",
"createdAt": "2024-01-01T00:00:00Z",
"projectPath": "/home/user/project",
"type": "agent",
"config": {
"binds": [...],
"env": [...],
"ports": [{"containerPort": 7000}]
}
}
}
```

### Configuration Management

Workspace configuration persists across sessions:

```
// Stored in agents/_config
{
"static": {
"agent": "demo",
"port": 8088
}
}
```

## Security Model

### Container Isolation

- Filesystem: Containers only access current workspace directory

- Network: Isolated network namespace per container

- Process: No access to host processes

- Resources: Can set CPU/memory limits

### Secret Management

Environment variables stored in .ploinky/.secrets with aliasing support:

```
API_KEY=sk-123456789
PROD_KEY=$API_KEY        # Alias reference
DATABASE_URL=postgres://localhost/db
```

### Web Access Control

- Password protection for web interfaces

- Session-based authentication

- WebSocket token validation

- CORS headers configuration

## Web Services Architecture

### WebTTY/Console (cli/webtty/)

Provides terminal access through web browser:

```
// Component structure
server.js       // HTTP/WebSocket server
tty.js          // PTY management
console.js      // Client-side terminal UI
clientloader.js // Dynamic UI loader
```

### WebChat (cli/webtty/chat.js)

Chat interface for CLI programs:

- Captures stdout/stdin through PTY

- WebSocket-based real-time communication

- WhatsApp-style UI with message bubbles

- Automatic reconnection handling

### Dashboard (dashboard/)

Management interface components:

```
landingPage.js      // Main dashboard UI
auth.js             // Authentication
repositories.js     // Repo management
configurations.js   // Settings management
observability.js    // Monitoring views
```

### WebSocket Protocol

```
// Message types
{ type: 'input', data: 'user command' }     // User input
{ type: 'output', data: 'program output' }  // Program output
{ type: 'resize', cols: 80, rows: 24 }      // Terminal resize
{ type: 'ping' }                             // Keep-alive
```

## Data Flow Examples

### Starting an Agent

```
1. User: enable agent demo
→ Find manifest in repos/demo/demo/manifest.json
→ Register in .ploinky/agents
→ Generate container name

2. User: start demo 8088
→ Read agents registry
→ Start container for each agent
→ Map ports (container:7000 → host:7001)
→ Update routing.json
→ Start RoutingServer on 8088

3. Container startup:
→ Pull image if needed
→ Mount volumes (workspace, code, Agent)
→ Set environment variables
→ Run agent command or supervisor
```

### API Request Routing

```
1. Client: GET http://localhost:8088/apis/simulator/monty-hall

2. RoutingServer:
→ Extract agent: "simulator"
→ Lookup in routing.json: hostPort: 7002
→ Proxy to: http://localhost:7002/api/monty-hall

3. Agent Container:
→ Process request
→ Return response

4. RoutingServer:
→ Forward response to client
```

### WebChat Session

```
1. User: webchat secret python bot.py

2. WebTTY Server:
→ Start PTY with command: python bot.py
→ Create HTTP server on port 8080
→ Serve chat.html interface

3. Browser connects:
→ WebSocket handshake
→ Authenticate with password
→ Establish bidirectional channel

4. Message flow:
→ User types in chat
→ WebSocket → Server → PTY stdin
→ Program output → PTY stdout → WebSocket → Browser
→ Display as chat bubble
```

## Agent MCP Bridge

AgentServer (Agent/server/AgentServer.mjs) expune capabilități prin Model Context Protocol (MCP) folosind transport Streamable HTTP la ruta /mcp pe portul containerului (implicit 7000).

### Router ↔ Agent Communication

- RouterServer abstraction: RouterServer talks to agents through cli/server/AgentClient.js, which wraps MCP transports.

- MCP protocol: AgentClient builds a StreamableHTTPClientTransport towards http://127.0.0.1:/mcp and exposes listTools(), callTool(), listResources(), and readResource().

- Unified routing: Requests hitting /mcp carry commands such as list_tools, list_resources, or tool. RouterServer fans these calls out to every registered MCP endpoint and aggregates the replies.

- Per-agent routes: Legacy paths like /mcps/ remain available for direct calls when needed.

- Transport independence: RouterServer stays agnostic of protocol details; AgentClient encapsulates the MCP implementation.

### Tools and Resources

Agents declare their MCP surface through a JSON file committed alongside the agent source code: .ploinky/repos/<repo>/<agent>/mcp-config.json. When the CLI boots an agent container it copies this file to /tmp/ploinky/mcp-config.json (also keeping /code/mcp-config.json for reference). The file can expose tools, resources, and prompts, and each tool is executed by spawning a shell command. AgentServer does not register anything if the configuration file is missing.

```
{
"tools": [
{
"name": "list_things",
"title": "List Things",
"description": "Enumerate items in a category",
"command": "node scripts/list-things.js",
"input": {
"type": "object",
"properties": {
"category": {
"type": "string",
"description": "fruits | animals | colors"
}
},
"required": ["category"],
"additionalProperties": false
}
}
],
"resources": [
{
"name": "health",
"uri": "health://status",
"description": "Service health state",
"mimeType": "application/json",
"command": "node scripts/health.js"
}
],
"prompts": [
{
"name": "summarize",
"description": "Short summary",
"messages": [
{ "role": "system", "content": "You are a concise analyst." },
{ "role": "user", "content": "${input}" }
]
}
]
}
```

AgentServer pipes a JSON payload to each command via stdin. Tool invocations receive { tool, input, metadata }; resources receive { resource, uri, params }. Command stdout is forwarded to the MCP response, while non-zero exit codes surface as MCP errors.

## Performance Considerations

### Container Optimization

- Reuse existing containers when possible

- Lazy image pulling

- Shared base layers between agents

- Volume mount caching

### Network Efficiency

- Local port mapping avoids network overhead

- HTTP keep-alive for persistent connections

- WebSocket for real-time communication

- Request buffering and batching

### Resource Management

- Automatic container cleanup on exit

- PID file tracking for process management

- Log rotation for long-running services

- Memory-efficient streaming for large outputs

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference


---

Agent Specification - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

### Agent Topics

- Manifest Structure

- Agent Lifecycle

- Command Types

- Environment Setup

- API Development

- Examples

- Best Practices

- Troubleshooting

# Agent Specification

Complete guide to creating, configuring, and deploying Ploinky agents.

## Manifest Structure

Every agent is defined by a manifest.json file that specifies its container, dependencies, and behavior:

### Complete Manifest Schema

```
{
// Required fields
"container": "node:18-alpine",      // Docker/Podman image

// Lifecycle commands
"install": "npm install",           // Run once when agent is first created
"update": "npm update",             // Run when agent needs updating

// Execution modes
"cli": "node repl.js",            // Interactive CLI command (cli)
"agent": "node server.js",          // Long-running service (start)

// Metadata
"about": "Express API server",      // Description shown in listings

// Environment configuration
"env": {
"LOG_LEVEL": "info",
"DATABASE_URL": null
},

// Auto-configuration (optional)
"enable": ["other-agent"],          // Auto-enable other agents
"repos": {                          // Auto-add repositories
"repo1": "https://github.com/org/repo.git"
}
}
```

### Field Descriptions

Field
Required
Description

container
Yes
Base container image from Docker Hub or other registry

install
No
One-time setup command for dependencies

update
No
Command to update agent dependencies

cli
No
Interactive command for ploinky cli (runs inside the agent container). When omitted, Ploinky now falls back to /Agent/default_cli.sh, a safe helper that exposes basic inspection commands such as whoami, pwd, ls, env, date, and uname.

agent
No
Service command for ploinky start

about
No
Human-readable description

env
No
Defines environment variables. Can be an array of required variable names or an object to specify default values. See details below.

enable
No
Agents to auto-enable when this agent is enabled. Can also specify global or devel scope. See details in the Advanced Features section.

repos
No
Repositories to auto-add when this agent is enabled

#### The env Property

The env property is a flexible way to declare an agent's required environment variables and provide defaults.

##### 1. Array of Strings (Required Variables)

To declare that an agent requires certain variables to be set in the workspace (e.g., via ploinky var ...), provide an array of names. If a variable is not set, Ploinky will throw an error on start.

```
"env": ["API_KEY", "DATABASE_URL"]
```

##### 2. Object (Default Values)

To provide default values, use an object where the key is the environment variable name.

```
"env": {
"LOG_LEVEL": "info",
"API_PORT": 8080,
"DATABASE_URL": null
}
```

- LOG_LEVEL will be set to "info" if not otherwise defined in the workspace.

- If DATABASE_URL is not defined in the workspace, it will be treated as a required variable because its default value is null.

## Agent Lifecycle

### 1. Creation

```
# Create new agent
new agent myrepo MyAgent node:20

# Creates:
.ploinky/repos/myrepo/MyAgent/
├── manifest.json
└── (agent files)
```

### 2. Installation

When an agent is first enabled, Ploinky runs the install command:

```
# manifest.json
"install": "npm install express body-parser"

# Executed in container:
docker run -v $PWD:$PWD node:18-alpine sh -c "npm install express body-parser"
```

### 3. Enablement

```
# Register agent in workspace
enable agent MyAgent

# Creates entry in .ploinky/agents
{
"ploinky_project_abc123_agent_MyAgent": {
"agentName": "MyAgent",
"containerImage": "node:18-alpine",
"createdAt": "2024-01-01T00:00:00Z",
...
}
}
```

### 4. Startup

```
# Start all enabled agents
start
```

### 5. Runtime

During runtime, agents can be in different states:

- Running: Container active, service responding

- Stopped: Container exists but not running

- Exited: Container terminated (check exit code)

- Removed: Container deleted

## Command Types

### CLI Command

Interactive command for direct user interaction:

```
# Usage
cli MyAgent
```

You can define the CLI in two equivalent ways:

```
{
"cli": "python -i"
}

{
"commands": {
"cli": "python -i"
}
}
```

The commands block lets you group related entries (for example commands.cli alongside commands.run). If neither cli nor commands.cli is present, Ploinky falls back to /Agent/default_cli.sh.

### Agent Command

Long-running service for API endpoints:

```
# manifest.json
"agent": "node server.js"

# server.js
const express = require('express');
app.get('/mcp/status', (req, res) => {
res.json({ status: 'running' });
});

app.listen(7000);
```

### Supervisor Mode

If no agent command is specified, Ploinky uses the default supervisor:

```
# /Agent/AgentServer.mjs provides:
- HTTP server on port 7000
- Health check at /mcp/status
- Process management
- Automatic restarts
```

## Environment Setup

### Container Environment

Agents run with these environment variables:

```
AGENT_NAME=MyAgent           # Agent name
AGENT_REPO=myrepo           # Repository name
WORKSPACE_PATH=/workspace   # Mounted workspace
CODE_PATH=/code             # Agent code directory
PORT=7000                   # Default service port
```

### Volume Mounts

Host Path
Container Path
Purpose

$(pwd)
$(pwd)
Workspace access

/Agent
/Agent
Supervisor runtime

.ploinky/repos/X/Y
/code
Agent code

### Exposing Variables

```
# Set variable in workspace
ploinky var DATABASE_URL postgres://localhost/mydb

# Expose to agent
ploinky expose DATABASE_URL $DATABASE_URL MyAgent

# Agent can now access:
process.env.DATABASE_URL
```

## API Development

### Basic HTTP Server

```
// server.js
const http = require('http');

if (req.url === '/mcp/status') {
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ status: 'ok' }));
} else if (req.url.startsWith('/mcp/')) {
// Handle API routes
const path = req.url.substring(5);
res.writeHead(200);
res.end(`API path: ${path}`);
} else {
res.writeHead(404);
res.end('Not found');
}
});

server.listen(7000, () => {
console.log('Agent server running on port 7000');
});
```

### Express.js API

```
// api.js
const express = require('express');
const app = express();

app.use(express.json());

app.get('/mcp/status', (req, res) => {
res.json({
status: 'healthy',
agent: process.env.AGENT_NAME,
uptime: process.uptime()
});
});

// Custom endpoints
app.post('/mcp/process', (req, res) => {
const { data } = req.body;
// Process data
res.json({
result: `Processed: ${data}`,
timestamp: new Date()
});
});

app.listen(7000);
```

### Python Flask API

```
# api.py
from flask import Flask, jsonify, request
import os

app = Flask(__name__)

@app.route('/mcp/status')
def status():
return jsonify({
'status': 'healthy',
'agent': os.environ.get('AGENT_NAME'),
'language': 'python'
})

@app.route('/mcp/process', methods=['POST'])
def process():
data = request.json
return jsonify({
'result': f"Processed: {data}",
'method': 'python'
})

if __name__ == '__main__':
app.run(host='0.0.0.0', port=7000)
```

### Accessing Your API

Once deployed, access your agent's API through the routing server:

```
# Local development
http://localhost:8088/mcps/MyAgent/status
http://localhost:8088/mcps/MyAgent/process

# From client
client status MyAgent
client task MyAgent
```

## Example Agents

### Simple Shell Agent

```
{
"container": "alpine:latest",
"install": "apk add curl jq",
"cli": "/bin/sh",
"about": "Alpine Linux shell with curl and jq"
}
```

Tip: If you omit the cli field entirely, Ploinky will attach the bundled /Agent/default_cli.sh script so you still have access to safe inspection commands via ploinky cli <agent> <command>. Launching ploinky cli <agent> with no arguments drops you into an interactive prompt; type help to see the allowed commands and exit when you are finished.

### Node.js Development Agent

```
{
"container": "node:20",
"install": "npm install -g nodemon typescript @types/node",
"update": "npm update -g",
"cli": "node",
"agent": "nodemon --watch /workspace server.js",
"about": "Node.js development environment with hot reload"
}
```

### Python AI Assistant

```
{
"container": "python:3.11",
"install": "pip install openai numpy pandas flask",
"update": "pip install --upgrade openai",
"cli": "python -i",
"agent": "python api_server.py",
"env": ["OPENAI_API_KEY"],
"about": "Python AI assistant with OpenAI integration"
}
```

### Database Client Agent

```
{
"container": "postgres:15",
"install": "echo 'PostgreSQL client ready'",
"cli": "psql -U postgres",
"env": ["POSTGRES_PASSWORD"],
"about": "PostgreSQL client for database operations"
}
```

### Multi-Agent System

```
{
"container": "node:18-alpine",
"install": "npm install",
"agent": "node orchestrator.js",
"about": "Orchestrator agent",
"enable": ["worker1", "worker2", "database"],
"repos": {
"workers": "https://github.com/myorg/worker-agents.git"
}
}
```

## Best Practices

### Container Selection

- Use Alpine-based images for smaller size

- Pin specific versions (node:18.19.0 vs node:18)

- Consider multi-stage builds for complex agents

- Minimize layers in install commands

### Security

- Never hardcode secrets in manifest.json

- Use environment variables for sensitive data

- Run processes as non-root user when possible

- Validate all input in API endpoints

### Performance

- Keep install commands minimal

- Cache dependencies in agent directory

- Use health checks for monitoring

- Implement graceful shutdown handlers

### Development

- Test locally with shell first

- Use cli for interactive debugging

- Check logs with container runtime directly

- Version control your agent code separately

## Troubleshooting

### Common Issues

Problem
Cause
Solution

Container exits immediately
No long-running process
Add agent command or use supervisor

Port 7000 not accessible
Service not binding correctly
Bind to 0.0.0.0:7000, not localhost

Install command fails
Missing dependencies in base image
Use fuller base image or add apt/apk commands

Environment variables not set
Not exposed to agent
Use expose command

API returns 404
Routing misconfiguration
Check path starts with /mcp/

### Debugging Commands

```
# Check agent status
status
```

### Health Checks

Implement health endpoints for monitoring:

```
// Health check endpoint
app.get('/mcp/status', (req, res) => {
const health = {
status: 'healthy',
checks: {
database: checkDatabase(),
memory: process.memoryUsage(),
uptime: process.uptime()
}
};

const isHealthy = Object.values(health.checks)
.every(check => check !== false);

res.status(isHealthy ? 200 : 503).json(health);
});
```

## Advanced Features

### Auto-Configuration

Agents can automatically configure their environment by specifying repositories to add and other agents to enable.

#### The enable property

The enable property is an array of strings that specifies which other agents should be automatically enabled when this agent is enabled. It supports different scopes for finding the agent:

- "agentName": Enables an agent from the same repository. This is the default behavior.

- "agentName global": Enables an agent from the global repository.

- "agentName devel repoName": Enables an agent from the specified repository (repoName) in development mode.

```
# manifest.json
{
"container": "node:18",
"agent": "node server.js",
"enable": [
"database",           // Enable 'database' from the current repo
"cache global",       // Enable 'cache' from the global repo
"logger devel utils"  // Enable 'logger' from the 'utils' repo in devel mode
],
"repos": {
"utils": "https://github.com/org/utils.git"
}
}

# When this agent is enabled:
1. Adds the 'utils' repository.
2. Enables the 'database' agent from the current agent's repository.
3. Enables the 'cache' agent from the global repository.
4. Enables the 'logger' agent from the 'utils' repository in development mode.
```

### Custom Supervisor

Override the default supervisor with custom logic:

```
// custom-supervisor.js
const { spawn } = require('child_process');
const http = require('http');

// Start main process
const main = spawn('node', ['app.js']);

// Health check server
http.createServer((req, res) => {
if (req.url === '/mcp/status') {
res.writeHead(200);
res.end(JSON.stringify({
status: main.exitCode === null ? 'running' : 'stopped',
pid: main.pid
}));
}
}).listen(7000);

// Restart on crash
main.on('exit', (code) => {
if (code !== 0) {
console.log('Restarting after crash...');
// Restart logic
}
});
```

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference


---

Services Specification - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Services

- WebTTY

- CLI Spec

- 🌙

### Service Modules

- Workspace Service

- Docker Service

- Repository Service

- Agents Service

- Secrets Service

- Routing Server

- Bootstrap Service

- Utilities

# Services Specification

Technical documentation for Ploinky's service layer implementation.

## Workspace Service

File: cli/services/workspace.js

Manages the .ploinky directory structure and workspace configuration.

### Key Functions

```
// Initialize workspace directory
function ensureWorkspace() {
const PLOINKY_DIR = path.join(process.cwd(), '.ploinky');
fs.mkdirSync(PLOINKY_DIR, { recursive: true });
fs.mkdirSync(path.join(PLOINKY_DIR, 'repos'), { recursive: true });
fs.mkdirSync(path.join(PLOINKY_DIR, 'logs'), { recursive: true });
fs.mkdirSync(path.join(PLOINKY_DIR, 'running'), { recursive: true });
}

// Load agent registry
function loadAgents() {
const agentsFile = path.join(PLOINKY_DIR, 'agents');
if (!fs.existsSync(agentsFile)) return {};
return JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
}

// Save agent registry
function saveAgents(agents) {
const agentsFile = path.join(PLOINKY_DIR, 'agents');
fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
}

// Get/set workspace configuration
function getConfig() {
const agents = loadAgents();
return agents._config || {};
}

function setConfig(config) {
const agents = loadAgents();
agents._config = config;
saveAgents(agents);
}
```

### Data Structure

```
// .ploinky/agents file structure
{
"_config": {
"static": {
"agent": "demo",
"port": 8088
}
},
"ploinky_project_abc123_agent_demo": {
"agentName": "demo",
"repoName": "demo",
"containerImage": "node:18-alpine",
"createdAt": "2024-01-01T00:00:00Z",
"projectPath": "/home/user/project",
"type": "agent",
"config": {
"binds": [...],
"env": [...],
"ports": [...]
}
}
}
```

## Docker Service

Files: cli/services/docker/common.js, cli/services/docker/interactive.js, cli/services/docker/management.js

Handles all container operations including lifecycle management, port mapping, and runtime detection.

### Container Naming

```
// Generate unique container names based on workspace
function getAgentContainerName(agentName, repoName) {
const proj = path.basename(process.cwd())
.replace(/[^a-zA-Z0-9_.-]/g, '_');
const wsid = crypto.createHash('sha256')
.update(process.cwd())
.digest('hex')
.substring(0, 6);
return `ploinky_${proj}_${wsid}_agent_${agentName}`;
}

function getServiceContainerName(agentName) {
// Similar but for service containers
return `ploinky_${proj}_${wsid}_service_${agentName}`;
}
```

### Container Operations

```
// Start agent container
function ensureAgentService(agentName, manifest, agentPath) {
const containerName = getServiceContainerName(agentName);
const hostPort = findFreePort(7000, 7100);

// Check if container exists
if (containerExists(containerName)) {
if (!isRunning(containerName)) {
startContainer(containerName);
}
} else {
createContainer({
name: containerName,
image: manifest.container,
binds: [
`${process.cwd()}:${process.cwd()}`,
`${agentPath}:/code`,
`/Agent:/Agent`
],
ports: [`${hostPort}:7000`],
command: manifest.agent || '/Agent/AgentServer.mjs'
});
}

return { containerName, hostPort };
}

// Interactive container access
function attachInteractive(containerName, workdir, command) {
const runtime = getRuntime();
const args = [
'exec', '-it',
'-w', workdir,
containerName,
...command.split(' ')
];

const child = spawn(runtime, args, {
stdio: 'inherit',
env: process.env
});

return new Promise(resolve => {
child.on('exit', resolve);
});
}
```

### Runtime Detection

```
// Detect available container runtime
function getRuntime() {
// Check for Docker
try {
execSync('docker --version', { stdio: 'ignore' });
return 'docker';
} catch {}

// Check for Podman
try {
execSync('podman --version', { stdio: 'ignore' });
return 'podman';
} catch {}

throw new Error('No container runtime (Docker/Podman) found');
}

// Port finding utility
function findFreePort(start, end) {
for (let port = start; port

## Repository Service

File: cli/services/repos.js

Manages agent repositories including predefined and custom repos.

### Predefined Repositories

```
const PREDEFINED_REPOS = {
basic: {
url: 'https://github.com/PloinkyBasic/basic.git',
description: 'Essential tools and shells'
},
cloud: {
url: 'https://github.com/PloinkyCloud/cloud.git',
description: 'Cloud provider integrations'
},
vibe: {
url: 'https://github.com/PloinkyVibe/vibe.git',
description: 'Social and communication tools'
},
security: {
url: 'https://github.com/PloinkySecurity/security.git',
description: 'Security and auth tools'
},
demo: {
url: 'https://github.com/PloinkyDemo/demo.git',
description: 'Example agents'
}
};
```

### Repository Management

```
// Add repository (clone or register)
function addRepo(repoName, repoUrl) {
const repoPath = path.join(REPOS_DIR, repoName);

if (fs.existsSync(repoPath)) {
return { status: 'exists' };
}

// Check if predefined
if (PREDEFINED_REPOS[repoName]) {
repoUrl = repoUrl || PREDEFINED_REPOS[repoName].url;
}

if (repoUrl) {
// Clone from Git
execSync(`git clone ${repoUrl} ${repoPath}`, {
stdio: 'inherit'
});
} else {
// Create empty repo
fs.mkdirSync(repoPath, { recursive: true });
}

return { status: 'added' };
}

// Enable/disable repositories
function enableRepo(repoName) {
const enabled = loadEnabledRepos();
if (!enabled.includes(repoName)) {
enabled.push(repoName);
saveEnabledRepos(enabled);
}
}

function getActiveRepos(reposDir) {
const enabled = loadEnabledRepos();
if (enabled.length > 0) return enabled;

// If none enabled, return all installed
return fs.readdirSync(reposDir)
.filter(f => fs.statSync(path.join(reposDir, f)).isDirectory());
}
```

## Agents Service

File: cli/services/agents.js

Handles agent registration and lifecycle management.

### Agent Registration

```
// Enable (register) an agent
function enableAgent(agentName) {
// Find agent in repos
const { manifestPath, repo, shortAgentName } = findAgent(agentName);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const agentPath = path.dirname(manifestPath);

// Generate container name
const containerName = getAgentContainerName(shortAgentName, repo);

// Create registry record
const record = {
agentName: shortAgentName,
repoName: repo,
containerImage: manifest.container || 'node:18-alpine',
createdAt: new Date().toISOString(),
projectPath: process.cwd(),
type: 'agent',
config: {
binds: [
{ source: process.cwd(), target: process.cwd() },
{ source: '/Agent', target: '/Agent' },
{ source: agentPath, target: '/code' }
],
env: [],
ports: [{ containerPort: 7000 }]
}
};

// Save to registry
const map = workspace.loadAgents();
map[containerName] = record;
workspace.saveAgents(map);

return { containerName, repoName: repo, shortAgentName };
}
```

## Secrets Service

File: cli/services/secretVars.js

Manages environment variables and secrets with aliasing support.

### Variable Management

```
// Parse .secrets file
function parseSecrets() {
const secretsFile = path.join(PLOINKY_DIR, '.secrets');
if (!fs.existsSync(secretsFile)) return {};

const lines = fs.readFileSync(secretsFile, 'utf8').split('\n');
const vars = {};

for (const line of lines) {
if (!line.trim() || line.startsWith('#')) continue;
const [key, ...valueParts] = line.split('=');
if (key) vars[key.trim()] = valueParts.join('=').trim();
}

return vars;
}

// Set environment variable
function setEnvVar(name, value) {
const vars = parseSecrets();
vars[name] = value;
saveSecrets(vars);
}

// Resolve variable with alias support
function resolveVarValue(varName) {
const vars = parseSecrets();
let value = vars[varName];

// Follow alias chain
const visited = new Set();
while (value && value.startsWith('$')) {
if (visited.has(value)) break; // Circular reference
visited.add(value);
const ref = value.substring(1);
value = vars[ref];
}

return value;
}
```

### Agent Environment Exposure

```
// Update agent manifest with exposed variables
function updateAgentExpose(manifestPath, exposedName, valueOrRef) {
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifest.env = manifest.env || [];
manifest.expose = manifest.expose || {};

// Add to env list if not present
if (!manifest.env.includes(exposedName)) {
manifest.env.push(exposedName);
}

// Set the mapping
manifest.expose[exposedName] = valueOrRef;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Get exposed variables for agent
function getExposedEnv(manifest) {
const result = [];
const expose = manifest.expose || {};

for (const [name, valueOrRef] of Object.entries(expose)) {
const resolved = valueOrRef.startsWith('$')
? resolveVarValue(valueOrRef.substring(1))
: valueOrRef;

if (resolved) {
result.push(`${name}=${resolved}`);
}
}

return result;
}
```

## Routing Server

File: cli/server/RoutingServer.js

HTTP reverse proxy that routes requests to agent containers.

### Server Implementation

```
const http = require('http');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');

// Load routing configuration
const configPath = path.join(process.cwd(), '.ploinky/routing.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Create proxy
const proxy = httpProxy.createProxyServer({});

// Create server
const server = http.createServer((req, res) => {
const url = req.url;

// API routing: /mcps/{agent}/{path}
if (url.startsWith('/mcps/')) {
const parts = url.substring(6).split('/');
const agentName = parts[0];
const apiPath = '/' + parts.slice(1).join('/');

const route = config.routes[agentName];
if (route && route.hostPort) {
// Proxy to agent container
req.url = '/mcp' + apiPath;
proxy.web(req, res, {
target: `http://localhost:${route.hostPort}`
});
} else {
res.writeHead(404);
res.end('Agent not found');
}
}
// Static file serving
else if (config.static && config.static.hostPath) {
const filePath = path.join(config.static.hostPath, url);

if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
const stream = fs.createReadStream(filePath);
stream.pipe(res);
} else {
// Try index.html for directories
const indexPath = path.join(filePath, 'index.html');
if (fs.existsSync(indexPath)) {
fs.createReadStream(indexPath).pipe(res);
} else {
res.writeHead(404);
res.end('Not found');
}
}
}
else {
res.writeHead(404);
res.end('Not found');
}
});

// Error handling
proxy.on('error', (err, req, res) => {
console.error('Proxy error:', err);
res.writeHead(502);
res.end('Bad Gateway');
});

// Start server
const port = config.port || process.env.PORT || 8088;
server.listen(port, () => {
console.log(`RoutingServer listening on port ${port}`);
console.log(`Static files: ${config.static?.hostPath || 'none'}`);
console.log(`API routes: ${Object.keys(config.routes).join(', ')}`);
});
```

### Routing Configuration

```
// .ploinky/routing.json
{
"port": 8088,
"static": {
"agent": "demo",
"container": "ploinky_project_abc123_service_demo",
"hostPath": "/home/user/project/.ploinky/repos/demo/demo"
},
"routes": {
"agent1": {
"container": "ploinky_project_abc123_service_agent1",
"hostPort": 7001
},
"agent2": {
"container": "ploinky_project_abc123_service_agent2",
"hostPort": 7002
}
}
}
```

## Bootstrap Service

File: cli/services/bootstrapManifest.js

Handles manifest directives for auto-configuration.

### Manifest Directives

```
// Process manifest directives
async function applyManifestDirectives(agentName) {
const { manifestPath } = findAgent(agentName);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Auto-add repositories
if (manifest.repos) {
for (const [name, url] of Object.entries(manifest.repos)) {
console.log(`Auto-adding repo: ${name}`);
addRepo(name, url);
}
}

// Auto-enable agents
if (manifest.enable && Array.isArray(manifest.enable)) {
for (const agent of manifest.enable) {
console.log(`Auto-enabling agent: ${agent}`);
try {
enableAgent(agent);
} catch (e) {
console.warn(`Could not enable ${agent}: ${e.message}`);
}
}
}

// Process environment variables
if (manifest.env && Array.isArray(manifest.env)) {
for (const varName of manifest.env) {
if (!process.env[varName]) {
console.warn(`Required env var not set: ${varName}`);
}
}
}
}
```

## Utilities

File: cli/services/utils.js

Common utility functions used across services.

### Agent Discovery

```
// Find agent in any repository
function findAgent(agentName) {
const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');

// Check if repo/agent format
if (agentName.includes('/')) {
const [repo, name] = agentName.split('/');
const manifestPath = path.join(REPOS_DIR, repo, name, 'manifest.json');
if (fs.existsSync(manifestPath)) {
return { manifestPath, repo, shortAgentName: name };
}
}

// Search all repos
const repos = fs.readdirSync(REPOS_DIR);
for (const repo of repos) {
const manifestPath = path.join(REPOS_DIR, repo, agentName, 'manifest.json');
if (fs.existsSync(manifestPath)) {
return { manifestPath, repo, shortAgentName: agentName };
}
}

throw new Error(`Agent '${agentName}' not found in any repository`);
}
```

### Console Formatting

```
// ANSI color codes
const ANSI = {
reset: '\x1b[0m',
bold: '\x1b[1m',
red: '\x1b[31m',
green: '\x1b[32m',
yellow: '\x1b[33m',
blue: '\x1b[34m',
magenta: '\x1b[35m',
cyan: '\x1b[36m'
};

// Colorize text for terminal
function colorize(text, color) {
const code = ANSI[color] || '';
return `${code}${text}${ANSI.reset}`;
}

// Debug logging
function debugLog(...args) {
if (process.env.DEBUG) {
console.log('[DEBUG]', ...args);
}
}
```

### Process Management

```
// Check if process is running
function isProcessRunning(pid) {
try {
process.kill(pid, 0);
return true;
} catch {
return false;
}
}

// Write PID file
function writePidFile(name, pid) {
const pidFile = path.join(PLOINKY_DIR, 'running', `${name}.pid`);
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
fs.writeFileSync(pidFile, String(pid));
}

// Read PID file
function readPidFile(name) {
const pidFile = path.join(PLOINKY_DIR, 'running', `${name}.pid`);
if (!fs.existsSync(pidFile)) return null;

const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
return isNaN(pid) ? null : pid;
}

// Kill process by PID file
function killByPidFile(name) {
const pid = readPidFile(name);
if (pid && isProcessRunning(pid)) {
process.kill(pid, 'SIGTERM');
return true;
}
return false;
}
```

## Service Integration

Services work together to provide the complete Ploinky functionality:

### Service Dependencies

```
// Service dependency graph
cli.js
├── workspace.js      // Configuration storage
├── docker/           // Container management (shared helpers + interactive + management)
│   └── workspace.js  // Read agent registry
├── repos.js          // Repository management
│   └── workspace.js  // Store enabled repos
├── agents.js         // Agent lifecycle
│   ├── workspace.js  // Update registry
│   ├── docker/       // Create containers
│   └── utils.js      // Find agents
├── secretVars.js     // Environment variables
│   └── workspace.js  // Store in .secrets
└── bootstrapManifest.js  // Auto-configuration
├── repos.js      // Add repositories
└── agents.js     // Enable agents
```

### Typical Flow

- Workspace Init: workspace.js creates .ploinky structure

- Repo Add: repos.js clones/registers repositories

- Agent Enable: agents.js registers in workspace

- Container Start: docker/ modules create/maintain containers

- Route Setup: RoutingServer.js configures proxying

- Service Run: Agents serve API endpoints

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference


---

WebTTY Specification - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Services

- WebTTY

- CLI Spec

- 🌙

### WebTTY Components

- Overview

- Token Security

- Server Architecture

- WebSocket Protocol

- TTY Management

- Console Interface

- Chat Interface

- Dashboard Interface

# WebTTY Specification

Technical documentation for Ploinky's web terminal, chat, and dashboard services.

## Overview

WebTTY provides web-based interfaces for interacting with CLI tools and managing Ploinky workspaces. It includes three main components:

- WebConsole: Full terminal emulator in the browser

- WebChat: Chat-style interface for CLI programs

- Dashboard: Management interface for agents and configuration

### Architecture

```
┌─────────────────────────────────────────┐
│           Browser Client                 │
│  (xterm.js / Chat UI / Dashboard UI)     │
└─────────────────────────────────────────┘
│
WebSocket (ws://)
│
┌─────────────────────────────────────────┐
│         WebTTY Server (Node.js)          │
│  (HTTP Server + WebSocket Handler)       │
└─────────────────────────────────────────┘
│
PTY Interface
│
┌─────────────────────────────────────────┐
│    Command Process (bash, python, etc)   │
└─────────────────────────────────────────┘
```

## Token-Based Security

WebTTY uses secure token-based authentication. When you start a service, it generates a unique token and provides a secure access link.

### Token Generation

```
// When starting WebTTY/WebChat/Dashboard
ploinky webchat

// Output:
[webchat] Starting chat interface...
✅ WebChat available at:
http://localhost:8080/?token=a7b3c9d2e5f8g1h4i6j8k0l2m4n6o8p0q2r4s6t8

// Token is generated from:
crypto.randomBytes(32).toString('hex')
```

### Token Storage

```
// Tokens are stored in .ploinky/.secrets
WEBCHAT_TOKEN=a7b3c9d2e5f8g1h4i6j8k0l2m4n6o8p0q2r4s6t8
WEBTTY_TOKEN=b8c4d0e3f6g9h2i5j7k9l1m3n5o7p9q1r3s5t7u9
WEBDASHBOARD_TOKEN=c9d5e1f4g7h0i3j6k8l0m2n4o6p8q0r2s4t6u8v0

// Tokens persist across sessions
// Same token = same access link
```

### Authentication Flow

```
1. User starts service → Token generated/retrieved
2. Server starts with token validation middleware
3. User accesses URL without token → Redirected to error
4. User accesses URL with valid token → Session created
5. WebSocket connection authenticated with session
6. All subsequent requests validated against session
```

### Security Features

- ✅ Cryptographically secure 256-bit tokens

- ✅ Token never displayed after initial generation

- ✅ Session-based authentication after initial token

- ✅ No passwords stored or transmitted

- ✅ Tokens unique per service type

- ✅ HTTPS recommended for production

## Server Architecture

File: cli/webtty/server.js

### Server Implementation

```
function startWebTTYServer(options) {
const {
port,
ttyFactory,
mode,        // 'console', 'chat', or 'dashboard'
title,
workdir
} = options;

// Generate or retrieve token
const token = getOrCreateToken(mode);

// Create Express app
const app = express();

// Token validation middleware
app.use((req, res, next) => {
const urlToken = req.query.token;
const sessionToken = req.session?.token;

if (urlToken === token) {
req.session.token = token;
next();
} else if (sessionToken === token) {
next();
} else {
res.status(401).send('Invalid token');
}
});

// Serve appropriate UI
app.get('/', (req, res) => {
switch(mode) {
case 'console':
res.send(getConsoleHTML());
break;
case 'chat':
res.send(getChatHTML());
break;
case 'dashboard':
res.send(getDashboardHTML());
break;
}
});

// WebSocket handling
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
// Validate WebSocket connection
if (!validateWebSocketAuth(req)) {
ws.close(1008, 'Unauthorized');
return;
}

// Create PTY for console/chat modes
if (mode !== 'dashboard') {
const pty = ttyFactory.create();
bindPtyToWebSocket(pty, ws);
}
});

server.listen(port, () => {
console.log(`✅ ${mode} available at:`);
console.log(`http://localhost:${port}/?token=${token}`);
});

return server;
}
```

### Token Management

```
function getOrCreateToken(mode) {
const tokenVar = {
'console': 'WEBTTY_TOKEN',
'chat': 'WEBCHAT_TOKEN',
'dashboard': 'WEBDASHBOARD_TOKEN'
}[mode];

// Check if token exists
let token = env.resolveVarValue(tokenVar);

if (!token || !token.trim()) {
// Generate new token
token = crypto.randomBytes(32).toString('hex');
env.setEnvVar(tokenVar, token);
}

return token;
}
```

## WebSocket Protocol

Real-time bidirectional communication between browser and server.

### Message Types

```
// Client → Server
{ type: 'input', data: 'user typed text' }
{ type: 'resize', cols: 80, rows: 24 }
{ type: 'ping' }

// Server → Client
{ type: 'output', data: 'program output' }
{ type: 'exit', code: 0 }
{ type: 'error', message: 'Error details' }
{ type: 'pong' }
```

### WebSocket Handler

```
function bindPtyToWebSocket(pty, ws) {
// PTY output → WebSocket
pty.on('data', (data) => {
ws.send(JSON.stringify({
type: 'output',
data: data
}));
});

// WebSocket → PTY input
ws.on('message', (message) => {
const msg = JSON.parse(message);

switch(msg.type) {
case 'input':
pty.write(msg.data);
break;
case 'resize':
pty.resize(msg.cols, msg.rows);
break;
case 'ping':
ws.send(JSON.stringify({ type: 'pong' }));
break;
}
});

// Cleanup on disconnect
ws.on('close', () => {
pty.kill();
});

pty.on('exit', (code) => {
ws.send(JSON.stringify({ type: 'exit', code }));
ws.close();
});
}
```

## TTY Management

File: cli/webtty/tty.js

### PTY Factory

```
function createLocalTTYFactory({ ptyLib, workdir, command }) {
return {
create: () => {
const shell = command || process.env.SHELL || '/bin/bash';

const pty = ptyLib.spawn(shell, [], {
name: 'xterm-256color',
cols: 80,
rows: 24,
cwd: workdir,
env: {
...process.env,
TERM: 'xterm-256color',
COLORTERM: 'truecolor'
}
});

return {
on: (event, handler) => pty.on(event, handler),
write: (data) => pty.write(data),
resize: (cols, rows) => pty.resize(cols, rows),
kill: () => pty.kill(),
pid: pty.pid
};
}
};
}

// Container TTY Factory
function createContainerTTYFactory({ runtime, containerName, command }) {
return {
create: () => {
const args = [
'exec', '-it',
containerName,
...command.split(' ')
];

const pty = ptyLib.spawn(runtime, args, {
name: 'xterm-256color',
cols: 80,
rows: 24
});

return wrapPty(pty);
}
};
}
```

## Console Interface

File: cli/webtty/console.js

### Terminal UI

```
// Initialize xterm.js terminal
const term = new Terminal({
cursorBlink: true,
fontSize: 14,
fontFamily: 'Cascadia Code, Monaco, monospace',
theme: {
background: '#1e1e1e',
foreground: '#d4d4d4',
cursor: '#ffffff',
selection: 'rgba(255, 255, 255, 0.3)'
}
});

// Attach to DOM
term.open(document.getElementById('terminal'));

// Fit addon for responsive sizing
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
fitAddon.fit();

// WebSocket connection
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}/ws`);

// Bind terminal to WebSocket
term.onData(data => {
ws.send(JSON.stringify({ type: 'input', data }));
});

ws.onmessage = (event) => {
const msg = JSON.parse(event.data);
if (msg.type === 'output') {
term.write(msg.data);
}
};

// Handle resize
window.addEventListener('resize', () => {
fitAddon.fit();
ws.send(JSON.stringify({
type: 'resize',
cols: term.cols,
rows: term.rows
}));
});
```

## Chat Interface

File: cli/webtty/chat.js

### Chat Implementation

```
// Message handling
function addServerMessage(text) {
const msgDiv = document.createElement('div');
msgDiv.className = 'wa-message in';

const bubble = document.createElement('div');
bubble.className = 'wa-message-bubble';

const textDiv = document.createElement('div');
textDiv.className = 'wa-message-text';
textDiv.textContent = text;

const timeSpan = document.createElement('span');
timeSpan.className = 'wa-message-time';
timeSpan.textContent = formatTime();

bubble.appendChild(textDiv);
bubble.appendChild(timeSpan);
msgDiv.appendChild(bubble);

chatList.appendChild(msgDiv);
chatList.scrollTop = chatList.scrollHeight;
}

// Send user message
function sendMessage() {
const text = inputField.value.trim();
if (!text) return;

// Add to UI
addClientMessage(text);

// Send via WebSocket
ws.send(JSON.stringify({
type: 'input',
data: text + '\n'
}));

inputField.value = '';
}

// Receive output
ws.onmessage = (event) => {
const msg = JSON.parse(event.data);
if (msg.type === 'output') {
// Accumulate output and display
outputBuffer += msg.data;

// Split by newlines for chat bubbles
const lines = outputBuffer.split('\n');
if (lines.length > 1) {
const complete = lines.slice(0, -1).join('\n');
if (complete) {
addServerMessage(complete);
}
outputBuffer = lines[lines.length - 1];
}
}
};
```

### WhatsApp-Style Features

- Message bubbles with timestamps

- Read receipts visualization

- Auto-resize input field

- Side panel for long messages

- Theme switching (light/dark)

- Connection status indicator

## Dashboard Interface

Files: dashboard/*.js

### Dashboard Components

```
// Landing Page
landingPage.js     // Main dashboard view
├── Agent status cards
├── Workspace configuration
├── Quick actions
└── System health

// Authentication
auth.js            // Token validation
├── Session management
└── Access control

// Repository Management
repositories.js    // Repo CRUD operations
├── Add/remove repos
├── Enable/disable
└── Agent listings

// Configuration
configurations.js  // Settings management
├── Environment variables
├── Port configuration
└── Service settings

// Observability
observability.js   // Monitoring views
├── Container status
├── Log viewing
├── Performance metrics
└── Health checks
```

### Dashboard API

```
// Dashboard backend endpoints
app.get('/mcp/agents', (req, res) => {
const agents = workspace.loadAgents();
res.json(agents);
});

app.get('/mcp/status/:agent', async (req, res) => {
const status = await getAgentStatus(req.params.agent);
res.json(status);
});

app.post('/mcp/agents/:agent/restart', async (req, res) => {
await restartAgent(req.params.agent);
res.json({ success: true });
});

app.get('/mcp/logs/:service', (req, res) => {
const logs = readLogs(req.params.service);
res.json({ logs });
});
```

## Client Integration

### Dynamic UI Loading

File: cli/webtty/clientloader.js

```
// Dynamically load appropriate UI based on mode
function loadInterface(mode) {
switch(mode) {
case 'console':
loadScript('/xterm.js');
loadScript('/xterm-addon-fit.js');
loadScript('/console.js');
loadCSS('/xterm.css');
break;

case 'chat':
loadScript('/chat.js');
loadCSS('/chat.css');
break;

case 'dashboard':
loadScript('/dashboard.js');
loadCSS('/dashboard.css');
break;
}
}

// Script loader with promise
function loadScript(src) {
return new Promise((resolve, reject) => {
const script = document.createElement('script');
script.src = src;
script.onload = resolve;
script.onerror = reject;
document.head.appendChild(script);
});
}
```

### Login Flow

File: cli/webtty/login.js

```
// Check token on page load
window.addEventListener('DOMContentLoaded', async () => {
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

if (!token) {
showError('Access denied. No token provided.');
return;
}

// Validate token
const response = await fetch('/validate', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ token })
});

if (response.ok) {
// Token valid, load interface
loadInterface(mode);
} else {
showError('Invalid or expired token.');
}
});
```

## Configuration

### Port Configuration

```
# Set custom ports
ploinky var WEBTTY_PORT 9001
ploinky var WEBCHAT_PORT 8080
ploinky var WEBDASHBOARD_PORT 9000

# Ports are used on next start
```

### Title Customization

```
# Set custom title
ploinky var WEBTTY_TITLE "Production Console"
ploinky var APP_NAME "MyProject"

# Reflected in UI
```

### Admin Mode

```
# Start all services together
ploinky dashboard

# Starts:
- Console on WEBTTY_PORT (9001)
- Chat on WEBCHAT_PORT (8080)
- Dashboard on WEBDASHBOARD_PORT (9000)

# Each with its own token:
Console: http://localhost:9001/?token=abc...
Chat: http://localhost:8080/?token=def...
Dashboard: http://localhost:9000/?token=ghi...
```

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference


---

WebChat - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

# WebChat - Transform CLI into a Conversation

WebChat makes any agent CLI available through a chat-style interface that users can reach from their browser.

## What WebChat Delivers

💬

### Conversational UI

Stream CLI input/output through a WhatsApp-inspired interface with bubbles, timestamps, and typing indicators.

🔐

### Token Security

Each session is gated by an access token that lives in .ploinky/.secrets. Share the URL to grant access.

🛠️

### Agent Ready

When a static workspace agent is configured, WebChat automatically connects to that agent’s manifest cli command.

## Access & Tokens

Use ploinky webchat to print the current access URL or pass --rotate to mint a fresh token when needed.

```
ploinky webchat          # ensure token and show access URL
ploinky webchat --rotate # regenerate the token
```

Access URL format: http://127.0.0.1:8080/webchat?token=<WEBCHAT_TOKEN>

The token is stored as WEBCHAT_TOKEN in .ploinky/.secrets. Removing the entry or using --rotate forces a regeneration.

## How Commands Are Chosen

WebChat derives its runtime command from the static workspace agent:

- Static agent – Configure one with ploinky start  . The router records the agent’s manifest path.

- Manifest CLI – When the agent’s manifest.json defines a cli command, WebChat runs it inside the agent container.

- No CLI? – Sessions still open, but the chat will display a notice that no command is bound.

This flow depends entirely on the static workspace agent: keep its manifest updated to control which CLI the chat session runs.

## Session Experience

### Message Rendering

- ✅ Automatic timestamps for each exchange

- ✅ Rich markdown rendering (tables, code blocks, lists)

- ✅ Long output folding with “Show more” expansion

- ✅ Side panel to inspect full message history

### Input Controls

- ✅ Auto-resizing composer with keyboard shortcuts (Enter to send, Shift+Enter for new line)

- ✅ Theme toggle with persistent preference

- ✅ Optional speech-to-text and text-to-speech integrations (see cli/server/webchat/strategies)

## Security Practices

- Rotate tokens regularly with ploinky webchat --rotate.

- Prefer sharing short-lived tokens and revoke access by rotating after a session concludes.

- Remember that tokens live in .ploinky/.secrets; secure that directory if you back it up or sync it.

## Troubleshooting

- Blank session? Verify the static agent has a cli command in its manifest.

- 401 errors? Run ploinky webchat again to confirm the token and URL.

- Need a different command? Update the agent manifest and restart the workspace so WebChat picks up the change.

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference


---

WebMeet Specification - Ploinky

- 🚀
Ploinky

Home

- CLI Reference

- Architecture

- Agent Spec

- WebChat

- WebMeet

- 🌙

### WebMeet Topics

- Overview

- Features

- Usage

- Moderation

- Technology Stack

# WebMeet Specification

Real-time audio and video conferencing within the Ploinky ecosystem.

## Overview

WebMeet is a video conferencing application built into Ploinky. It allows for real-time audio and video communication between multiple participants, creating a virtual meeting room directly in the browser. It is not just a text-based chat, but a full-fledged video meeting solution.

## Features

- Real-time Audio/Video: Utilizes WebRTC for high-quality, low-latency peer-to-peer communication.

- Multi-user Sessions: Supports multiple participants in a single meeting room.

- Participant Management: A dedicated panel lists all participants in the meeting.

- Speaking Queue: A system for participants to request to speak, helping to moderate conversations.

- Audio Controls: Participants can mute their own microphone and deafen (mute all incoming audio).

- Broadcasting: "Go Live" functionality allows users to broadcast their audio and video to the room.

## Usage

To start a WebMeet session, use the webmeet command:

```
ploinky webmeet
```

This will start the WebMeet server and provide a URL to access the meeting room. The URL will contain a token for authentication.

### Joining a Meeting

To join a meeting, simply open the provided URL in your browser. You will be prompted to enter your name and grant access to your microphone and camera.

## Moderation

WebMeet supports the concept of a moderator agent, which can have special privileges to control the meeting.

You can specify a moderator agent when starting the WebMeet server:

```
ploinky webmeet MyModeratorAgent
```

The moderator agent can be a custom agent you create to manage meetings, for example, by automatically muting participants, managing the speaking queue, or even transcribing the conversation.

## Technology Stack

- WebRTC: The core technology for real-time communication.

- Node.js: The backend server for signaling and user management.

- WebSocket: Used for signaling and communication between the clients and the server.

- HTML/CSS/JavaScript: The frontend application that runs in the browser.

© 2024 Ploinky Project. Built with security and simplicity in mind.

GitHub •
Home •
CLI Reference
