# bin/psh - Shell Mode Alias

## Overview

Shorthand alias for launching Ploinky in shell mode. Provides the shortest command name for interactive shell sessions.

## Source File

`bin/psh`

## Complete Implementation

```bash
#!/bin/bash

# Alias for Ploinky Shell mode
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
exec "$SCRIPT_DIR/ploinky" sh "$@"
```

## Behavior

Invokes the main ploinky script with `sh` argument:

```bash
# These are equivalent:
psh
ploinky sh
ploinky -shell
ploinky --shell
```

## Purpose

Provides the shortest possible command for shell mode:
- `psh` (3 characters) - "Ploinky SHell"
- Quick access to LLM-assisted shell
- Memorable abbreviation

## Command Flow

```
┌─────────────────────────────────────────────────────────┐
│                       bin/psh                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  psh [args...]                                          │
│       │                                                 │
│       ▼                                                 │
│  exec bin/ploinky sh "$@"                               │
│       │                                                 │
│       ▼                                                 │
│  exec bin/ploinky-shell "$@"                            │
│       │                                                 │
│       ▼                                                 │
│  node cli/shell.js "$@"                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Related Modules

- [bin-ploinky.md](./bin-ploinky.md) - Main CLI entrypoint
- [bin-ploinky-shell.md](./bin-ploinky-shell.md) - Shell mode launcher
