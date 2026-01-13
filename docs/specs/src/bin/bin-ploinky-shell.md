# bin/ploinky-shell - Shell-Only Mode Launcher

## Overview

Shell-only Ploinky entrypoint that surfaces LLM recommendations without the full CLI features. Provides a lightweight interactive mode focused on AI-assisted command suggestions.

## Source File

`bin/ploinky-shell`

## Complete Implementation

```bash
#!/bin/bash

# Shell-only Ploinky entrypoint that only surfaces LLM recommendations.
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
NODE_SCRIPT="$SCRIPT_DIR/../cli/shell.js"

node "$NODE_SCRIPT" "$@"
```

## Behavior

Launches the Node.js shell integration script directly:

```bash
ploinky-shell
# Enters interactive shell with LLM recommendations
```

Executes: `node cli/shell.js [args...]`

## Purpose

The shell-only mode provides:
- Interactive LLM-powered command recommendations
- Lightweight alternative to full CLI
- AI assistant for shell operations
- No agent management overhead

## Usage

### Direct Invocation

```bash
./bin/ploinky-shell
```

### Via Main CLI

```bash
ploinky sh
ploinky -shell
ploinky --shell
```

### Via Alias

```bash
psh
```

## Command Flow

```
┌─────────────────────────────────────────────────────────┐
│                  bin/ploinky-shell                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ploinky-shell [args...]                                │
│       │                                                 │
│       ▼                                                 │
│  node cli/shell.js "$@"                                 │
│       │                                                 │
│       ▼                                                 │
│  Interactive LLM shell session                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Related Modules

- [bin-ploinky.md](./bin-ploinky.md) - Main CLI entrypoint
- [bin-psh.md](./bin-psh.md) - Shell mode alias
- [../cli/shell-integration.md](../cli/shell-integration.md) - Shell integration implementation
