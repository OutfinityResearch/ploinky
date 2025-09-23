# Ploinky: A Containerized Development Environment and Microservices Manager

## 1. High-Level Summary

Ploinky is a command-line-driven system for managing containerized development environments and orchestrating microservices. It leverages Docker to create isolated, reproducible environments defined by simple JSON configuration files (`manifest.json`). It is designed to be a lightweight, Node.js-based platform for developers to easily define, share, and run complex services. The system is built around the concept of "agents," which are self-contained services running within Docker containers.

## 2. Core Concepts

### Agents
An "agent" is the fundamental unit in Ploinky. It represents a single, containerized service or tool. Each agent is defined by a `manifest.json` file and runs inside a Docker container. Agents can be anything from a development environment (like `python-dev`) to a microservice, a database, or a command-line tool.

### Manifests (`manifest.json`)
The `manifest.json` file is the heart of an agent. It's a JSON file that declares how the agent should be built, configured, and run. While the exact schema may vary, a typical manifest includes:

- **`container`**: The base Docker image for the agent (e.g., `ubuntu:22.04`).
- **`install`**: A shell command or script to be executed once to set up the environment and install dependencies.
- **`update`**: A command to update the agent's dependencies.
- **`run`**: The default command to execute when the agent is started. This is often a long-running process or server.
- **`shell`**: The command to start an interactive shell within the agent's container (e.g., `/bin/bash`).
- **`about`**: A brief description of the agent.
- **`ports`**: A mapping of ports to expose from the container to the host.

*Example `manifest.json` for a Python development agent:*
```json
{
  "container": "python:3.10-slim",
  "install": "pip install numpy pandas flask",
  "update": "pip install --upgrade numpy pandas flask",
  "run": "flask run --host=0.0.0.0",
  "shell": "/bin/bash",
  "about": "A Python development environment with scientific computing libraries and Flask.",
  "ports": {
    "5000/tcp": 5000
  }
}
```

### Repositories
Agents are organized into "repositories." A repository is simply a directory containing a collection of agent directories. This allows for logical grouping of agents (e.g., a `basic` repo for common tools, a `databases` repo for databases). Users can add, remove, enable, and disable repositories to customize their Ploinky environment.

## 3. Architecture

Ploinky's architecture consists of three main components that work together:

1.  **Ploinky CLI (`ploinky`)**: This is the primary user interface, implemented in Node.js (`cli/index.js`). It is responsible for:
    - Parsing user commands.
    - Managing agent repositories and manifests.
    - Interacting with the Docker daemon to create, start, stop, and manage container lifecycles.
    - Communicating with agents running inside containers.
    - Providing interactive shells using `node-pty`.

2.  **Docker**: Ploinky uses Docker as its container runtime. It automates the process of pulling Docker images, creating containers, running commands inside them, and managing networking and storage.

3.  **AgentServer**: A lightweight Node.js HTTP server (`Agent/AgentServer.mjs`) that runs inside the agent's container. It acts as a generic entry point for the CLI to send commands to the agent. When the CLI needs to execute a command within a running agent, it sends an HTTP request with a JSON payload to the `AgentServer`. The `AgentServer` then executes a pre-configured shell command (`CHILD_CMD`) with the payload, allowing for dynamic control over the containerized service.

4.  **LLMClient**: A crucial component (`Agent/LLMClient.mjs`) that provides a unified interface for interacting with various third-party Large Language Models (LLMs). It acts as an abstraction layer, allowing other parts of the Ploinky system to make calls to different LLMs (e.g., from OpenAI, Google, Anthropic) without needing to know the specifics of each provider's API. It uses a central `models.json` configuration file to map specific model names to their respective providers and API endpoints. This modular design enables Ploinky agents to easily incorporate advanced AI and natural language processing capabilities.

### Interaction Flow (Example: `ploinky shell python-dev`)

1.  The user types `ploinky shell python-dev` in their terminal.
2.  The **Ploinky CLI** parses the command.
3.  It searches the enabled repositories for an agent named `python-dev` and reads its `manifest.json`.
4.  It instructs **Docker** to start a container based on the `container` image specified in the manifest. If the container already exists, it starts the existing one.
5.  The CLI then executes the `shell` command from the manifest (`/bin/bash`) inside the container, attaching the user's terminal to it using `node-pty` to provide an interactive session.

## 4. Key Functionality & Commands

The `ploinky` CLI provides a rich set of commands for managing the entire lifecycle of agents and environments:

-   **Repository Management**: `add repo`, `disable repo` - Manage sources of agents.
-   **Agent Management**: `list agents`, `enable agent`, `refresh agent` - Manage individual agents.
-   **Lifecycle Control**: `start`, `stop`, `restart`, `shutdown`, `destroy` - Full control over container lifecycles.
-   **Interactive Sessions**: `shell`, `cli`, `run` - Execute commands or get an interactive shell inside an agent.
-   **Web Interfaces**: `webtty`, `webmeet`, `webconsole` - Provides browser-based access to terminals and other services.
-   **Status and Logging**: `status`, `logs` - Monitor the state and output of agents.

## 5. Keywords for LLMs

-   Container orchestration
-   Containerized development environments
-   Docker management
-   Reproducible builds
-   Development environment as code
-   `manifest.json`
-   Ploinky
-   Agent-based microservices
-   Node.js CLI tool
-   Developer tools
-   Isolated environments
-   `node-pty`
-   AgentServer
-   CLI container management
