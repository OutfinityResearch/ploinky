# Ploinky Cloud - Complete Documentation

## What is Ploinky Cloud?

Ploinky Cloud is a lightweight container orchestration platform that provides a simple yet powerful way to deploy and manage containerized applications. It serves as an alternative to complex solutions like Kubernetes, focusing on developer experience and operational simplicity.

## Key Features

- **Simple HTTP API**: RESTful interface for all operations
- **Multi-tenancy**: Host multiple applications on different domains/paths
- **Git Integration**: Deploy directly from Git repositories
- **Container Agnostic**: Works with both Docker and Podman
- **File-based Communication**: Transitioning to HTTP for improved performance
- **Auto-scaling**: Cluster mode utilizes all CPU cores
- **Zero Configuration**: Works out-of-the-box with sensible defaults

## How It Works

### System Overview

```
1. Client Request (HTTP) → Ploinky Cloud Server
2. Server routes request to appropriate deployment
3. Deployment mapped to container with agent code
4. Task executed in container via AgentCore
5. Result returned through HTTP response
```

### Core Concepts

#### Deployments
A deployment maps a domain/path combination to a containerized agent:
- **Domain**: The hostname (e.g., `api.example.com`, `localhost`)
- **Path**: The URL path (e.g., `/api`, `/v1/users`)
- **Agent**: The application code from a Git repository

#### Agents
Agents are containerized applications that:
- Run in isolated containers
- Process tasks/commands
- Return results via standardized interface
- Can be versioned and updated independently

#### Tasks
Tasks are units of work:
- Submitted via HTTP POST requests
- Include command and parameters
- Executed asynchronously or synchronously
- Return JSON responses

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ploinky.git
cd ploinky

# Install dependencies
npm install

# Start the cloud server
npm run cloud:start
# Or use the CLI
./bin/p-cli cloud start
```

### Quick Start

1. **Start the server**:
```bash
p-cli cloud start
# Server starts on http://localhost:8000
```

2. **Initialize (first time only)**:
```bash
p-cli cloud init
# Returns an admin API key
```

3. **Connect and authenticate**:
```bash
p-cli cloud connect http://localhost:8000
p-cli cloud login <API_KEY>
```

4. **Deploy an agent**:
```bash
# Add the demo repository
p-cli cloud repo add PloinkyDemo https://github.com/PloinkyRepos/PloinkyDemo.git

# Deploy to localhost/demo
p-cli cloud deploy localhost /demo demo
```

5. **Call the agent**:
```bash
p-cli cloud call /demo hello World
# Returns: {"message": "Hello World"}
```

## Architecture

### Component Structure

```
Ploinky Cloud Server
├── Request Router      # HTTP request routing
├── Task Orchestrator   # Task management
├── Deployment Manager  # Container lifecycle
├── Container Manager   # Docker/Podman abstraction
├── Git Manager        # Repository synchronization
└── AgentCore Client   # Task execution interface
```

### Communication Flow

#### Current: File-based
```
HTTP Request
    ↓
Task Creation
    ↓
Write to Filesystem Queue (/agent/.ploinky/queue/tasks/)
    ↓
AgentCore polls and processes
    ↓
Write result to Filesystem (/agent/.ploinky/queue/results/)
    ↓
Poll and return HTTP Response
```

#### Future: HTTP-based
```
HTTP Request
    ↓
Direct HTTP call to container
    ↓
AgentCore HTTP server processes
    ↓
Direct HTTP Response
```

## Deployment Configuration

### Basic Deployment

```bash
p-cli cloud deploy <domain> <path> <agent> [options]
```

Options:
- `--repository`: Git repository URL
- `--branch`: Git branch (default: main)
- `--image`: Container image (default: node:18-alpine)
- `--env`: Environment variables

### Advanced Configuration

Create a deployment configuration:

```json
{
    "domain": "api.example.com",
    "path": "/v1",
    "agent": "my-service",
    "repository": "https://github.com/user/my-service.git",
    "branch": "production",
    "image": "node:18",
    "environment": {
        "NODE_ENV": "production",
        "API_KEY": "secret"
    }
}
```

Deploy with configuration:
```bash
p-cli cloud deploy --config deployment.json
```

## Container Management

### Container Lifecycle

Each deployment creates a container with:
- **Mounted Volumes**:
  - `/agent`: Application code from Git
  - `/agentCore`: Runtime engine (read-only)
  - `/agent/.ploinky/queue`: Task queue

### Container Configuration

Default container settings:
- **Image**: `node:18-alpine`
- **Restart Policy**: `unless-stopped`
- **Network**: Bridge mode
- **Resources**: No limits (configurable)

### Custom Images

Use custom Docker images:
```bash
p-cli cloud deploy localhost /api my-agent --image my-org/my-image:latest
```

## Git Integration

### Repository Management

```bash
# Add repository
p-cli cloud repo add MyRepo https://github.com/user/repo.git

# List repositories
p-cli cloud repo list

