# Agent/server/AgentServer.sh - Agent Supervisor Script

## Overview

Supervisor shell script for the AgentServer MCP server. Manages process lifecycle with automatic restart on failure. Optionally wraps a custom agent application command.

## Source File

`Agent/server/AgentServer.sh`

## Complete Implementation

```bash
#!/bin/sh
# AgentServer.sh
# Behavior:
# - If a command (the agent app) is provided as arguments, set CHILD_CMD to that command
#   and supervise AgentServer.mjs which will invoke CHILD_CMD on each request with a base64 payload.
# - If no command is provided, supervise AgentServer.mjs which replies with {ok:false, error:'not implemented'}.

if [ $# -gt 0 ]; then
  export CHILD_CMD="$@"
  echo "[AgentServer.sh] Supervising AgentServer.mjs with child command: $CHILD_CMD"
else
  echo "[AgentServer.sh] No custom app provided. Supervising default AgentServer.mjs on port ${PORT:-7000}"
fi

while :; do
  node /Agent/server/AgentServer.mjs
  code=$?
  echo "[AgentServer.sh] AgentServer.mjs exited with code $code. Restarting in 60s..."
  sleep 60
done
```

## Behavior

### With Custom Command

When arguments are provided, the script:
1. Sets `CHILD_CMD` environment variable to the full command
2. Logs the supervised command
3. Starts `AgentServer.mjs` which will invoke `CHILD_CMD` for tool/resource requests
4. Restarts on exit after 60 second delay

```bash
# Example: supervise a Python agent
./AgentServer.sh python /code/agent.py

# CHILD_CMD will be set to "python /code/agent.py"
```

### Without Custom Command

When no arguments provided:
1. Logs that default mode is being used
2. Starts `AgentServer.mjs` on configured port (default 7000)
3. Agent responds to tools with `{ok:false, error:'not implemented'}`
4. Restarts on exit after 60 second delay

```bash
# Default mode - no tool implementations
./AgentServer.sh
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 7000 |
| `CHILD_CMD` | Custom command (set by script) | - |

## Process Flow

```
┌─────────────────────────────────────────────────────────┐
│                  Supervisor Flow                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ./AgentServer.sh [cmd...]                              │
│       │                                                 │
│       ├── $# > 0 ?                                      │
│       │    │                                            │
│       │    ├── Yes: export CHILD_CMD="$@"               │
│       │    │        Log "with child command"            │
│       │    │                                            │
│       │    └── No:  Log "No custom app"                 │
│       │             (use default on PORT)               │
│       │                                                 │
│       ▼                                                 │
│   ┌─────────────────────────────────────────────────┐   │
│   │  while :; do                                    │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  node /Agent/server/AgentServer.mjs            │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  (process exits with code $?)                  │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  Log exit code                                  │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  sleep 60                                       │   │
│   │       │                                         │   │
│   │       └──────────────────────┐                  │   │
│   │                              │ (loop forever)   │   │
│   └──────────────────────────────┘                  │   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Restart Policy

- **Delay**: 60 seconds between restarts
- **Condition**: Always restart (infinite loop)
- **Exit code**: Logged but doesn't affect restart behavior

## Container Integration

Typically used as Docker/Podman container entrypoint:

```dockerfile
ENTRYPOINT ["/Agent/server/AgentServer.sh"]
CMD []
```

With custom agent:
```dockerfile
ENTRYPOINT ["/Agent/server/AgentServer.sh"]
CMD ["python", "/code/agent.py"]
```

## Logging

All logs prefixed with `[AgentServer.sh]`:
- `Supervising AgentServer.mjs with child command: <cmd>` - Custom mode
- `No custom app provided. Supervising default AgentServer.mjs on port <port>` - Default mode
- `AgentServer.mjs exited with code <code>. Restarting in 60s...` - On exit

## Related Modules

- [agent-server.md](./agent-server.md) - The supervised Node.js server
- [agent-default-cli.md](../agent-default-cli.md) - Default CLI for interactive use
