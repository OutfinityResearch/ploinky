# bin/p-cli - CLI Alias Script

## Overview

Alias script for the main Ploinky CLI. Provides a shorter command name for convenience.

## Source File

`bin/p-cli`

## Complete Implementation

```bash
#!/bin/bash

# p-cli is an alias to ploinky command
# Get the directory where the script is located
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")

# Execute ploinky with all passed arguments
"$SCRIPT_DIR/ploinky" "$@"
```

## Behavior

Simply forwards all arguments to the main `ploinky` script:

```bash
# These are equivalent:
p-cli start my-agent
ploinky start my-agent

p-cli list
ploinky list
```

## Purpose

Provides a shorter command name for users who prefer brevity:
- `p-cli` (6 characters) vs `ploinky` (7 characters)
- Memorable as "Ploinky CLI"

## Command Flow

```
┌─────────────────────────────────────────────────────────┐
│                      bin/p-cli                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  p-cli [args...]                                        │
│       │                                                 │
│       ▼                                                 │
│  exec bin/ploinky "$@"                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Related Modules

- [bin-ploinky.md](./bin-ploinky.md) - Main CLI entrypoint
