# bin/ploinky - Main CLI Entrypoint

## Overview

Main entrypoint script for the Ploinky CLI. Routes commands to either the Node.js CLI (index.js) or the shell-only mode (shell.js) based on arguments.

## Source File

`bin/ploinky`

## Complete Implementation

```bash
#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
export PLOINKY_ROOT=$(realpath "$SCRIPT_DIR/..")

# Route shell (formerly light) mode explicitly to the dedicated launcher
if [[ "$1" == "-shell" || "$1" == "sh" || "$1" == "--shell" ]]; then
    shift
    exec "$SCRIPT_DIR/ploinky-shell" "$@"
fi

# Construct the path to the Node.js script
NODE_SCRIPT="$SCRIPT_DIR/../cli/index.js"

# Execute the Node.js script with all passed arguments
node "$NODE_SCRIPT" "$@"
```

## Behavior

### Standard Mode

When called without shell flags, executes the full Node.js CLI:

```bash
# Full CLI mode
ploinky start my-agent
ploinky list
ploinky connect agent-name
```

Executes: `node cli/index.js [args...]`

### Shell Mode

When called with `-shell`, `sh`, or `--shell`, routes to shell-only mode:

```bash
# Shell mode
ploinky sh
ploinky -shell
ploinky --shell
```

Executes: `bin/ploinky-shell [remaining args...]`

## Environment Variables

| Variable | Description | Set By |
|----------|-------------|--------|
| `PLOINKY_ROOT` | Absolute path to project root | This script |

## Command Flow

```
┌─────────────────────────────────────────────────────────┐
│                   bin/ploinky                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ploinky [args...]                                      │
│       │                                                 │
│       ├── $1 == -shell/sh/--shell ?                     │
│       │    │                                            │
│       │    ├── Yes: shift                               │
│       │    │        exec ploinky-shell "$@"             │
│       │    │                                            │
│       │    └── No: node cli/index.js "$@"               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Aliases

The following scripts are aliases to this entrypoint:
- `bin/p-cli` - Alias wrapper
- `bin/psh` - Shell mode alias

## Related Modules

- [bin-ploinky-shell.md](./bin-ploinky-shell.md) - Shell mode launcher
- [bin-p-cli.md](./bin-p-cli.md) - CLI alias
- [../cli/cli-main.md](../cli/cli-main.md) - Node.js CLI entry
- [../cli/shell-integration.md](../cli/shell-integration.md) - Shell integration
