# Ploinky Cloud: System Specifications

## Overview

Ploinky Cloud is a lightweight, Node.js-based application environment designed to replace the need for Docker Compose or Kubernetes for specific use cases. It operates on the principle of deploying standardized, containerized "Ploinky Agents" to specific URL paths, effectively creating microservices. The entire system is built to be modular, adhere to SOLID principles, and minimize external dependencies.

---

## 1. Core Architecture & Concepts

* **Primary Goal**: To provide a simplified deployment environment where developers can launch services (Agents) by mapping them to URL paths (`hostname/path`).
* **Core Technology**: The system is a **Node.js HTTP server** running in **clustered mode** for resilience and performance.
* **The "Ploinky Agent"**: The fundamental unit of deployment. An Agent is a **Linux container** that runs a specific service. A host directory, containing the agent's code and its task queue, is mapped as a volume into the container.
* **Communication Model**: Communication between the cloud server and the agents is **asynchronous and file-system-based**. Instead of direct API calls, the server places "task" files in a queue directory, which the agent processes.

---

## 2. The Ploinky Cloud Server

This is the central process that manages everything.

* **HTTP Server**: Listens for incoming web requests on a configurable port (defaulting to `8000`).
* **Request Routing**: It routes incoming requests for a specific `hostname/path` to the corresponding deployed agent.
* **Task Orchestrator**:
  * Transforms incoming HTTP requests into "task" files.
  * Places these task files into the appropriate agent's request queue (`./.tasks/requests/`).
  * Monitors the agent's response queue (`./.tasks/responses/`) for completed tasks.
  * When a response file appears, it sends the data back to the original HTTP client, records monitoring information, and then deletes the request and response files.
* **Agent Supervisor**: Includes a component that continuously monitors the health of deployed agents, ensuring they are running and responsive. It will restart agents if they fail.
* **Guardian (Security Middleware)**: An internal component that intercepts *all* incoming requests before they are converted into tasks. Its primary role is to handle authentication and authorization.

---

## 3. Agent Communication & Task Flow

The interaction between the client, server, and agent follows a specific, file-based queuing pattern. Each deployed agent has a `.tasks` directory with the following structure:

* `./.tasks/requests/`: Incoming tasks are placed here as individual files.
* `./.tasks/responses/`: The agent places the results of completed tasks here.
* `./.tasks/errors/`: The agent places error responses here when a task fails.
* `./.tasks/locks/`: A directory-based locking mechanism (`mkdir`) is used here to prevent race conditions when accessing task files. A lock is a directory named after the task ID.
* `./.tasks/urgent/`: For high-priority commands, such as cancelling a task. For example, if the server detects a client has disconnected, it can place an empty file named with the task ID here to signal the agent to stop processing.

### Task & Command Structure

* **Task File**: A file whose name is a cryptographically unique UID. It contains the command details.
* **Command**: The instruction within a task. It has a namespaced format: `"prefix.name"` (e.g., `"database.query"`, `"user.create"`).
* **Parameters**: Commands are variadic (`varargs`). All parameters sent from the client are passed to the agent's command handler.
  * **`runForUserId`**: The first parameter is a special, reserved identifier. The **Guardian** component *always* injects this parameter, identifying the user on whose behalf the task should be executed.

### Error Handling

When an agent encounters an error processing a task:
1. It creates an error response file in `./.tasks/errors/` with the same task ID
2. The error file contains a JSON object with the structure:
   ```json
   {
     "error": true,
     "message": "Human-readable error message",
     "code": "ERROR_CODE",
     "details": {} // Optional additional error details
   }
   ```

---

## 4. Specialized Agents

Two types of agents have special, system-level roles.

### Security Agent
* **Path**: Deployed to the reserved path `/auth`.
* **Function**: Manages user authentication and authorization.
* **`login` Command**: It must handle a special `"login"` command. This command receives credentials and, upon success, must return a standard JSON object: 
  ```json
  {
    "userId": "someUserId",
    "authorizationToken": "some_opaque_token"
  }
  ```
