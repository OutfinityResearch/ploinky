# DS05 - CLI Commands

## Summary

The Ploinky CLI is the primary user interface for managing agents, workspaces, and web interfaces. This specification documents all available commands, their syntax, arguments, options, and expected behavior.

## Background / Problem Statement

Users need a comprehensive, consistent command-line interface that:
- Provides intuitive command structure
- Offers comprehensive help documentation
- Handles errors gracefully with actionable messages
- Supports both interactive and scripted use

## Goals

1. **Complete Command Coverage**: Document all CLI commands
2. **Consistent Syntax**: Uniform command structure across all commands
3. **Clear Help System**: Built-in help for all commands
4. **Error Handling**: Actionable error messages

## Non-Goals

- GUI interface
- Tab completion (shell-dependent)
- Command aliases (user configurable)

## Architecture Overview

### Command Structure

```
ploinky [command] [subcommand] [arguments...] [options]
```

### Command Categories

| Category | Commands |
|----------|----------|
| Repository Management | `add repo`, `enable repo`, `disable repo`, `list repos`, `update repo` |
| Agent Operations | `enable agent`, `disable agent`, `refresh agent`, `list agents` |
| Workspace Control | `start`, `stop`, `restart`, `shutdown`, `destroy`, `clean`, `status` |
| Interactive Access | `shell`, `cli`, `run` |
| Web Interfaces | `webtty`, `webchat`, `webconsole`, `webmeet`, `dashboard` |
| Client Operations | `client methods`, `client status`, `client task`, `client list` |
| Variable Management | `var`, `vars`, `echo`, `expose` |
| Profile Management | `profile`, `profile list`, `profile validate` |
| Logging | `logs tail`, `logs last` |
| System | `help`, `settings`, `version` |

## API Contracts

### Command Dispatch

```javascript
// cli/commands/cli.js

/**
 * Main command dispatcher
 * @param {string[]} args - Command arguments
 * @param {Object} context - CLI context (readline, config, etc.)
 * @returns {Promise<void>}
 */
export async function dispatchCommand(args, context) {
  const [command, ...subArgs] = args;

  // Command routing
  const handlers = {
    // Repository commands
    'add': () => handleAdd(subArgs, context),
    'enable': () => handleEnable(subArgs, context),
    'disable': () => handleDisable(subArgs, context),
    'list': () => handleList(subArgs, context),
    'update': () => handleUpdate(subArgs, context),

    // Workspace commands
    'start': () => handleStart(subArgs, context),
    'stop': () => handleStop(context),
    'restart': () => handleRestart(subArgs, context),
    'shutdown': () => handleShutdown(context),
    'destroy': () => handleDestroy(context),
    'clean': () => handleClean(context),
    'status': () => handleStatus(context),

    // Interactive commands
    'shell': () => handleShell(subArgs, context),
    'cli': () => handleCli(subArgs, context),
    'run': () => handleRun(subArgs, context),

    // Web interfaces
    'webtty': () => handleWebtty(subArgs, context),
    'webchat': () => handleWebchat(subArgs, context),
    'webconsole': () => handleWebconsole(subArgs, context),
    'webmeet': () => handleWebmeet(subArgs, context),
    'dashboard': () => handleDashboard(context),

    // Client operations
    'client': () => handleClient(subArgs, context),

    // Variables
    'var': () => handleVar(subArgs, context),
    'vars': () => handleVars(context),
    'echo': () => handleEcho(subArgs, context),
    'expose': () => handleExpose(subArgs, context),

    // Profile
    'profile': () => handleProfile(subArgs, context),

    // Logs
    'logs': () => handleLogs(subArgs, context),

    // System
    'help': () => handleHelp(subArgs, context),
    'settings': () => handleSettings(context),
    'version': () => handleVersion(context),
    'exit': () => handleExit(context),
    'quit': () => handleExit(context)
  };

  const handler = handlers[command];
  if (handler) {
    await handler();
  } else {
    console.log(`Unknown command: ${command}. Type 'help' for available commands.`);
  }
}
```

## Behavioral Specification

### Repository Commands

#### `add repo <name> [url]`

Add a new repository to the workspace.

