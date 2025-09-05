# Ploinky Documentation

Welcome to the Ploinky documentation! Ploinky is a container-based development and deployment platform that simplifies working with containerized applications.

## Documentation Structure

### Core Documentation

- **[Cloud Architecture](cloud-architecture.md)** - Detailed architecture overview of Ploinky Cloud
- **[Cloud CLI Guide](cloud-cli-guide.md)** - Complete guide for using the cloud CLI commands
- **[Cloud API Reference](cloud-api-reference.md)** - API documentation for developers

### Getting Started

#### Quick Start with Ploinky Cloud

```bash
# Start the cloud server
p-cli cloud start

# Login as admin (default: admin/admin)
p-cli cloud login admin

# Deploy your first agent
p-cli cloud deploy localhost /api MyAgent

# Run a command
p-cli cloud run /api hello
```

#### Quick Start with Ploinky CLI

```bash
# Initialize a project
p-cli init my-project

# List available containers
p-cli list

# Run a container
p-cli run my-container

# Execute commands
p-cli exec my-container ls -la
```

## Key Features

### Ploinky Cloud
- **Lightweight Orchestration**: Alternative to Docker Compose/Kubernetes
- **File-based Communication**: Asynchronous task queues via filesystem
- **Built-in Security**: Authentication and authorization with Guardian
- **Auto-scaling**: Clustered architecture with worker processes
- **Container Support**: Works with Docker and Podman
- **Web Dashboard**: Management UI at `/management`

### Ploinky CLI
- **Container Management**: Easy container lifecycle management
- **Development Workflow**: Streamlined development with containers
- **Git Integration**: Version control for containerized apps
- **Task Automation**: Scriptable container operations

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ Cloud Server│────▶│   Agent     │
│  (Browser)  │     │  (Cluster)  │     │ (Container) │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   Guardian   │
                    │  (Security)  │
                    └──────────────┘
```

## Component Overview

### Cloud Components

1. **Cloud Server** (`/cloud/core`)
   - HTTP server with clustering
   - Request routing
   - Task orchestration

2. **Guardian** (`/cloud/guardian`)
   - Authentication/Authorization
   - Session management
   - Security context injection

3. **Supervisor** (`/cloud/supervisor`)
   - Container lifecycle
   - Health monitoring
   - Auto-restart logic

4. **Task Queue** (`/cloud/taskQueue`)
   - File-based queuing
   - Strategy pattern
   - Async communication

5. **Agent Core** (`/agentCore`)
   - Task processing
   - Lock management
   - Standard library

### Client Components

1. **PloinkyClient** (`/client`)
   - JavaScript SDK
   - Browser/Node.js support
   - Real-time subscriptions

2. **Dashboard** (`/dashboard`)
   - Web-based management
   - Metrics visualization
   - Configuration UI

3. **CLI** (`/cli`)
   - Command-line interface
   - Cloud administration
   - Container management

## Common Tasks

### Deploy a New Agent

1. Create agent manifest:
```json
{
  "name": "MyAgent",
  "container": "node:18",
  "commands": {
    "hello": "echo 'Hello World'"
  }
}
```

2. Deploy:
```bash
p-cli cloud deploy localhost /api MyAgent
```

### Monitor System

```bash
# Check status
p-cli cloud status

# View metrics
p-cli cloud metrics 24h

# List deployments
p-cli cloud list deployments
```

### Manage Configuration

```bash
# Add domain
p-cli cloud add host api.example.com

# Add repository
p-cli cloud add repo MyRepo https://github.com/user/repo.git

# Show config
p-cli cloud config
```

## Testing

Run the test suite:

```bash
# Run cloud tests
./tests/cloud/test_cloud.sh

# Run specific test
./tests/cloud/test_cloud.sh test_name
```

## Security Best Practices

1. **Change default admin password immediately**
2. **Use HTTPS in production (reverse proxy)**
3. **Implement proper authentication for agents**
4. **Regular security updates for containers**
5. **Network isolation for sensitive deployments**
6. **Audit logging for compliance**

## Performance Optimization

1. **Cluster Mode**: Utilizes all CPU cores
2. **File-based Queues**: Efficient async processing
3. **Container Caching**: Reuse container images
4. **Metrics Monitoring**: Track performance issues
5. **Load Balancing**: Distribute across workers

## Troubleshooting

### Common Issues

#### Server Won't Start
```bash
# Check port availability
lsof -i :8000

# Try different port
p-cli cloud start --port 8081
```

#### Agent Not Responding
```bash
# Check agent status
p-cli cloud status

# Restart agent
p-cli cloud undeploy localhost /api
p-cli cloud deploy localhost /api MyAgent
```

#### Authentication Issues
```bash
# Clear credentials
rm -rf .ploinky/cloud.json

# Re-login
p-cli cloud login admin
```

## Development

### Creating Custom Agents

See [Cloud API Reference](cloud-api-reference.md#agent-development) for detailed agent development guide.

### Contributing

1. Fork the repository
2. Create feature branch
3. Implement changes
4. Add tests
5. Submit pull request

## Support

- **GitHub Issues**: Report bugs and request features
- **Documentation**: This documentation set
- **Examples**: Check `/examples` directory
- **Community**: Join discussions on GitHub

## License

Ploinky is open-source software licensed under the MIT License.

## Version History

- **v1.0.0** - Initial release with core features
- Cloud server with clustering
- File-based task queues
- Guardian security layer
- Agent supervisor
- Management dashboard
- CLI administration tools

## Roadmap

- WebSocket support for real-time communication
- Distributed task queue implementations (Redis, RabbitMQ)
- Horizontal scaling across multiple machines
- Agent marketplace
- Enhanced monitoring and alerting
- Kubernetes integration option