* **Special Response**: Can return the token "Admin" to grant full permissions.
* **Cookie Management**: The Ploinky Cloud server takes this response, sets the `authorizationToken` in a client cookie, and uses it for subsequent requests.

### Static Agent
* **Path**: Automatically handles *all* paths that do not have another agent explicitly deployed to them.
* **Function**: Serves static files (e.g., HTML, CSS, images) from its mapped directory, enabling the hosting of front-end applications.

---

## 5. The Guardian (Security Layer)

This is a crucial internal middleware component of the Ploinky Cloud server.

1. It intercepts every incoming request.
2. It inspects the request for an `authorizationToken` cookie.
3. If a token is present:
   * It looks up the token in the `./activeUsers/` directory
   * Each active user has a JSON file containing their permissions:
     ```json
     {
       "userId": "user123",
       "allowedCommands": ["user.read", "user.update", "data.query"],
       "expiresAt": "2024-12-31T23:59:59Z"
     }
     ```
   * If the token is "Admin", all commands are allowed
4. It then injects the `userId` as the `runForUserId` parameter into the command.
5. If no `/auth` agent is configured, or if the user is not logged in, it injects a default value of `"InternetUser"`.
6. The agent itself is ultimately responsible for refusing to execute a task if the `runForUserId` does not have sufficient permissions.

---

## 6. Client-Side Interaction (PloinkyClient)

* **Purpose**: A simple JavaScript library that abstracts away the HTTP calls and the asynchronous task-based nature of the backend.
* **Functionality**: It allows a front-end developer to configure a client instance that maps remote agent commands to local JavaScript methods.
* **Developer Experience**: The goal is for the developer to feel as though they are calling methods on a local class, e.g., `ploinky.user.create('JohnDoe', 'password123')`, which the client translates into the appropriate HTTP request to the Ploinky Cloud server.

---

## 7. Management & Monitoring (ManagementUI)

This is a web interface served from the reserved `/management` path for administering the cloud.

### Configuration
* **Agent Repositories**: Configure Git repository URLs where agent definitions can be found.
* **Domains**: Configure the hostnames (e.g., `api.myapp.com`, `localhost`) that the cloud will respond to.
* **Deployments**: Deploy an agent from a repository to a specific path on a configured domain.
* **Storage**: All configuration is stored in a single `./config.json` file that can be edited through the UI.

### Dashboard
* **Metrics**: Displays real-time and historical operational data.
* **Data Points**:
  * Total call count per agent (filterable by hostname).
  * Average, min, and max execution duration per agent.
  * Average, min, and max execution duration per command type within an agent.
* **Data Storage**: Metrics are held in memory as time-series data and are periodically flushed to disk for persistence.

### Administrator Access
* Authentication is required to access the ManagementUI.
* An administrator password hash (using **bcrypt** or a similar strong algorithm) is stored in a file named `.admin` in the root agent deployment directory.
* This file can contain multiple admin keys.
* The UI must provide a way for an authenticated administrator to change their password (requiring the old password).

---

## 8. Task Queue Strategy Pattern

The task queue system is implemented using the **Strategy Pattern** to allow for future scalability:

### FileSystemTaskQueue (Default Implementation)
* Uses the local file system for task storage
* Suitable for single-server deployments
* Simple and reliable for development and small-scale production

### Future Strategy Implementations (Planned)
* **RedisTaskQueue**: For distributed task processing
* **RabbitMQTaskQueue**: For enterprise-grade message queuing
* **KafkaTaskQueue**: For high-throughput event streaming

### TaskQueue Interface
```javascript
interface TaskQueue {
  enqueue(agentPath, task);
  dequeue(agentPath);
  markComplete(agentPath, taskId, response);
  markError(agentPath, taskId, error);
  cancel(agentPath, taskId);
}
```

---

## 9. Project Structure & Deployment

### Code Repository Structure

