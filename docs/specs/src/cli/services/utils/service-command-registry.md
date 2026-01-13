# cli/services/commandRegistry.js - Command Registry

## Overview

Defines and manages the registry of all available Ploinky CLI commands. Provides a frozen command map for tab completion and command validation.

## Source File

`cli/services/commandRegistry.js`

## Dependencies

None (pure JavaScript module)

## Constants & Configuration

```javascript
/**
 * Raw commands definition - maps command names to their subcommands
 * Each command can have zero or more subcommands
 */
const rawCommands = {
    add: ['repo'],
    refresh: ['agent'],
    enable: ['repo', 'agent'],
    disable: ['repo', 'agent'],
    shell: [],
    cli: [],
    start: [],
    restart: [],
    clean: [],
    status: [],
    shutdown: [],
    stop: [],
    destroy: [],
    list: ['agents', 'repos', 'routes'],
    webconsole: [],
    webtty: [],
    webmeet: [],
    '/settings': [],
    settings: [],
    client: ['methods', 'status', 'list', 'task', 'task-status'],
    logs: ['tail', 'last'],
    expose: [],
    var: [],
    vars: [],
    echo: [],
    help: [],
    profile: ['list', 'validate', 'show']
};

// Freeze all subcommand arrays to prevent modification
for (const key of Object.keys(rawCommands)) {
    const value = rawCommands[key];
    if (Array.isArray(value)) {
        rawCommands[key] = Object.freeze([...value]);
    }
}

// Create immutable command registry
const COMMANDS = Object.freeze({ ...rawCommands });
```

## Data Structures

```javascript
/**
 * Command registry structure
 * @typedef {Object.<string, string[]>} CommandRegistry
 * Maps command names to arrays of valid subcommands
 *
 * Example:
 * {
 *   'start': [],           // No subcommands
 *   'list': ['agents', 'repos', 'routes'],  // Has subcommands
 *   'enable': ['repo', 'agent'],
 *   'client': ['methods', 'status', 'list', 'task', 'task-status']
 * }
 */
```

## Public API

### getCommandRegistry()

**Purpose**: Returns the frozen command registry for use in completion and validation

**Returns**: `CommandRegistry` - Immutable map of commands to subcommands

**Implementation**:
```javascript
function getCommandRegistry() {
    return COMMANDS;
}
```

### isKnownCommand(commandName)

**Purpose**: Checks if a command name is in the registry

**Parameters**:
- `commandName` (string): The command name to check

**Returns**: (boolean) True if command is known

**Implementation**:
```javascript
function isKnownCommand(commandName) {
    if (!commandName) return false;
    return Object.prototype.hasOwnProperty.call(COMMANDS, commandName);
}
```

## Command Categories

### Repository/Agent Management
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `add` | `repo` | Add repository |
| `refresh` | `agent` | Refresh agent |
| `enable` | `repo`, `agent` | Enable repo/agent |
| `disable` | `repo`, `agent` | Disable repo/agent |

### Container Operations
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `shell` | (none) | Open shell in container |
| `cli` | (none) | Run CLI command in container |
| `start` | (none) | Start workspace |
| `restart` | (none) | Restart components |
| `stop` | (none) | Stop containers |
| `shutdown` | (none) | Stop and remove containers |
| `destroy` | (none) | Destroy all containers |
| `clean` | (none) | Alias for destroy |

### Information Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `list` | `agents`, `repos`, `routes` | List items |
| `status` | (none) | Show workspace status |
| `logs` | `tail`, `last` | View logs |

### Web Interface Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `webconsole` | (none) | WebTTY alias |
| `webtty` | (none) | Configure WebTTY |
| `webmeet` | (none) | Configure WebMeet |

### MCP Client Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `client` | `methods`, `status`, `list`, `task`, `task-status` | MCP operations |

### Environment Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `expose` | (none) | Expose env var |
| `var` | (none) | Get/set variable |
| `vars` | (none) | List variables |
| `echo` | (none) | Echo with expansion |

### Configuration Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `/settings` | (none) | Open settings menu |
| `settings` | (none) | Alias for /settings |
| `profile` | `list`, `validate`, `show` | Profile management |

### Other
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `help` | (none) | Show help |

## Usage Example

```javascript
import { getCommandRegistry, isKnownCommand } from './services/commandRegistry.js';

// Get registry for tab completion
const commands = getCommandRegistry();
console.log(Object.keys(commands)); // All command names
console.log(commands.list); // ['agents', 'repos', 'routes']

// Validate a command
if (isKnownCommand('start')) {
    console.log('start is a valid command');
}

if (!isKnownCommand('foo')) {
    console.log('foo is not a known command');
}
```

## Security Considerations

- Registry is frozen to prevent runtime modification
- Subcommand arrays are frozen individually
- `hasOwnProperty.call` prevents prototype pollution attacks

## Integration Points

- Used by `cli/index.js` for tab completion
- Used by `commands/cli.js` for command validation
- Used by help system for command listing

## Related Modules

- [cli-main.md](../../cli-main.md) - Uses registry for completion
- [commands-cli.md](../../commands/commands-cli.md) - Uses for validation
- [service-help.md](./service-help.md) - Uses for help generation
