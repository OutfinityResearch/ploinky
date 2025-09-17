# Ploinky Platform Documentation

## 1. Vision

Ploinky is a lightweight, technology-agnostic runtime platform for AI agents and containerized microservices. It enables developers to build, deploy, and orchestrate multi-agent systems where each agent runs in isolated containers, communicating through standard I/O streams. The platform bridges the gap between command-line tools and web-based interfaces, providing unified access through terminals, chat interfaces, and collaborative web applications.

The core philosophy is simplicity and universality: any program that reads from stdin and writes to stdout can become a Ploinky agent, regardless of the programming language or technology stack used.

## 2. Core Functionalities (User Stories)

### 2.1 Repository Management
- As a developer, I want to add and manage agent repositories
- As a developer, I want to enable/disable repositories for my workspace
- As a developer, I want to update repositories to get latest agents

### 2.2 Agent Management
- As a developer, I want to enable agents from repositories
- As a developer, I want to start/stop/restart agent containers
- As a developer, I want to view agent status and logs
- As a developer, I want to run agent CLI commands interactively
- As a developer, I want to access agent shell environments

### 2.3 Web Interfaces
- As a user, I want to access agents through web-based TTY terminals
- As a user, I want to interact with agents through chat interfaces
- As a user, I want to monitor system status through dashboards
- As a user, I want to participate in collaborative web meetings with agents

### 2.4 Workspace Management
- As a developer, I want to manage workspace configuration
- As a developer, I want to set and manage environment variables
- As a developer, I want to expose variables to specific agents
- As a developer, I want to persist workspace state across sessions

### 2.5 Development & Deployment
- As a developer, I want to create custom agents with manifests
- As a developer, I want to configure agent containers and dependencies
- As a developer, I want to deploy multi-agent applications
- As a developer, I want to integrate with Docker/Podman runtimes

### 2.6 Client Operations
- As a developer, I want to send tasks to agents programmatically
- As a developer, I want to query agent methods and capabilities
- As a developer, I want to check agent status remotely

## 3. How-To Guide (User Workflows)

### 3.1 Repository Management

#### Adding a Repository
```bash
p-cli
> add repo <name> [url]
```
- Predefined repos: `basic`, `cloud`, `vibe`, `security`, `extra`, `demo`
- Custom repos: provide git URL
- Repository stored in `.ploinky/repos/<name>`

#### Enabling a Repository
```bash
> enable repo <name>
```
- Makes agents from this repository available for use
- Stored in `.ploinky/enabled_repos.json`

#### Updating a Repository
```bash
> update repo <name>
```
- Pulls latest changes from remote repository
- Updates agent definitions and manifests

### 3.2 Agent Management

#### Enabling an Agent
```bash
> enable agent <agent-name>
# or
> enable agent <repo>/<agent-name>
```
- Registers agent in workspace (`.ploinky/agents`)
- Creates minimal manifest if missing
- Agent becomes available for `start` command

#### Starting Agents and Router
```bash
# First time - requires static agent and port
> start <static-agent> <port>

# Subsequent runs
> start
```
- Starts all enabled agents in containers
- Launches Router on specified port
- Static agent serves web files
- Router proxies API calls to containers

#### Accessing Agent Shell
```bash
> shell <agent-name>
```
- Opens interactive `/bin/sh` in agent container
- Direct container access for debugging

#### Running Agent CLI
```bash
> cli <agent-name> [args...]
```
- Runs agent's CLI command (from manifest)
- Interactive TTY session
- Example: `cli alpine-bash` opens bash shell

### 3.3 Web Interfaces

#### Web Console (TTY + Chat)
```bash
> console <agent-name> <password> [port]
# or
> webconsole
> webtty
> webchat
```
- Generates access tokens for web interfaces
- TTY: Terminal interface in browser
- Chat: User-friendly chat interface
- Both mirror same I/O stream

#### Dashboard
```bash
> dashboard
```
- Generates dashboard access token
- Web-based system monitoring
- Agent status and management

#### Web Meeting
```bash
> webmeet [moderator-agent]
```
- Collaborative meeting interface
- Optional moderator agent for coordination
- Real-time agent interaction

### 3.4 Variable Management

#### Setting Variables
```bash
> set VAR_NAME value
> set VAR_NAME $OTHER_VAR  # Alias
```
- Store configuration values
- Support for variable aliasing
- Stored in `.ploinky/vars.env`

#### Exposing to Agents
```bash
> expose ENV_NAME value [agent]
> expose ENV_NAME $VAR [agent]
```
- Make variables available to agent containers
- Agent-specific or global exposure
- Applied at container start

#### Viewing Variables
```bash
> set  # List all variable names
> echo $VAR_NAME  # Print resolved value
```