```javascript
/**
 * Add repository
 * @param {string} name - Repository name or predefined repo identifier
 * @param {string} [url] - Git URL (required for custom repos)
 */
async function handleAddRepo(name, url) {
  // Predefined repositories
  const predefined = {
    'basic': 'https://github.com/PloinkyRepos/basic.git',
    'cloud': 'https://github.com/PloinkyRepos/cloud.git',
    'vibe': 'https://github.com/PloinkyRepos/vibe.git',
    'security': 'https://github.com/PloinkyRepos/security.git',
    'extra': 'https://github.com/PloinkyRepos/extra.git',
    'demo': 'https://github.com/PloinkyRepos/demo.git'
  };

  const repoUrl = predefined[name] || url;

  if (!repoUrl) {
    throw new Error(`Unknown repository '${name}'. Provide URL or use predefined: ${Object.keys(predefined).join(', ')}`);
  }

  // Clone repository
  await git.clone(repoUrl, path.join(REPOS_DIR, name));

  console.log(`Repository '${name}' added successfully`);
}
```

**Example:**
```bash
> add repo basic           # Add predefined basic repo
> add repo myrepo https://github.com/user/repo.git  # Add custom repo
```

#### `enable repo <name>`

Enable a repository for agent discovery.

```bash
> enable repo basic
Repository 'basic' enabled. Agents: alpine-bash, node-dev, postgres, ...
```

#### `disable repo <name>`

Disable a repository.

```bash
> disable repo custom
Repository 'custom' disabled.
```

#### `list repos`

List all repositories and their status.

```bash
> list repos
Repositories:
  basic      [enabled]   15 agents
  cloud      [disabled]  8 agents
  custom     [enabled]   3 agents
```

#### `update repo <name>`

Pull latest changes from repository.

```bash
> update repo basic
Updating 'basic'... done. Updated 3 agents.
```

### Agent Commands

#### `enable agent <name> [mode] [options]`

Enable an agent from a repository.

```javascript
/**
 * Enable agent command
 * @param {string} agentName - Agent name
 * @param {string} [mode] - Run mode: "isolated" (default), "global", "devel <repo>"
 * @param {string} [alias] - Optional alias with "as <alias>"
 */
async function handleEnableAgent(agentName, mode = 'isolated', alias = null) {
  // Find agent in enabled repos
  const { repoName, manifest } = await findAgent(agentName);

  // Create registry entry
  const entry = {
    agentName: alias || agentName,
    repoName,
    containerImage: manifest.container || manifest.image,
    runMode: mode,
    // ... other fields
  };

  // Save to registry
  await saveAgentRegistry(entry);

  // Create workspace symlinks
  await createAgentSymlinks(agentName, repoName);

  console.log(`Agent '${agentName}' enabled in ${mode} mode`);
}
```

**Syntax:**
```bash
enable agent <name> [mode] [as <alias>]
```

**Modes:**
- `isolated` (default): Agent gets its own working directory
- `global`: Uses current working directory
- `devel <repo>`: Development mode with repo path

**Examples:**
```bash
> enable agent node-dev                    # Enable in isolated mode
> enable agent shell global                # Enable in global mode
> enable agent myagent devel custom        # Enable in development mode
> enable agent postgres global as db       # Enable with alias
```

#### `disable agent <name>`

Disable an agent and remove from registry.

```bash
> disable agent node-dev
Agent 'node-dev' disabled. Container stopped and removed.
```

#### `refresh agent <name>`

Rebuild and restart an agent container.

```bash
> refresh agent node-dev
Refreshing 'node-dev'...
  Stopping container... done
  Removing container... done
  Creating container... done
  Starting container... done
Agent 'node-dev' refreshed successfully.
```

#### `list agents`

List all enabled agents.

```bash
> list agents
Enabled agents:
  AGENT          REPO      MODE       STATUS     PORT
  node-dev       basic     isolated   running    12345
  postgres       basic     global     running    5432
  shell          basic     isolated   stopped    -
```

### Workspace Commands

#### `start [agent] [port]`

Start workspace with router and agents.

```javascript
/**
 * Start workspace
 * @param {string} [staticAgent] - Agent to serve static files (required first time)
 * @param {number} [port] - Router port (required first time)
 */
async function handleStart(staticAgent, port) {
  // First start: require agent and port
  if (!hasExistingConfig() && (!staticAgent || !port)) {
    throw new Error('First start requires: start <static-agent> <port>');
  }

  // Load or create routing config
  const config = staticAgent && port
    ? { staticAgent, port: parseInt(port) }
    : await loadRoutingConfig();

  // Start all enabled agents
  for (const agent of await getEnabledAgents()) {
    await startAgent(agent.agentName);
  }

  // Start router
  await startRouter(config.port, config.staticAgent);

  console.log(`Workspace started on port ${config.port}`);
  console.log(`Static agent: ${config.staticAgent}`);
}
```

**Examples:**
```bash
> start node-dev 8088    # First time: specify agent and port
> start                  # Subsequent: use saved config
> start myagent          # Start specific agent only
```

#### `stop [agent]`

Stop agent containers without removing.

