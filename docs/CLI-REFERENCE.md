# Ploinky CLI Complete Reference

## Overview

The Ploinky CLI (`p-cli`) is the primary interface for managing both local containers and cloud deployments. It provides a unified command structure for all Ploinky operations.

## Installation

```bash
# Install globally
npm install -g ploinky-cli

# Or use directly
./bin/p-cli
```

## Command Structure

```
p-cli [command] [subcommand] [options]
```

## Complete Command Reference

### Container Management Commands

#### `p-cli init <name>`
Initialize a new Ploinky project.

```bash
p-cli init my-project
# Creates project structure with default configuration
```

#### `p-cli list`
List all containers (running and stopped).

```bash
p-cli list
# Shows container name, status, and ID
```

#### `p-cli run <container> [options]`
Run a container.

```bash
p-cli run my-container
p-cli run my-container --detach
p-cli run my-container --port 8080:80
```

Options:
- `--detach, -d`: Run in background
- `--port, -p`: Port mapping
- `--env, -e`: Environment variables
- `--volume, -v`: Volume mounts

#### `p-cli stop <container>`
Stop a running container.

```bash
p-cli stop my-container
```

#### `p-cli start <container>`
Start a stopped container.

```bash
p-cli start my-container
```

#### `p-cli restart <container>`
Restart a container.

```bash
p-cli restart my-container
```

#### `p-cli exec <container> <command>`
Execute command in running container.

```bash
p-cli exec my-container ls -la
p-cli exec my-container npm install
```

#### `p-cli logs <container> [options]`
View container logs.

```bash
p-cli logs my-container
p-cli logs my-container --follow
p-cli logs my-container --tail 100
```

Options:
- `--follow, -f`: Follow log output
- `--tail, -n`: Number of lines to show

#### `p-cli rm <container>`
Remove a container.

```bash
p-cli rm my-container
p-cli rm my-container --force
```

### Cloud Commands

#### `p-cli cloud connect [url]`
Connect to a Ploinky Cloud server.

```bash
p-cli cloud connect http://localhost:8000
p-cli cloud connect https://cloud.example.com
```

#### `p-cli cloud init`
Initialize cloud server (first-time setup).

```bash
p-cli cloud init
# Returns admin API key for authentication
```

#### `p-cli cloud login <api-key>`
Authenticate with the cloud server.

```bash
p-cli cloud login sk_live_xxxxxxxxxxx
```

#### `p-cli cloud logout`
Log out from the cloud server.

```bash
p-cli cloud logout
```

#### `p-cli cloud status`
Show current connection and authentication status.

```bash
p-cli cloud status
# Shows server URL, authentication status, active deployments
```

### Cloud Host Management

#### `p-cli cloud host add <domain>`
Add a new domain/host.

```bash
p-cli cloud host add api.example.com
p-cli cloud host add localhost
```

#### `p-cli cloud host remove <domain>`
Remove a domain/host.

```bash
p-cli cloud host remove api.example.com
```

#### `p-cli cloud host list`
List all configured domains.

```bash
p-cli cloud host list
```

### Cloud Repository Management

#### `p-cli cloud repo add <name> <url>`
Add a Git repository for agents.

```bash
p-cli cloud repo add MyAgents https://github.com/user/agents.git
p-cli cloud repo add PloinkyDemo https://github.com/PloinkyRepos/PloinkyDemo.git
```

#### `p-cli cloud repo remove <name>`
Remove a repository.

```bash
p-cli cloud repo remove MyAgents
```

#### `p-cli cloud repo list`
List all repositories.

```bash
p-cli cloud repo list
```

### Cloud Deployment Commands

#### `p-cli cloud deploy <domain> <path> <agent> [options]`
Deploy an agent to a specific domain/path.

```bash
p-cli cloud deploy localhost /api demo
p-cli cloud deploy api.example.com /v1/users user-service
```

Options:
- `--repository`: Git repository URL
- `--branch`: Git branch (default: main)
- `--image`: Container image (default: node:18-alpine)

#### `p-cli cloud undeploy <domain> <path>`
Remove a deployment.

```bash
p-cli cloud undeploy localhost /api
```

#### `p-cli cloud deployments`
List all active deployments.

```bash
p-cli cloud deployments
```