```
/ploinky
├── /bin
│   └── p-cloud         # The main executable script
├── /cloud              # Source code for the Ploinky Cloud server
│   ├── /core          # Core server components
│   ├── /guardian      # Security middleware
│   ├── /supervisor    # Agent health monitoring
│   └── /taskQueue     # Task queue strategies
├── /client            # Source code for the PloinkyClient JS library
├── /dashboard         # Source code for the ManagementUI/Dashboard
└── /agentCore         # Common code for all agents
    ├── run.sh         # Standard entry point
    └── /lib           # Task handling libraries
```

### Operational Details

* **`p-cloud` script**: The command-line tool to start the server. It can accept a port argument (`p-cloud --port 8080`), defaulting to `8000`.
* **Agent Deployments**: When started, `p-cloud` uses the current working directory as the root for deploying agents. Agent files are stored in subdirectories named `domain/url_path`. A special `agents` directory can be used during development and should be added to `.gitignore`.
* **`agentCore`**: This directory contains a standard library for agents to handle the task queue mechanics (locking, reading requests, writing responses). It is **automatically mapped** as a volume to `/agentCore` inside every running agent container. The standard entry point for an agent is `/agentCore/run.sh <specificCommand>`.
* **Default Configuration**: On first run, it creates a default host named `localhost` and is configured with an initial agent repository: `https://github.com/PloinkyRepos/PloinkyDemo.git`.

### Agent Repository Structure

An agent repository is a Git repository containing one or more directories, where each directory is an agent. Each agent directory must contain a `manifest.json`.

**`manifest.json` example**:
```json
{
  "container": "docker.io/library/ubuntu:latest",
  "install": "apt-get update && apt-get install -y some-package",
  "update": "git pull",
  "run": "/agentCore/run.sh",
  "about": "A description of what this agent does.",
  "commands": {
    "user.create": "node handlers/createUser.js",
    "user.update": "node handlers/updateUser.js",
    "user.delete": "node handlers/deleteUser.js"
  }
}
```

**Additional Files**: Any other files or subdirectories in the agent's folder in the repository will be copied into the agent's deployment directory upon installation.

---

## 10. Development Workflow

1. **Local Development**:
   ```bash
   # Start the cloud server
   p-cloud --port 8000
   
   # Access the management UI
   open http://localhost:8000/management
   ```

2. **Deploy an Agent**:
   * Add repository in Management UI
   * Select agent from repository
   * Map to domain/path
   * Deploy

3. **Test the Agent**:
   ```javascript
   // Using PloinkyClient
   const client = new PloinkyClient('http://localhost:8000');
   const result = await client.call('myagent', 'command.name', arg1, arg2);
   ```

---

## 11. Security Considerations

* **Authentication**: Handled by the Security Agent at `/auth`
* **Authorization**: Token-based with command-level permissions
* **Admin Access**: Separate admin authentication for Management UI
* **Container Isolation**: Each agent runs in its own container
* **Network Isolation**: Agents communicate only through task queues
* **Input Validation**: Each agent is responsible for validating its inputs

---

## 12. Future Iterations

The following features are planned for future releases:

* **Agent-to-Agent Communication**: Direct internal communication mechanism
* **External Database Connections**: Agents connecting to external databases
* **Horizontal Scaling**: Multi-machine deployment with shared task queue
* **WebSocket Support**: Real-time bidirectional communication
* **Agent Marketplace**: Public repository of reusable agents
* **Monitoring Plugins**: Integration with external monitoring systems

---

## Implementation Notes

* **Error Handling**: Comprehensive error handling at all levels
* **Logging**: Structured logging for debugging and auditing
* **Testing**: Unit tests for core components, integration tests for workflows
* **Documentation**: Inline code documentation and user guides
* **Performance**: Optimize for low latency and high throughput
* **Modularity**: Keep components loosely coupled and easily replaceable

---

## Version History

* **v1.0.0** - Initial specification
* **Date**: December 2024
* **Author**: Ploinky Team

---

This specification serves as the foundation for the Ploinky Cloud implementation. It will be updated as the system evolves and new requirements emerge.