```bash
> stop              # Stop all agents
> stop node-dev     # Stop specific agent
Stopping containers... done
```

#### `restart [agent]`

Restart agent containers.

```bash
> restart           # Restart all
> restart node-dev  # Restart specific agent
```

#### `shutdown`

Stop and remove containers.

```bash
> shutdown
Shutting down workspace...
  Stopping node-dev... done
  Removing node-dev... done
  Stopping router... done
Workspace shut down.
```

#### `destroy`

Complete cleanup of all Ploinky containers.

```bash
> destroy
WARNING: This will remove ALL Ploinky containers.
Continue? (y/N): y
Destroying all containers... done
Cleaning workspace state... done
```

#### `clean`

Clean temporary files and caches.

```bash
> clean
Cleaning temporary files... done
  Removed 15 log files
  Cleared cache (23MB)
```

#### `status`

Show workspace status.

```bash
> status
Workspace Status:
  Profile: dev
  Router: running on port 8088

  AGENT          STATUS    CONTAINER           PORT     HEALTH
  node-dev       running   ploinky_basic_...   12345    healthy
  postgres       running   ploinky_basic_...   5432     healthy
  shell          stopped   -                   -        -

  Repositories: 3 enabled, 2 disabled
```

### Interactive Commands

#### `shell <agent>`

Open interactive shell in agent container.

```javascript
/**
 * Open shell in agent container
 * @param {string} agentName - Agent name
 */
async function handleShell(agentName) {
  const agent = await loadAgent(agentName);

  // Determine shell command
  const shell = agent.manifest.shell || '/bin/sh';

  // Execute interactive shell
  await execInteractive(agent.containerName, shell);
}
```

```bash
> shell node-dev
Entering shell for 'node-dev'...
root@container:/code# ls
index.js  package.json
root@container:/code# exit
Shell session ended.
```

#### `cli <agent> [args...]`

Run agent's CLI command.

```bash
> cli node-dev
node> console.log("Hello")
Hello
node> .exit

> cli node-dev --version
v20.10.0
```

#### `run <agent> [command]`

Run a command in agent container.

```bash
> run node-dev npm install
Installing dependencies...

> run postgres psql -U postgres -c "SELECT 1"
 ?column?
----------
        1
```

### Web Interface Commands

#### `webtty [agent] [token]`

Start WebTTY interface.

```bash
> webtty node-dev myToken123
WebTTY configured for 'node-dev'
Access: http://localhost:8088/webtty/node-dev?token=myToken123
Token stored in .ploinky/.secrets

> webtty
WebTTY URL: http://localhost:8088/webtty/node-dev
```

#### `webchat [agent] [token]`

Start WebChat interface.

```bash
> webchat node-dev
WebChat URL: http://localhost:8088/webchat/node-dev?token=abc123
```

#### `webconsole [agent] [token]`

Combined TTY + Chat interface.

```bash
> webconsole node-dev myPassword
Console configured for 'node-dev'
  TTY: http://localhost:8088/webtty/node-dev?token=...
  Chat: http://localhost:8088/webchat/node-dev?token=...
```

#### `webmeet [moderator-agent]`

Start collaborative meeting interface.

```bash
> webmeet node-dev
WebMeet started
  URL: http://localhost:8088/webmeet
  Moderator: node-dev
```

#### `dashboard [token]`

Configure dashboard access.

```bash
> dashboard
Dashboard: http://localhost:8088/dashboard?token=xyz789
```

### Client Commands

#### `client methods <agent>`

List available agent methods.

```bash
> client methods node-dev
Available tools for 'node-dev':
  execute_code    - Execute JavaScript code
  read_file       - Read file contents
  write_file      - Write file contents
  list_files      - List directory contents
```

#### `client status <agent>`

Check agent status.

```bash
> client status node-dev
Agent: node-dev
  Status: healthy
  Uptime: 2h 15m
  Tasks completed: 47
  Current load: 2 tasks
```

#### `client task <agent> [--parameters <json>]`

Send task to agent.

```bash
> client task node-dev
Enter command: execute_code
Enter parameters (JSON): {"code": "console.log('Hello')"}

Response:
{
  "success": true,
  "output": "Hello\n"
}
```

#### `client list`

List active client connections.

```bash
> client list
Active clients:
  node-dev     connected  2 active tasks
  postgres     connected  0 active tasks
```

### Variable Commands

#### `var <NAME> <value>`

Set a variable.

```bash
> var DATABASE_URL postgres://localhost:5432/mydb
Variable 'DATABASE_URL' set

> var API_KEY $SECRET_KEY    # Reference another variable
Variable 'API_KEY' set (aliased to SECRET_KEY)
```

#### `vars`

List all variables.

