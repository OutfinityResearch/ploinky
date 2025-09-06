# Ploinky Architecture - Technical Deep Dive

## Table of Contents
1. [System Overview](#system-overview)
2. [Core Components](#core-components)
3. [Data Flow Architecture](#data-flow-architecture)
4. [Component Details](#component-details)
5. [Security Architecture](#security-architecture)
6. [Performance Considerations](#performance-considerations)
7. [Future Architecture Changes](#future-architecture-changes)

## System Overview

Ploinky is a container orchestration platform designed for simplicity and efficiency. It provides a lightweight alternative to Kubernetes for managing containerized applications, with a focus on file-based communication patterns and minimal resource overhead.

### Design Principles

1. **Simplicity First**: Minimize complexity while maintaining functionality
2. **File-Based Communication**: Use filesystem as the primary IPC mechanism
3. **Container Agnostic**: Support both Docker and Podman transparently
4. **Modular Architecture**: Clear separation of concerns between components
5. **HTTP-Based Control Plane**: Simple REST API for all operations

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         External Clients                         │
│  (Browser, p-cli, PloinkyClient, curl, 3rd-party integrations)  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Ploinky Cloud Server                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Request Router V2                      │  │
│  │  - Path-based routing (/management, /auth, /agents/*)    │  │
│  │  - Domain/host routing for multi-tenancy                 │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│  ┌──────────────────▼───────────────────────────────────────┐  │
│  │                  Task Orchestrator V2                     │  │
│  │  - Task creation and scheduling                          │  │
│  │  - Deployment management                                 │  │
│  │  - Container lifecycle control                           │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│  ┌──────────────────▼───────────────────────────────────────┐  │
│  │              AgentCore Task Executor                      │  │
│  │  - HTTP → AgentCoreClient translation (transitioning)    │  │
│  │  - Task queue management                                 │  │
│  │  - Result polling and retrieval                          │  │
│  └──────────────────┬───────────────────────────────────────┘  │
└─────────────────────┼───────────────────────────────────────────┘
                      │
                      │ HTTP (future) / Filesystem (current)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Container Layer                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Agent Container                        │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │                   AgentCore                        │  │  │
│  │  │  - HTTP server (future) / File watcher (current)   │  │  │
│  │  │  - Task execution engine                           │  │  │
│  │  │  - Handler invocation                              │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              Application Code                       │  │  │
│  │  │  - User agents from Git repositories               │  │  │
│  │  │  - Custom business logic                           │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Ploinky Cloud Server (`/cloud`)

The cloud server is the central control plane, implemented as a Node.js HTTP server with clustering support.

#### Key Modules:

- **`/cloud/core/serverV2.js`**: Main server entry point with cluster management
- **`/cloud/core/requestRouterV2.js`**: HTTP request routing and dispatch
- **`/cloud/core/taskOrchestratorV2.js`**: Task lifecycle management
- **`/cloud/core/configManager.js`**: Configuration persistence and management

#### Clustering Architecture:

```javascript
Master Process (PID: xxxx)
    ├── Worker 1 (handles HTTP requests)
    ├── Worker 2 (handles HTTP requests)
    ├── Worker N (one per CPU core)
    └── Shared: File system, configuration
```

### 2. Container Management (`/cloud/container`)

Abstracts container runtime operations for both Docker and Podman.

#### Key Classes:

- **`ContainerManager`**: Container lifecycle operations
- **`GitRepoManager`**: Git repository cloning and synchronization

#### Volume Mounting Strategy:

```
Host Filesystem                    Container Filesystem
/cloud/agents/{domain}/{path}/
    ├── code/          ────────►    /agent (rw)
    ├── .ploinky/queue/ ───────►    /agent/.ploinky/queue (rw)
    
/cloud/agentCore/      ────────►    /agentCore (ro)
```

### 3. AgentCore (`/agentCore`)

The runtime engine that executes inside containers. Currently file-based, transitioning to HTTP.

#### Current Architecture (File-based):
```bash
# /agentCore/run.sh - Main loop
while true; do
    for task in /agent/.ploinky/queue/tasks/*; do
        process_task $task
        write_result
    done
    sleep 0.2
done
```

#### Future Architecture (HTTP-based):
```javascript
// HTTP server listening on container port
POST /task → Execute task → Return result
```

### 4. AgentCoreClient (`/agentCoreClient`)

Client library for interacting with AgentCore. Currently file-based, transitioning to HTTP.

#### Current Implementation:
```javascript
class AgentCoreClient {
    async enqueue(command, params) {
        // Write to filesystem queue
        await fs.writeFile(`/queue/tasks/${taskId}`, task);
    }
    
    async waitForResult(taskId) {
        // Poll filesystem for result
        while (!exists(`/queue/results/${taskId}`)) {
            await sleep(200);
        }
        return readResult(taskId);
    }
}
```

#### Future Implementation:
```javascript
class AgentCoreClient {
    async runTask(host, port, command, params) {
        // Direct HTTP call
        return await http.post(`http://${host}:${port}/task`, {
            command, params
        });
    }
}
```

### 5. PloinkyClient (`/client`)

JavaScript SDK for browser and Node.js applications.

```javascript
const client = new PloinkyClient('http://localhost:8000');
await client.login(apiKey);
const result = await client.call('/demo', 'hello', 'world');
```

### 6. CLI (`/cli`)

Command-line interface for system administration.

#### Architecture:
```
p-cli
  ├── lib/cli.js (main entry)
  ├── lib/cloudCommands.js (cloud operations)
  ├── lib/containerManager.js (local containers)
  └── lib/utils.js (shared utilities)
```

## Data Flow Architecture

### Request Flow (Current)

```
1. HTTP Request → Cloud Server
   POST /demo/hello { params: ["world"] }
   
2. Cloud Server → Task Orchestrator
   Create task with security context
   
3. Task Orchestrator → AgentCoreTaskExecutor
   Deployment lookup and validation
   
4. AgentCoreTaskExecutor → AgentCoreClient
   Task enqueuing via filesystem
   
5. Filesystem Queue (Write)
   /agents/localhost/demo/.ploinky/queue/tasks/{taskId}
   
6. AgentCore in Container (Poll & Process)
   Read task → Execute → Write result
   
7. Filesystem Queue (Result)
   /agents/localhost/demo/.ploinky/queue/results/{taskId}
   
8. AgentCoreClient → HTTP Response
   Poll result → Return to client
```

### Request Flow (Future HTTP-based)

```
1. HTTP Request → Cloud Server
   POST /demo/hello { params: ["world"] }
   
2. Cloud Server → Container HTTP
   Direct HTTP call to container port
   
3. Container AgentCore Server
   Process request → Return response
   
4. Cloud Server → HTTP Response
   Forward response to client
```

## Concurrency and Performance

### Concurrent Task Execution

Ploinky supports high-performance parallel task execution through several optimization strategies:

#### Race Condition Prevention

1. **Container Port Management**
   - **Problem**: Multiple processes accessing container ports simultaneously
   - **Solution**: Port caching with validation
   ```javascript
   // Fast path: Check cached port first
   if (fs.existsSync(portFilePath)) {
       const cachedPort = fs.readFileSync(portFilePath, 'utf8').trim();
       if (cachedPort && containerIsRunning) {
           return cachedPort;
       }
   }
   ```

2. **Container Creation Locking**
   - **Mechanism**: Atomic filesystem operations using `mkdir`
   - **Timeout**: 10-second maximum wait with 200ms retry intervals
   - **Lock Directory**: `.ploinky/locks/container_${name}.lock`

3. **Task Queue Management**
   - File-based: Atomic file operations prevent corruption
   - HTTP-based: Native request queuing in Node.js

#### Performance Optimizations

1. **Port Caching**
   - Reduces system calls by 80%
   - Cache location: `.ploinky/running_agents/${container}.port`
   - Validation on each use ensures correctness

2. **Container Reuse**
   - Persistent containers across task executions
   - Warm containers eliminate startup overhead
   - Automatic restart of stopped containers

3. **Parallel Execution Metrics**
   - Sequential tasks: 100% success rate
   - 20 parallel tasks: >95% success rate  
   - 50 parallel tasks: >90% success rate
   - Lock timeout rate: <2% under heavy load

#### Stress Testing Results

```bash
# Test configuration
Tasks: 50 concurrent
Container: Single shared instance
Runtime: Docker/Podman

# Results
Success rate: 92-96%
Average lock wait: 1.2s
Port cache hit rate: 87%
Container start time: 3-5s (first time only)
```

## Component Details

### Deployment Manager (`/cloud/deployment`)

Manages the lifecycle of agent deployments.

```javascript
class DeploymentManager {
    async deployAgent(domain, path, config) {
        // 1. Clone repository
        await gitManager.syncToContainer(repo, branch, codePath);
        
        // 2. Create container configuration
        const containerConfig = {
            image: config.image,
            volumes: [...],
            environment: {...}
        };
        
        // 3. Start container
        await containerManager.ensureContainer(deployment);
        
        // 4. Register deployment
        await config.addDeployment(deployment);
    }
}
```

### Task Executor (`/cloud/task`)

Bridges HTTP requests to container task execution.

```javascript
class AgentCoreTaskExecutor {
    async executeTask(deployment, task) {
        // 1. Ensure container running
        await containerManager.ensureContainer(deployment);
        
        // 2. Get/create client for deployment
        const client = await this.getClient(deployment);
        
        // 3. Enqueue task
        const taskId = await client.enqueue(command, params);
        
        // 4. Wait for result
        return await client.waitForResult(taskId, timeout);
    }
}
```

### Guardian Security (`/cloud/guardian`)

Handles authentication and authorization.

```javascript
class Guardian {
    async authenticateAdminApiKey(apiKey) {
        // Validate API key
        // Generate session token
        // Return auth context
    }
    
    async processRequest(req) {
        // Extract auth token
        // Validate permissions
        // Return security context
    }
}
```

### Configuration Management

Configuration is stored in JSON files with the following structure:

```json
{
    "settings": {
        "serverName": "Ploinky Cloud",
        "logLevel": "info",
        "metricsRetention": 7,
        "enableAuth": false
    },
    "domains": [
        { "name": "localhost", "enabled": true }
    ],
    "repositories": [
        {
            "name": "PloinkyDemo",
            "url": "https://github.com/PloinkyRepos/PloinkyDemo.git",
            "enabled": true
        }
    ],
    "deployments": [
        {
            "domain": "localhost",
            "path": "/demo",
            "agent": "demo",
            "repository": "...",
            "branch": "main",
            "container": "ploinky-localhost-demo"
        }
    ]
}
```

## Security Architecture

### Current State
- Authentication temporarily disabled per requirements
- Basic API key authentication implemented
- Guardian module ready for full security implementation

### Security Layers (When Enabled)

1. **Transport Security**: HTTPS via reverse proxy
2. **Authentication**: API keys and session tokens
3. **Authorization**: Role-based access control
4. **Container Isolation**: Separate namespaces
5. **Resource Limits**: CPU/Memory constraints

### Security Context Flow

```
Request → Guardian.processRequest()
    ├── Extract credentials
    ├── Validate authentication
    ├── Check authorization
    └── Inject security context → Task
```

## Performance Considerations

### Optimization Strategies

1. **Clustering**: Utilize all CPU cores
   ```javascript
   const numWorkers = os.cpus().length;
   ```

2. **File-based Queues**: Efficient for async operations
   - No network overhead
   - Natural persistence
   - Simple recovery

3. **Container Reuse**: Keep containers warm
   ```javascript
   async ensureContainer(deployment) {
       if (exists && running) return;
       // Only create if needed
   }
   ```

4. **Git Caching**: Avoid repeated clones
   ```javascript
   if (cached && recent) {
       return cachedPath;
   }
   ```

### Bottlenecks and Solutions

| Bottleneck | Current Solution | Future Solution |
|------------|-----------------|-----------------|
| Task latency | 200ms polling | HTTP push |
| Container startup | Keep warm | Pre-warmed pool |
| Git operations | Local cache | Shared cache |
| File I/O | Async operations | Memory queue |

## Future Architecture Changes

### 1. HTTP-Based AgentCore (In Progress)

Transitioning from file-based to HTTP-based communication:

```javascript
// Current: File-based
client.enqueue(task) → filesystem → agentCore.poll()

// Future: HTTP-based
client.runTask(task) → HTTP → agentCore.server()
```

### 2. WebSocket Support

Real-time bidirectional communication:

```javascript
const ws = client.subscribe('/demo');
ws.on('message', (data) => {
    // Real-time updates
});
```

### 3. Distributed Architecture

Multi-node deployment capability:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Node 1    │────│   Node 2    │────│   Node 3    │
│  (Master)   │     │  (Worker)   │     │  (Worker)   │
└─────────────┘     └─────────────┘     └─────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                    Shared Storage
```

### 4. Plugin Architecture

Extensible system for custom functionality:

```javascript
class PloinkyPlugin {
    onTaskCreate(task) { /* hook */ }
    onTaskComplete(result) { /* hook */ }
    registerRoutes(router) { /* custom routes */ }
}
```

## Development Guidelines

### Adding New Features

1. **Maintain Modularity**: Keep components independent
2. **Follow Patterns**: Use existing architectural patterns
3. **Document APIs**: Update OpenAPI specs
4. **Test Coverage**: Unit and integration tests
5. **Performance Impact**: Profile before merging

### Code Organization

```
/cloud
  /core         - Core server functionality
  /container    - Container management
  /deployment   - Deployment orchestration
  /task         - Task execution
  /api          - API handlers
  /config       - Configuration management

/cli
  /lib          - CLI implementation
  /templates    - Project templates

/client        - JavaScript SDK
/dashboard     - Web UI
/tests         - Test suites
/docs          - Documentation
```

### Testing Architecture

```
/tests
  /unit        - Component tests
  /integration - System tests
  /e2e         - End-to-end tests
  /performance - Load tests
```

## Metrics and Monitoring

### Key Metrics

- **Request Rate**: Requests per second
- **Error Rate**: Failed requests percentage
- **Task Latency**: Time from submission to completion
- **Container Health**: Running/failed containers
- **Resource Usage**: CPU/Memory/Disk

### Monitoring Architecture

```
Metrics Collector
    ├── Request metrics
    ├── Task metrics
    ├── Container metrics
    └── System metrics
         │
         ▼
    Time-series storage
         │
         ▼
    Dashboard visualization
```

## Conclusion

Ploinky's architecture prioritizes simplicity and efficiency while maintaining flexibility for future enhancements. The modular design allows for incremental improvements without disrupting the core functionality. The ongoing transition to HTTP-based communication will further simplify the architecture while improving performance and debugging capabilities.