### Cloud Agent Interaction

#### `p-cli cloud call <path> <command> [params...]`
Call an agent command.

```bash
p-cli cloud call /api hello World
p-cli cloud call /api calculate 10 20 30
p-cli cloud call /api process-data '{"key": "value"}'
```

#### `p-cli cloud batch <file>`
Execute multiple commands from a file.

```bash
p-cli cloud batch commands.json

# commands.json format:
[
  {"agent": "/api", "command": "hello", "params": ["World"]},
  {"agent": "/api", "command": "calculate", "params": [1, 2, 3]}
]
```

### Client Commands

The client commands provide direct interaction with deployed agents through the PloinkyClient.

#### `p-cli client task <agent-path> <command> [params...]`
Execute a task on a deployed agent.

```bash
p-cli client task /demo hello world
p-cli client task /api/users list
p-cli client task /test echo "message"

# Output format:
--- Task Result ---
Status: SUCCESS
Data: { "response": "Hello world" }
-------------------
```

#### `p-cli client call <path|agent> <command> [params...]`
Call an agent command directly.

```bash
p-cli client call /demo hello World
p-cli client call myAgent processData "input.json" "output.json"
p-cli client call /auth login admin password123
```

#### `p-cli client methods <agent>`
List available methods for an agent (if supported by the agent).

```bash
p-cli client methods myAgent
# Note: Depends on agent implementation
```

#### `p-cli client status <agent>`
Get agent status (redirects to cloud management commands).

```bash
p-cli client status myAgent
# Use: cloud agent list | cloud deployments | cloud status
```

#### `p-cli client list`
List available agents (redirects to cloud management).

```bash
p-cli client list
# Use: cloud agent list
```

#### `p-cli client task-status <agent> <task-id>`
Get status of a specific task (if supported by agent).

```bash
p-cli client task-status myAgent task-123
# Note: Depends on agent implementation
```

### Cloud Monitoring Commands

#### `p-cli cloud metrics [range]`
View system metrics.

```bash
p-cli cloud metrics        # Default: 24h
p-cli cloud metrics 7d     # Last 7 days
p-cli cloud metrics 24h    # Last 24 hours
```

#### `p-cli cloud health`
Check system health.

```bash
p-cli cloud health
# Shows server status, agent status, database connectivity
```

#### `p-cli cloud logs [lines]`
View server logs.

```bash
p-cli cloud logs          # Default: 200 lines
p-cli cloud logs 500      # Last 500 lines
```

#### `p-cli cloud logs list`
List available log files by date.

```bash
p-cli cloud logs list
```

#### `p-cli cloud logs download <date>`
Download compressed logs for a specific date.

```bash
p-cli cloud logs download 2024-01-15
# Downloads as p-cloud-2024-01-15.log.gz
```

### Cloud Configuration

#### `p-cli cloud config`
Show current configuration.

```bash
p-cli cloud config
```

#### `p-cli cloud settings show`
Display server settings.

```bash
p-cli cloud settings show
```

#### `p-cli cloud settings set <key> <value>`
Update server settings.

```bash
p-cli cloud settings set logLevel debug
p-cli cloud settings set metricsRetention 30
```

### Cloud Cleanup Commands

#### `p-cli cloud destroy agents`
Remove all local agent containers.

```bash
p-cli cloud destroy agents
```

#### `p-cli cloud destroy server-agents`
Remove all server-side agent containers.

```bash
p-cli cloud destroy server-agents
```

### Interactive Mode

#### `p-cli`
Enter interactive mode.

```bash
p-cli
ploinky> cloud status
ploinky> list
ploinky> exit
```

Interactive mode commands:
- All regular commands without `p-cli` prefix
- `help`: Show available commands
- `exit` or `quit`: Exit interactive mode
- Tab completion for commands
- Command history with arrow keys

### Version and Help

#### `p-cli version`
Show CLI version.

```bash
p-cli version
```

#### `p-cli help [command]`
Show help for a command.

```bash
p-cli help
p-cli help cloud
p-cli help cloud deploy
```

## Configuration Files

### Local Configuration
```
.ploinky/
├── cloud.json       # Cloud connection settings
├── .agents          # Local agent registry
└── config.json      # Project configuration
```