```bash
> vars
Variables:
  DATABASE_URL = postgres://localhost:5432/mydb
  API_KEY      = (aliased to SECRET_KEY)
  DEBUG        = true
```

#### `echo <VAR>`

Print variable value.

```bash
> echo DATABASE_URL
postgres://localhost:5432/mydb

> echo $API_KEY
sk-12345...
```

#### `expose <ENV_NAME> <value> [agent]`

Expose variable to agent container.

```bash
> expose DATABASE_URL $DATABASE_URL node-dev
Exposed 'DATABASE_URL' to 'node-dev'

> expose DEBUG true          # Expose to all agents
Exposed 'DEBUG' globally
```

### Profile Commands

#### `profile [name]`

Set or show active profile.

```bash
> profile
Current profile: dev

> profile qa
Profile set to: qa
Environment:
  NODE_ENV=test
  DEBUG=false
```

#### `profile list`

List available profiles.

```bash
> profile list
Available profiles:
  PROFILE    STATUS    SECRETS
  dev        active    2/2 ✓
  qa         ready     3/3 ✓
  prod       missing   1/3 ✗
```

#### `profile validate <name>`

Validate profile configuration.

```bash
> profile validate prod
Validating profile 'prod'...

  Manifest: ✓
  Environment: ✓
  Secrets:
    PROD_API_KEY: ✗ NOT FOUND
    PROD_DATABASE_URL: ✓
  Scripts:
    install.sh: ✓
    postinstall.sh: ✗ NOT FOUND

Validation FAILED: 2 errors
```

### Logging Commands

#### `logs tail [service]`

Tail logs in real-time.

```bash
> logs tail router
[2024-01-15 10:23:45] Router started on port 8088
[2024-01-15 10:23:46] Agent 'node-dev' connected
...

> logs tail webtty
[2024-01-15 10:24:00] WebTTY session started for node-dev
...
```

#### `logs last <count> [service]`

Show last N log entries.

```bash
> logs last 50 router
... (last 50 router log lines)

> logs last 100
... (last 100 lines from all services)
```

### System Commands

#### `help [topic]`

Show help information.

```bash
> help
Ploinky CLI - Containerized Agent Runtime

Commands:
  Repository:   add repo, enable repo, disable repo, list repos, update repo
  Agents:       enable agent, disable agent, refresh agent, list agents
  Workspace:    start, stop, restart, shutdown, destroy, clean, status
  Interactive:  shell, cli, run
  Web:          webtty, webchat, webconsole, webmeet, dashboard
  Client:       client methods, client status, client task, client list
  Variables:    var, vars, echo, expose
  Profile:      profile, profile list, profile validate
  Logs:         logs tail, logs last
  System:       help, settings, version, exit

Type 'help <command>' for detailed help.

> help start
start [agent] [port]

Start the workspace with router and agents.

Arguments:
  agent   - Agent to serve static files (required on first start)
  port    - Router HTTP port (required on first start)

Examples:
  start node-dev 8088   # First time setup
  start                 # Use saved configuration
  start myagent         # Start specific agent
```

#### `settings`

Open interactive settings menu.

```bash
> settings
Ploinky Settings

1. Profile Configuration
2. Default Agent
3. Router Settings
4. Authentication
5. Logging Level
6. Exit

Select option: _
```

#### `version`

Show version information.

```bash
> version
Ploinky v1.0.0
Node.js v20.10.0
Container runtime: docker 24.0.6
```

## Error Handling

### Common Error Messages

```javascript
const errorMessages = {
  AGENT_NOT_FOUND: (name) =>
    `Agent '${name}' not found.\n` +
    `Run 'list agents' to see enabled agents, or 'enable agent ${name}' to enable.`,

  REPO_NOT_FOUND: (name) =>
    `Repository '${name}' not found.\n` +
    `Run 'list repos' to see available repositories.`,

  WORKSPACE_NOT_STARTED: () =>
    `Workspace not started.\n` +
    `Run 'start <agent> <port>' to start the workspace.`,

  CONTAINER_NOT_RUNNING: (name) =>
    `Container for '${name}' is not running.\n` +
    `Run 'start' to start the workspace.`,

  INVALID_PORT: (port) =>
    `Invalid port: ${port}.\n` +
    `Port must be a number between 1 and 65535.`
};
```

## Success Criteria

1. All commands documented with syntax and examples
2. Help available for every command
3. Error messages are actionable
4. Commands work consistently in interactive and scripted mode
5. Tab completion hints available

## References

- [DS01 - Vision](./DS01-vision.md)
- [DS02 - Architecture](./DS02-architecture.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS06 - Web Interfaces](./DS06-web-interfaces.md)