### 3.5 Creating Custom Agents

#### Manifest Structure
Create `manifest.json` in agent directory:
```json
{
  "container": "node:20-alpine",
  "install": "npm install dependencies",
  "update": "npm update",
  "run": "node app.js",
  "cli": "node cli.js",
  "agent": "node agent.js",
  "about": "Agent description",
  "enable": ["other-agent1", "other-agent2"]
}
```

#### Agent Types
- **Simple CLI**: Any command reading stdin/stdout
- **Interactive**: Shells, REPLs (bash, python, node)
- **Service**: Long-running processes with API
- **AI Agents**: Claude, GPT, Gemini integrations

### 3.6 Container Configuration

#### Container Bindings
Automatic mounts:
- Workspace directory: Read-write at same path
- Agent tools: Read-only at `/Agent`
- Agent code: At `/code`

#### Networking
- Agents expose port 7000 by default
- Router proxies requests to containers
- Inter-agent communication via Router

### 3.7 Client Operations

#### Sending Tasks
```bash
> client task <agent>
# Interactive mode - enter command and params
```
- Programmatic agent interaction
- JSON-RPC style communication
- Via RoutingServer proxy

#### Querying Methods
```bash
> client methods <agent>
```
- List available agent methods
- If agent supports introspection

#### Checking Status
```bash
> client status <agent>
> status  # All agents
```
- Health checks
- Container status
- Resource usage

### 3.8 Workspace Lifecycle

#### Starting Workspace
```bash
> start <static-agent> <port>  # First time
> start  # Subsequent
```

#### Stopping Containers
```bash
> stop  # Stop but preserve
> shutdown  # Stop and remove
> destroy  # Remove all Ploinky containers
```

#### Viewing Logs
```bash
> logs tail router
> logs tail webtty
> logs last 100 [service]
```

### 3.9 Development Workflow

#### Typical Session
```bash
# 1. Start CLI
p-cli

# 2. Add and enable repository
> add repo vibe
> enable repo vibe

# 3. Enable agents
> enable agent claude-code
> enable agent database-tools

# 4. Set API keys
> set ANTHROPIC_API_KEY sk-ant-...
> expose ANTHROPIC_API_KEY $ANTHROPIC_API_KEY claude-code

# 5. Start workspace
> start claude-code 8080

# 6. Access agents
> cli claude-code
> webchat
# Browser: http://localhost:8080/webchat

# 7. Develop and test
> shell claude-code
> logs tail router

# 8. Clean up
> shutdown
```

### 3.10 Multi-Agent Applications

#### Orchestration Pattern
```javascript
// In static agent's web app
fetch('/apis/claude-code/complete', {
  method: 'POST',
  body: JSON.stringify({ prompt: "..." })
});

fetch('/apis/database-tools/query', {
  method: 'POST',
  body: JSON.stringify({ sql: "..." })
});
```

#### Agent Communication
- Router handles `/apis/<agent>/*` routing
- Agents expose HTTP endpoints on port 7000
- Standard request/response pattern
- Supports streaming responses

### 3.11 Cloud Deployment (Preview)

#### Cloud Commands
```bash
> cloud register
> cloud login
> cloud deploy <app-name>
> cloud status
```
- Multi-tenant hosting
- App isolation
- Automatic scaling
- Currently in development

## 4. Architecture Notes

### Container Management
- Supports Docker and Podman
- Automatic runtime detection
- Container naming: `ploinky_<repo>_<agent>_<project>_<hash>`
- Session vs persistent containers

### Agent Supervision
- AgentServer.sh supervises processes
- Automatic restart on failure
- Command injection via CHILD_CMD
- Base64 payload encoding

### Security Model
- Container isolation
- Token-based authentication for web interfaces
- Environment variable isolation
- Read-only agent tools mount

### File Structure
```
.ploinky/
├── agents           # Enabled agents registry
├── config.json      # Workspace configuration
├── vars.env         # Environment variables
├── repos/           # Agent repositories
│   ├── basic/
│   ├── vibe/
│   └── custom/
└── enabled_repos.json
```

## 5. Common Patterns

### API Agent Pattern
```json
{
  "container": "node:20",
  "agent": "node server.js",
  "about": "REST API service"
}
```

### CLI Tool Pattern
```json
{
  "container": "alpine",
  "cli": "sh",
  "about": "Interactive shell"
}
```

### AI Assistant Pattern
```json
{
  "container": "python:3.11",
  "install": "pip install openai",
  "agent": "python assistant.py",
  "about": "AI assistant"
}
```

### Development Tool Pattern
```json
{
  "container": "node:20",
  "install": "npm install -g vite",
  "cli": "vite",
  "about": "Vite dev server"
}
```