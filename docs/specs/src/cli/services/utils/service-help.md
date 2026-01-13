# cli/services/help.js - Help System Service

## Overview

Provides the help system for the Ploinky CLI. Displays command overviews and detailed help for specific commands with syntax, parameters, examples, and notes.

## Source File

`cli/services/help.js`

## Public API

### showHelp(args)

**Purpose**: Displays help information

**Parameters**:
- `args` (string[]): Optional topic path [command, subcommand, subsubcommand]

**Behavior**:
- No args: Shows main help overview
- With topic: Shows detailed help for that command

**Implementation**:
```javascript
export function showHelp(args = []) {
    const topic = args[0];
    const subtopic = args[1];
    const subsubtopic = args[2];

    if (topic) {
        if (topic === 'cloud') {
            console.log('Cloud commands are not available in this build.');
            return;
        }
        return showDetailedHelp(topic, subtopic, subsubtopic);
    }

    // Main help overview
    console.log(`
╔═══ PLOINKY ═══╗ Container Development & Cloud Platform

▶ LOCAL DEVELOPMENT
  add repo <name> [url]          Add repository
  update repo <name>             Pull latest changes
  start [staticAgent] [port]     Start agents and Router
  shell <agentName>              Open interactive sh in container
  cli <agentName> [args...]      Run manifest "cli" command
  webtty [shell] [--rotate]      Prepare WebTTY
  webchat [--rotate]             Show or rotate WebChat token
  webmeet [mod] [--rotate]       Show WebMeet token
  dashboard [--rotate]           Show Dashboard token
  sso enable|disable|status      Configure SSO
  vars                           List all variables
  var <VAR> <value>              Set a variable
  echo <VAR|$VAR>                Print variable value
  expose <ENV_NAME> [value] [agent]  Expose to agent
  list agents | repos            List agents or repos

▶ CLIENT OPERATIONS
  client tool <name>             Invoke MCP tool
  client list tools              Aggregate tools
  client list resources          Aggregate resources
  client status <agent>          Agent status

  status | restart               Show state | restart
  stop | shutdown | clean        Stop | remove containers
  logs tail [router]             Follow router logs
  logs last <N>                  Show last N log lines

▶ FOR DETAILED HELP
  help <command>                 Detailed help
  Examples: help add | help cli

Config stored in .ploinky/
╚═══════════════════════════════════════════════════════╝
`);
}
```

## Internal Functions

### showDetailedHelp(topic, subtopic, subsubtopic)

**Purpose**: Shows detailed help for a specific command

**Parameters**:
- `topic` (string): Main command
- `subtopic` (string): Optional subcommand
- `subsubtopic` (string): Optional sub-subcommand

**Help Content Structure**:
```javascript
const helpContent = {
    'add': {
        description: 'Add repositories or environment variables',
        subcommands: {
            'repo': {
                syntax: 'add repo <name> [url]',
                description: 'Add an agent repository',
                params: {
                    '<name>': 'Repository name',
                    '[url]': 'Git URL for custom repos'
                },
                examples: ['add repo cloud'],
                notes: 'Predefined repos: cloud, vibe, security, extra'
            }
        }
    },
    'start': {
        description: 'Start enabled agents and Router',
        syntax: 'start [staticAgent] [port]',
        examples: ['start MyAgent 8080', 'start'],
        notes: 'First run needs agent and port.'
    },
    // ... other commands
};
```

## Command Categories

### Local Development
| Command | Description |
|---------|-------------|
| `add repo` | Add repository |
| `update repo` | Update repository |
| `start` | Start agents and router |
| `shell` | Interactive shell |
| `cli` | Run agent CLI |
| `webtty` | WebTTY access |
| `webchat` | WebChat access |
| `webmeet` | WebMeet access |
| `dashboard` | Dashboard access |
| `sso` | SSO management |
| `vars`, `var`, `echo` | Variable management |
| `expose` | Expose variables to agents |
| `list` | List agents/repos |

### Client Operations
| Command | Description |
|---------|-------------|
| `client tool` | Call MCP tool |
| `client list` | List tools/resources |
| `client status` | Agent status |

### Session Management
| Command | Description |
|---------|-------------|
| `status` | Show workspace status |
| `restart` | Restart agents/router |
| `stop` | Stop containers |
| `shutdown` | Remove containers |
| `logs` | View router logs |

## Help Output Format

```
╔═══ HELP: <command> ═══╗

SYNTAX:  <command syntax>

DESCRIPTION:
  <description text>

PARAMETERS:
  <param>      <description>

SUBCOMMANDS:
  <sub>        <description>

EXAMPLES:
  <example command>

NOTES:
  <additional notes>
```

## Usage Example

```javascript
import { showHelp } from './help.js';

// Show main help
showHelp();

// Show help for 'add' command
showHelp(['add']);

// Show help for 'add repo' subcommand
showHelp(['add', 'repo']);

// Show help for 'client tool'
showHelp(['client', 'tool']);
```

## Exports

```javascript
export { showHelp };
```

## Related Modules

- [commands-cli.md](../../commands/commands-cli.md) - Command dispatcher
- [cli-main.md](../../cli-main.md) - Main CLI entry