# Remove repository
p-cli cloud repo remove MyRepo
```

### Automatic Synchronization

Deployments automatically:
1. Clone repository on first deployment
2. Pull updates on redeploy
3. Cache repositories locally
4. Support private repositories (with credentials)

### Branch Management

Deploy different branches:
```bash
# Deploy main branch
p-cli cloud deploy localhost /prod my-app --branch main

# Deploy development branch
p-cli cloud deploy localhost /dev my-app --branch develop
```

## API Reference

### REST Endpoints

#### Deployments
- `GET /management/api/deployments` - List all deployments
- `POST /management/api/deployments` - Create deployment
- `DELETE /management/api/deployments` - Remove deployment

#### Repositories
- `GET /management/api/repositories` - List repositories
- `POST /management/api/repositories` - Add repository
- `DELETE /management/api/repositories/{name}` - Remove repository

#### Metrics
- `GET /management/api/metrics` - System metrics
- `GET /management/api/health` - Health check
- `GET /management/api/logs` - Server logs

### Agent Calls

```javascript
// Using PloinkyClient
const client = new PloinkyClient('http://localhost:8000');
const result = await client.call('/demo', 'hello', 'World');

// Using HTTP directly
POST http://localhost:8000/demo
Content-Type: application/json

{
    "command": "hello",
    "params": ["World"]
}
```

## Management Dashboard

Access the web dashboard at `http://localhost:8000/management`

Features:
- Visual deployment management
- Real-time metrics
- Log viewer
- Configuration editor
- Agent testing interface

## Monitoring

### Metrics Collection

Available metrics:
- Request count and latency
- Error rates
- Container status
- Resource usage
- Task execution times

### Health Checks

```bash
# Check system health
p-cli cloud health

# View metrics
p-cli cloud metrics 24h
```

### Logging

```bash
# View recent logs
p-cli cloud logs 500

# Download logs for specific date
p-cli cloud logs download 2024-01-15
```

## Security

### Authentication

Currently simplified (per requirements):
- API key authentication
- Session tokens
- No authentication required (configurable)

### Future Security Features

- OAuth2/OIDC integration
- Role-based access control (RBAC)
- Mutual TLS for agent communication
- Secrets management
- Audit logging

### Best Practices

1. **Use HTTPS in production** (reverse proxy)
2. **Isolate containers** with proper networking
3. **Limit resource usage** per container
4. **Regular security updates** for base images
5. **Scan images** for vulnerabilities

## Performance Optimization

### Scaling Strategies

1. **Vertical Scaling**: Increase server resources
2. **Horizontal Scaling**: Add more worker processes
3. **Container Pooling**: Pre-warm containers
4. **Caching**: Git and Docker layer caching

### Performance Tuning

```javascript
// Configuration options
{
    "settings": {
        "workers": "auto",        // Number of worker processes
        "taskTimeout": 30000,     // Task execution timeout
        "cacheTime": 3600000,     // Git cache duration
        "maxContainers": 100      // Maximum concurrent containers
    }
}
```

## Troubleshooting

### Common Issues

#### Server Won't Start
```bash
# Check port availability
lsof -i :8000

# Use different port
PORT=8080 p-cli cloud start
```

#### Container Fails to Start
```bash
# Check container runtime
docker version
# or
podman version

# Check logs
p-cli cloud logs
```

#### Authentication Issues
```bash
# Re-initialize
p-cli cloud init

# Clear cached credentials
rm -rf .ploinky/cloud.json
```

### Debug Mode

Enable debug output:
```bash
DEBUG=1 p-cli cloud deploy localhost /api demo
```

## Migration Guide

### From Docker Compose

```yaml
# docker-compose.yml
services:
  api:
    image: node:18
    command: npm start
```

Equivalent in Ploinky:
```bash
p-cli cloud deploy localhost /api my-api --image node:18
```

### From Kubernetes

```yaml
# kubernetes deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: my-app:latest
```

Equivalent in Ploinky:
```bash
p-cli cloud deploy localhost /app my-app --image my-app:latest
```

## Advanced Topics

### Custom AgentCore

Create custom task processors:
```javascript
// /agent/handlers/custom.js
module.exports = function(params) {
    // Process task
    return { success: true, result: params };
};
```

### Multi-Domain Setup

```bash
# Deploy to multiple domains
p-cli cloud host add api.example.com
p-cli cloud host add admin.example.com

p-cli cloud deploy api.example.com /v1 api-service
p-cli cloud deploy admin.example.com / admin-panel
```

### Load Balancing

Use a reverse proxy (nginx):
```nginx
upstream ploinky {
    server localhost:8000;
    server localhost:8001;
    server localhost:8002;
}

server {
    listen 80;
    location / {
        proxy_pass http://ploinky;
    }
}
```

## Roadmap

### In Progress
- HTTP-based AgentCore (replacing file-based)
- WebSocket support for real-time updates

### Planned Features
- Distributed task queue (Redis/RabbitMQ)
- Service mesh capabilities
- Agent marketplace
- Kubernetes operator
- Cloud provider integrations

## Support

- **Documentation**: This guide and others in `/docs`
- **Issues**: GitHub issue tracker
- **Examples**: `/examples` directory
- **Community**: GitHub discussions

## License

MIT License - See LICENSE file for details