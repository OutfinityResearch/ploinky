# Ploinky Cloud Architecture

## Overview

Ploinky Cloud is a lightweight container orchestration platform designed to replace Docker Compose or Kubernetes for specific use cases. It provides a simplified deployment environment where developers can launch containerized services (Agents) mapped to specific URL paths.

## Core Components

### 1. Cloud Server (`/cloud`)
The central HTTP server that manages everything:
- **Clustering**: Runs in Node.js clustered mode for resilience
- **Request Routing**: Routes incoming requests to deployed agents
- **Task Orchestration**: Converts HTTP requests to file-based tasks
- **Default Port**: 8000 (configurable)

### 2. Agent Core (`/agentCore`)
Standard library for all agents:
- **Task Queue Handler**: Processes tasks from filesystem queues
- **Lock Management**: Prevents race conditions
- **Error Handling**: Standardized error responses
- **Auto-mounted**: Available at `/agentCore` in every container

### 3. Guardian Security Layer (`/cloud/guardian`)
Middleware for authentication and authorization:
- **Token-based Auth**: Secure session management
- **Permission System**: Command-level access control
- **Admin Management**: PBKDF2-hashed passwords
- **User Injection**: Adds `runForUserId` to all commands

### 4. Agent Supervisor (`/cloud/supervisor`)
Container lifecycle management:
- **Health Monitoring**: Periodic health checks
- **Auto-restart**: Configurable retry logic
- **Container Support**: Works with Docker and Podman
- **Status Tracking**: Real-time agent status

### 5. Task Queue System (`/cloud/taskQueue`)
File-based asynchronous communication:
- **Strategy Pattern**: Pluggable queue implementations
- **FileSystemTaskQueue**: Default local filesystem implementation
- **Directory Structure**:
  ```
  .tasks/
  ├── requests/   # Incoming tasks
  ├── responses/  # Completed tasks
  ├── errors/     # Failed tasks
  ├── locks/      # Task locks
  └── urgent/     # Priority commands
  ```

## Communication Flow

```
Client → HTTP Request → Cloud Server → Guardian (Auth)
                                     ↓
                            Task Orchestrator
                                     ↓
                            File System Queue
                                     ↓
                            Agent Container
                                     ↓
                            Task Response
                                     ↓
                            HTTP Response → Client
```

## Special Agents

### Security Agent (`/auth`)
- Handles user authentication
- Returns authorization tokens
- Manages user sessions

### Static Agent
- Serves static files
- Handles unmapped paths
- Enables frontend hosting

## Deployment Structure

```
/working-directory/
├── config.json           # System configuration
├── .admin               # Admin credentials
├── activeUsers/         # Active sessions
├── agents/              # Deployed agents
│   ├── domain1/
│   │   └── path1/
│   │       ├── manifest.json
│   │       └── .tasks/
│   └── domain2/
└── metrics/             # Performance data
```

## Agent Manifest

Each agent requires a `manifest.json`:

```json
{
  "name": "MyAgent",
  "container": "docker.io/library/node:18",
  "install": "npm install",
  "run": "/agentCore/run.sh",
  "about": "Agent description",
  "commands": {
    "cmd.name": "handler-script.js"
  }
}
```

## Security Model

1. **Authentication**: Username/password → Token
2. **Authorization**: Token → User permissions
3. **Command Filtering**: Guardian validates commands
4. **User Context**: Every task includes `runForUserId`
5. **Admin Access**: Separate admin authentication

## Scalability Features

- **Clustered Architecture**: Multiple worker processes
- **Strategy Pattern**: Swappable queue implementations
- **Stateless Design**: Agents communicate via filesystem
- **Container Isolation**: Each agent in separate container
- **Horizontal Scaling**: Ready for distributed deployments

## Configuration

System configuration stored in `config.json`:

```json
{
  "domains": [
    {"name": "localhost", "enabled": true}
  ],
  "repositories": [
    {"name": "Demo", "url": "https://...", "enabled": true}
  ],
  "deployments": [
    {"domain": "localhost", "path": "/api", "agent": "MyAgent"}
  ],
  "settings": {
    "port": 8000,
    "workersCount": "auto",
    "metricsRetention": 7
  }
}
```