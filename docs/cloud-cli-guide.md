# Ploinky Cloud CLI Guide

## Installation

The Ploinky Cloud CLI is integrated into the main `p-cli` tool.

```bash
# Make sure p-cli is in your PATH
export PATH="/path/to/ploinky/bin:$PATH"

# Verify installation
p-cli cloud help
```

## Quick Start

```bash
# Start the cloud server
p-cli cloud start --port 8000

# Login as admin (default password: admin)
p-cli cloud login admin

# Add a domain
p-cli cloud add host api.example.com

# Deploy an agent
p-cli cloud deploy localhost /api MyAgent

# Run a task
p-cli cloud run /api myCommand param1 param2
```

## Command Reference

### Server Management

#### Start Server
```bash
p-cli cloud start [options]
  --port PORT    Server port (default: 8000)
  --dir DIR      Working directory (default: current)
```

#### Stop Server
```bash
p-cli cloud stop
```

#### Check Status
```bash
p-cli cloud status
```

### Authentication

#### Login
```bash
p-cli cloud login [username]
# Prompts for password
```

#### Logout
```bash
p-cli cloud logout
```

### Administration

#### Add Admin User
```bash
p-cli cloud add admin <username>
# Prompts for password
```

#### Add Domain/Host
```bash
p-cli cloud add host <domain>
```

#### Add Repository
```bash
p-cli cloud add repo <name> <url>
```

#### Remove Domain
```bash
p-cli cloud remove host <domain>
```

#### Remove Repository
```bash
p-cli cloud remove repo <url>
```

### Deployment Management

#### Deploy Agent
```bash
p-cli cloud deploy <domain> <path> <agent>

# Example
p-cli cloud deploy localhost /api/users UserAgent
```

#### Undeploy Agent
```bash
p-cli cloud undeploy <domain> <path>

# Example
p-cli cloud undeploy localhost /api/users
```

#### List Deployments
```bash
p-cli cloud list deployments
```

#### List Available Agents
```bash
p-cli cloud list agents
```

#### List Configured Domains
```bash
p-cli cloud list domains
```

#### List Repositories
```bash
p-cli cloud list repos
```

### Task Execution

#### Run Task on Agent
```bash
p-cli cloud run <agent-path> <command> [parameters...]

# Examples
p-cli cloud run /api/users createUser john@example.com "John Doe"
p-cli cloud run /api/data query "SELECT * FROM users"
```

### Monitoring

#### View Metrics
```bash
p-cli cloud metrics [range]

# Examples
p-cli cloud metrics 1h    # Last hour
p-cli cloud metrics 24h   # Last 24 hours
p-cli cloud metrics 7d    # Last 7 days
```

#### Show Configuration
```bash
p-cli cloud config
```

## Working with Agents

### Creating an Agent

1. Create agent directory structure:
```bash
mkdir -p myagent
cd myagent
```

2. Create manifest.json:
```json
{
  "name": "MyAgent",
  "container": "docker.io/library/node:18",
  "about": "My custom agent",
  "commands": {
    "hello": "echo 'Hello World'",
    "process": "node process.js"
  }
}
```

3. Add to repository and deploy:
```bash
p-cli cloud add repo local file:///path/to/myagent
p-cli cloud deploy localhost /myapi MyAgent
```

### Testing an Agent

```bash
# Check deployment
p-cli cloud list deployments

# Run test command
p-cli cloud run /myapi hello

# Check metrics
p-cli cloud metrics
```

## Advanced Usage

### Multiple Contexts

The CLI stores configuration in `.ploinky/cloud.json`:

```json
{
  "serverUrl": "http://localhost:8000",
  "authToken": "...",
  "currentContext": "local"
}
```

You can manage multiple cloud instances by switching contexts.

### Scripting

All commands support non-interactive mode for scripting:

```bash
#!/bin/bash

# Start server
p-cli cloud start --port 8000

# Wait for startup
sleep 5

# Login (password via stdin)
echo "admin" | p-cli cloud login admin

# Deploy agents
p-cli cloud deploy localhost /api UserAgent
p-cli cloud deploy localhost /auth SecurityAgent

# Run batch operations
for i in {1..10}; do
  p-cli cloud run /api createUser "user$i@example.com"
done
```

### Environment Variables

```bash
# Set server URL
export PLOINKY_SERVER_URL=http://cloud.example.com:8000

# Set auth token
export PLOINKY_AUTH_TOKEN=your-token-here
```

## Troubleshooting

### Server Won't Start
```bash
# Check if port is in use
lsof -i :8000

# Check logs
p-cli cloud status

# Force stop and restart
p-cli cloud stop
p-cli cloud start --port 8001
```

### Authentication Issues
```bash
# Clear saved credentials
rm -f .ploinky/cloud.json

# Re-login
p-cli cloud login admin
```

### Deployment Failures
```bash
# Check agent manifest
cat agents/myagent/manifest.json | jq .

# Verify container runtime
docker --version || podman --version

# Check agent logs
p-cli cloud status
```

### Task Execution Errors
```bash
# Check task queue
ls -la agents/domain/path/.tasks/

# Clear stuck tasks
rm -rf agents/domain/path/.tasks/locks/*

# Restart agent
p-cli cloud undeploy domain /path
p-cli cloud deploy domain /path AgentName
```

## Best Practices

1. **Change Default Password**: First login should change admin password
2. **Use Specific Paths**: Deploy agents to specific paths, not root
3. **Monitor Metrics**: Regularly check metrics for performance issues
4. **Backup Configuration**: Keep backups of config.json
5. **Test Locally**: Test agents locally before production deployment
6. **Use Repositories**: Organize agents in Git repositories
7. **Implement Health Checks**: Add health check commands to agents
8. **Log Rotation**: Implement log rotation for production

## Security Recommendations

1. **Strong Passwords**: Use strong admin passwords
2. **Token Rotation**: Regularly rotate auth tokens
3. **HTTPS in Production**: Use reverse proxy with SSL
4. **Network Isolation**: Run on private networks
5. **Container Security**: Use minimal base images
6. **Permission Scoping**: Grant minimal required permissions
7. **Audit Logging**: Enable detailed audit logs
8. **Regular Updates**: Keep containers and dependencies updated
