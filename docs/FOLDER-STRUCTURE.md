# Ploinky Folder Structure Documentation

## Overview

Ploinky uses two main configuration directories to separate CLI and Cloud concerns:
- `.ploinky/` - CLI configuration and local agent management
- `.ploinky-cloud/` - Cloud server runtime data and agent containers

## Directory Structure

### `.ploinky/` (CLI Configuration)
This directory contains configuration for the Ploinky CLI (`p-cli`):

```
.ploinky/
├── admin_api_keys.json    # API keys for cloud admin access
├── .agents                 # Local agent registry
├── .secrets                # Encrypted secrets storage
├── cloud.json             # Cloud connection settings
└── repos/                 # Local repository clones (for CLI)
    └── PloinkyAgents/     # Example cloned repository
```

**Purpose**: Stores CLI configuration, authentication, and local development settings.

### `.ploinky-cloud/` (Cloud Runtime)
This directory contains all runtime data for Ploinky Cloud server:

```
.ploinky-cloud/
├── config.json            # Cloud server configuration
├── activeUsers/           # Active user sessions
│   └── {sessionHash}.json # Individual session data
├── agents/                # Individual agent deployments (virtual hosts)
│   └── {domain}/
│       └── {path}/        # Specific agent instance workspace
│           ├── code/      # Deployed agent code (copied from repo)
│           ├── tasks/     # Task queue for this instance
│           └── responses/ # Task responses
├── logs/                  # Server logs
│   └── p-cloud-{date}.log # Daily log files
├── metrics/               # Performance metrics
│   └── metrics-{date}.json # Daily metrics snapshots
├── repos/                 # GLOBAL repository clones (shared source)
│   ├── PloinkyDemo/       # Cloned repository
│   │   ├── demoAPI/       # Agent available in this repo
│   │   └── static/        # Another agent in this repo
│   └── Basic/             # Another cloned repository
│       ├── bash/          # Agent folder with manifest.json
│       ├── node-dev/      # Agent folder with manifest.json
│       └── python-dev/    # Agent folder with manifest.json
└── agentCore/             # Node.js server for task handling in containers
    ├── server.js          # Main task server
    └── lib/               # Server libraries
```

**Important Distinction**:
- `repos/` contains GLOBAL repository clones - these are the source templates
- `agents/{domain}/{path}/` contains INDIVIDUAL agent deployments - each is a separate instance

**Purpose**: Stores all cloud server runtime data, agent deployments, and operational logs.

## Agent Container Architecture

### Volume Mounts
When an agent is deployed in a container, it has the following volume mounts:

**For Repository-based Agents:**
```
Container Volumes:
- /code         → .ploinky-cloud/repos/{repo_name}/{agent_folder} (read-only)
                  Direct mount from global repository clone
                  
- /agentCore    → .ploinky-cloud/agentCore (read-only)
                  Contains the Node.js server that handles tasks
```

**For Custom Deployed Agents:**
```
Container Volumes:
- /code         → .ploinky-cloud/agents/{domain}/{path}/code (read-only)
                  Agent's individual deployment folder
                  
- /agentCore    → .ploinky-cloud/agentCore (read-only)
                  Contains the Node.js server that handles tasks
```

### Agent Workspace Structure
Inside each container, the agent sees:

```
/code/                     # Agent's code from repository (read-only)
├── manifest.json          # Agent configuration
├── run.sh                 # Optional run script
└── {agent files}          # Other agent-specific files

/agentCore/                # Task execution server (read-only)
├── server.js              # Main server handling task requests
├── lib/                   # Server libraries
└── run.sh                 # Server startup script
```

### Environment Variables
Each container receives:
- `CODE_DIR=/code` - Path to agent code
- `RUN_TASK=/code/{script}` - Optional task runner script
- `PORT=7070` - Internal port for task server

## Data Isolation

### Per-Agent Isolation
Each agent container is completely isolated:
- Has its own filesystem
- Cannot access other agents' data
- Runs with minimal privileges
- Code mounted as read-only

### Repository Management
- Repositories are cloned once in `.ploinky-cloud/repos/`
- Multiple agents can reference the same repository
- Each agent only sees its specific folder from the repository

## File Permissions

### Security Considerations
- `.ploinky/admin_api_keys.json` - Should be readable only by owner (600)
- `.ploinky-cloud/activeUsers/` - Contains session tokens, should be protected
- Agent code volumes are mounted read-only to prevent modification
- Only the task queue can be written by containers

## Migration Notes

When upgrading Ploinky:
1. All cloud files should be in `.ploinky-cloud/`
2. CLI configuration remains in `.ploinky/`
3. Admin API keys stay in `.ploinky/` (not in `.ploinky-cloud/`)
4. Each agent's workspace is isolated in containers