### Cloud Configuration Structure
```json
{
  "serverUrl": "http://localhost:8000",
  "authToken": "token_xxxxx",
  "userId": "admin"
}
```

## Environment Variables

- `PLOINKY_CLOUD_DIR`: Cloud server working directory
- `PLOINKY_FORCE_SINGLE`: Force single-process mode
- `PORT`: Server port (default: 8000)
- `DEBUG`: Enable debug output

## Examples

### Complete Deployment Workflow

```bash
# 1. Connect to server
p-cli cloud connect http://localhost:8000

# 2. Initialize (first time only)
p-cli cloud init

# 3. Login with API key
p-cli cloud login sk_live_xxxxxxxxxxxxx

# 4. Add repository
p-cli cloud repo add Demo https://github.com/PloinkyRepos/PloinkyDemo.git

# 5. Deploy agent
p-cli cloud deploy localhost /api demo

# 6. Test deployment
p-cli cloud call /api hello World

# 7. Monitor
p-cli cloud metrics
p-cli cloud health
```

### Local Development Workflow

```bash
# 1. Initialize project
p-cli init my-app

# 2. Run container
p-cli run my-app -d

# 3. Execute commands
p-cli exec my-app npm install
p-cli exec my-app npm start

# 4. View logs
p-cli logs my-app -f

# 5. Stop when done
p-cli stop my-app
```

### Batch Operations

```bash
# Create batch file
cat > batch.json << EOF
[
  {"agent": "/api", "command": "setup"},
  {"agent": "/api", "command": "migrate"},
  {"agent": "/api", "command": "seed"},
  {"agent": "/api", "command": "verify"}
]
EOF

# Execute batch
p-cli cloud batch batch.json
```

## Troubleshooting

### Connection Issues
```bash
# Check connection
p-cli cloud status

# Reconnect
p-cli cloud connect http://localhost:8000

# Clear credentials
rm -rf .ploinky/cloud.json
```

### Authentication Problems
```bash
# Re-initialize
p-cli cloud init

# New login
p-cli cloud login <new-api-key>
```

### Container Issues
```bash
# List all containers
p-cli list

# Force remove
p-cli rm container-name --force

# Clean all local agents
p-cli cloud destroy agents
```

## Exit Codes

- `0`: Success
- `1`: General error
- `2`: Connection error
- `3`: Authentication error
- `4`: Container error
- `5`: Configuration error

## Shell Completion

### Bash
```bash
echo 'source <(p-cli completion bash)' >> ~/.bashrc
```

### Zsh
```bash
echo 'source <(p-cli completion zsh)' >> ~/.zshrc
```

### Fish
```bash
p-cli completion fish > ~/.config/fish/completions/p-cli.fish
```

## Advanced Usage

### Custom Container Runtime
```bash
# Use Podman instead of Docker
export CONTAINER_RUNTIME=podman
p-cli run my-container
```

### Debug Mode
```bash
# Enable debug output
DEBUG=1 p-cli cloud deploy localhost /api demo
```

### Proxy Configuration
```bash
# Use HTTP proxy
export HTTP_PROXY=http://proxy.example.com:8080
p-cli cloud connect https://cloud.example.com
```

## Security Considerations

1. **API Keys**: Store securely, never commit to version control
2. **HTTPS**: Use HTTPS in production environments
3. **Permissions**: Limit file system permissions for `.ploinky/` directory
4. **Network**: Use firewall rules to restrict access
5. **Containers**: Run with minimal privileges

## Performance Tips

1. **Keep Containers Warm**: Use `--detach` for long-running containers
2. **Batch Operations**: Use batch commands for multiple operations
3. **Local Caching**: Git repositories are cached locally
4. **Connection Reuse**: Cloud connection is persistent across commands
5. **Parallel Execution**: Multiple agents can run simultaneously

## Migration Guide

### From Docker Compose
```bash
# Instead of: docker-compose up
p-cli run my-app -d

# Instead of: docker-compose exec
p-cli exec my-app command

# Instead of: docker-compose logs
p-cli logs my-app -f
```

### From Kubernetes
```bash
# Instead of: kubectl apply
p-cli cloud deploy domain /path agent

# Instead of: kubectl get pods
p-cli cloud deployments

# Instead of: kubectl logs
p-cli cloud logs
```