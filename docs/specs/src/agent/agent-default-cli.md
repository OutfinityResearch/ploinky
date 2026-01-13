# Agent/default_cli.sh - Minimal Default CLI

## Overview

Minimal default CLI shell script for agent containers. Displays a banner and accepts only the `exit` command. Used when no custom CLI is configured for an agent.

## Source File

`Agent/default_cli.sh`

## Complete Implementation

```bash
#!/bin/sh
# Minimal default CLI that only shows the banner and accepts "exit".

set -u

printf 'Ploinky default CLI\n'

if [ "$#" -gt 0 ] && [ "$1" = "exit" ]; then
  exit 0
fi

print_prompt() {
  printf '> '
}

print_prompt

while true; do
  if ! IFS= read -r line; then
    break
  fi

  if [ "$line" = "exit" ]; then
    break
  fi

  print_prompt
done

exit 0
```

## Behavior

### Command-Line Mode

When called with `exit` argument, immediately exits:

```bash
./default_cli.sh exit
# Exit code: 0
```

### Interactive Mode

When called without arguments or with non-exit arguments:

1. Prints banner: `Ploinky default CLI`
2. Displays prompt: `> `
3. Reads input lines
4. On `exit` command: exits with code 0
5. On EOF (Ctrl+D): exits with code 0
6. On any other input: prints prompt again (ignores input)

```
$ ./default_cli.sh
Ploinky default CLI
> hello
> world
> exit
$
```

## Shell Options

- `set -u`: Exit on undefined variable access (strict mode)

## Process Flow

```
┌─────────────────────────────────────────────────────────┐
│                  Default CLI Flow                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ./default_cli.sh [arg1...]                             │
│       │                                                 │
│       ▼                                                 │
│  printf 'Ploinky default CLI\n'                         │
│       │                                                 │
│       ├── $# > 0 && $1 = "exit" ?                       │
│       │    │                                            │
│       │    ├── Yes: exit 0                              │
│       │    │                                            │
│       │    └── No: continue                             │
│       │                                                 │
│       ▼                                                 │
│  print_prompt                                           │
│       │                                                 │
│       ▼                                                 │
│   ┌─────────────────────────────────────────────────┐   │
│   │  while true; do                                 │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  read -r line                                   │   │
│   │       │                                         │   │
│   │       ├── EOF? ──────────────► break           │   │
│   │       │                                         │   │
│   │       ├── "exit"? ───────────► break           │   │
│   │       │                                         │   │
│   │       └── other: print_prompt                  │   │
│   │              │                                  │   │
│   │              └──────────────────────────────┐   │   │
│   │                                             │   │   │
│   └─────────────────────────────────────────────┘   │   │
│                                                         │
│       ▼                                                 │
│  exit 0                                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Use Cases

### Container Default Shell

Used as fallback shell in agent containers when no custom CLI is configured:

```dockerfile
# In container
COPY default_cli.sh /Agent/default_cli.sh
RUN chmod +x /Agent/default_cli.sh
```

### WebTTY Session

Provides minimal interaction for WebTTY sessions to containers without full CLI:

```
WebTTY Session
┌────────────────────────────────────────┐
│ Ploinky default CLI                    │
│ >                                      │
│ > (waiting for input...)               │
│                                        │
└────────────────────────────────────────┘
```

### Testing Placeholder

Used during development/testing when agent CLI isn't ready:

```bash
# Run agent container with default CLI
docker run -it agent-image /Agent/default_cli.sh
```

## Exit Codes

| Condition | Exit Code |
|-----------|-----------|
| `exit` command | 0 |
| CLI argument `exit` | 0 |
| EOF (Ctrl+D) | 0 |

## Prompt Character

Uses `> ` as the interactive prompt (simple, non-customizable).

## Related Modules

- [server/agent-server.md](./server/agent-server.md) - MCP server
- [server/agent-server-startup.md](./server/agent-server-startup.md) - Supervisor
- [../cli/server/webtty/server-webtty-tty.md](../cli/server/webtty/server-webtty-tty.md) - WebTTY integration
