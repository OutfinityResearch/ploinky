# cli/index.js - CLI Main Entry Point

## Overview

The main entry point for the Ploinky command-line interface. This module provides both interactive REPL mode and single-command execution, with full tab completion, command history, and multiline input support.

## Source File

`cli/index.js`

## Dependencies

```javascript
import readline from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { initEnvironment, setDebugMode } from './services/config.js';
import { handleCommand, getAgentNames, getRepoNames, cleanupSessionContainers as cleanupCliSessions } from './commands/cli.js';
import { getCommandRegistry } from './services/commandRegistry.js';
import { showHelp } from './services/help.js';
import { debugLog } from './services/utils.js';
import * as inputState from './services/inputState.js';
import { bootstrap } from './services/ploinkyboot.js';
import { enableMultilineNavigation } from './services/multilineNavigation.js';
```

## Constants & Configuration

```javascript
// COMMANDS is dynamically loaded from command registry
const COMMANDS = getCommandRegistry();

// File commands that support file path completion
const fileCommands = ['cd', 'cat', 'ls', 'rm', 'cp', 'mv', 'mkdir', 'touch'];

// Cloud sub-subcommands for nested completion
const cloudSubSubcommands = {
    'host': ['add', 'remove', 'list'],
    'repo': ['add', 'remove', 'list'],
    'agent': ['list', 'info', 'start', 'stop', 'restart'],
    'admin': ['add', 'password']
};

// Predefined repository names for completion
const predefinedRepos = ['basic', 'cloud', 'vibe', 'security', 'extra', 'demo'];
```

## Data Structures

```javascript
/**
 * Command registry structure returned by getCommandRegistry()
 * @typedef {Object.<string, string[]>} CommandRegistry
 * Maps command names to arrays of valid subcommands
 * Example: { 'start': ['agent', 'server', 'webchat'], 'list': ['agents', 'repos'] }
 */

/**
 * Completion context types
 * @typedef {'commands'|'subcommands'|'help-topics'|'cloud-sub'|'args'|'files'|'none'} CompletionContext
 */

/**
 * Completer return type
 * @typedef {[string[], string]} CompleterResult
 * Array containing [matching completions, line fragment being completed]
 */
```

## Public API

### completer(line)

**Purpose**: Provides tab completion for the interactive CLI

**Parameters**:
- `line` (string): The current input line being typed

**Returns**: `CompleterResult` - Array of [completions, lineFragment]

**Implementation**:
```javascript
function completer(line) {
    const words = line.split(/\s+/).filter(Boolean);
    const lineFragment = line.endsWith(' ') ? '' : (words[words.length - 1] || '');

    let completions = [];
    let context = 'commands';

    // Determine completion context based on:
    // 1. If first word is a known command
    // 2. Position in command (first word, subcommand, argument)
    // 3. Specific command requirements (some need agent names, some need file paths)

    if (words.length > 0 && COMMANDS.hasOwnProperty(words[0])) {
        const command = words[0];
        const subcommands = COMMANDS[command];

        // Context determination logic:
        if (line.endsWith(' ')) {
            // Space after command - determine what comes next
            if (words.length === 1 && subcommands.length > 0) {
                context = 'subcommands';
            } else if (command === 'help' && words.length === 1) {
                context = 'help-topics';
            } else if (command === 'cloud' && words.length === 2) {
                const cloudSubcommand = words[1];
                if (['host', 'repo', 'agent', 'admin'].includes(cloudSubcommand)) {
                    context = 'cloud-sub';
                } else {
                    context = 'args';
                }
            } else if (command === 'client' && words.length === 2) {
                const clientSubcommand = words[1];
                if (['methods', 'status', 'task', 'task-status'].includes(clientSubcommand)) {
                    context = 'args'; // Will show agent names
                } else {
                    context = 'none';
                }
            } else if (command === 'list' && words.length === 2) {
                context = 'none';
            } else if ((command === 'start') && words.length === 2) {
                context = 'subcommands';
            } else if (words.length === 2) {
                context = 'args';
            } else {
                context = fileCommands.includes(command) ? 'files' : 'none';
            }
        } else {
            // No trailing space - completing current word
            if (words.length === 1) context = 'commands';
            else if (words.length === 2 && subcommands.length > 0) {
                if (command === 'disable' && !subcommands.includes(words[1])) {
                    context = 'args';
                } else {
                    context = 'subcommands';
                }
            }
            else if (command === 'help' && words.length === 2) {
                context = 'help-topics';
            } else if (command === 'cloud' && words.length === 3) {
                const cloudSubcommand = words[1];
                if (['host', 'repo', 'agent', 'admin'].includes(cloudSubcommand)) {
                    context = 'cloud-sub';
                }
            } else if (command === 'client' && words.length === 3) {
                const clientSubcommand = words[1];
                if (['methods', 'status', 'task', 'task-status'].includes(clientSubcommand)) {
                    context = 'args';
                }
            } else {
                context = fileCommands.includes(command) ? 'files' : 'none';
            }
        }

        // Get completions based on context
        if (context === 'subcommands') {
            completions = subcommands;
            if (command === 'disable') {
                completions = [...new Set([...subcommands, ...getAgentNames()])];
            }
        } else if (context === 'help-topics') {
            completions = Object.keys(COMMANDS).filter(cmd =>
                cmd !== 'help' && cmd !== 'exit' && cmd !== 'quit' && cmd !== 'clear'
            );
        } else if (context === 'cloud-sub') {
            const cloudSubcommand = words[1];
            completions = cloudSubSubcommands[cloudSubcommand] || [];
        } else if (context === 'args') {
            // Argument completion based on specific command needs
            const subcommand = words[1];
            if ((command === 'shell') ||
                (command === 'cli') ||
                (command === 'update' && subcommand === 'agent') ||
                (command === 'refresh' && subcommand === 'agent') ||
                (command === 'enable' && subcommand === 'agent') ||
                (command === 'client' && ['methods', 'status', 'task', 'task-status'].includes(subcommand))) {
                completions = getAgentNames();
            } else if (command === 'logs' && subcommand === 'tail') {
                completions = ['router', 'webtty'];
            } else if (command === 'logs' && subcommand === 'last') {
                if (words.length >= 4) completions = ['router', 'webtty'];
            } else if (command === 'expose') {
                if (words.length >= 4) completions = getAgentNames();
            } else if (command === 'disable') {
                if (subcommand === 'repo') {
                    completions = predefinedRepos;
                } else {
                    completions = getAgentNames();
                }
            } else if (command === 'enable' && subcommand === 'repo') {
                completions = predefinedRepos;
            } else if (command === 'add' && subcommand === 'repo') {
                completions = predefinedRepos;
            } else if (command === 'help' && subcommand) {
                if (COMMANDS[subcommand]) {
                    completions = COMMANDS[subcommand];
                }
            } else {
                completions = [];
            }
        }

        if (context === 'commands') {
            completions = Object.keys(COMMANDS);
        }
    } else {
        // Not a known Ploinky command
        if (words.length === 0 || (words.length === 1 && !line.endsWith(' '))) {
            completions = Object.keys(COMMANDS);
        } else {
            context = 'files';
        }
    }

    // File path completion
    if (context === 'files') {
        try {
            let pathToComplete = lineFragment;
            let dirPath = '.';
            let filePrefix = '';

            if (pathToComplete.includes('/')) {
                const lastSlash = pathToComplete.lastIndexOf('/');
                dirPath = pathToComplete.substring(0, lastSlash) || '.';
                filePrefix = pathToComplete.substring(lastSlash + 1);
            } else {
                filePrefix = pathToComplete;
            }

            // Resolve ~ to home directory
            if (dirPath.startsWith('~')) {
                dirPath = dirPath.replace('~', process.env.HOME || process.env.USERPROFILE);
            }

            if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
                const files = fs.readdirSync(dirPath);
                const matchingFiles = files
                    .filter(f => f.startsWith(filePrefix))
                    .map(f => {
                        const fullPath = path.join(dirPath, f);
                        const isDir = fs.statSync(fullPath).isDirectory();
                        if (pathToComplete.includes('/')) {
                            const prefix = pathToComplete.substring(0, pathToComplete.lastIndexOf('/') + 1);
                            return prefix + f + (isDir ? '/' : '');
                        }
                        return f + (isDir ? '/' : '');
                    });
                completions = matchingFiles;
            }
        } catch (err) {
            debugLog('File completion error:', err.message);
        }
    }

    const hits = completions.filter((c) => c.startsWith(lineFragment));

    // Single exact match adds trailing space (unless directory)
    if (hits.length === 1 && hits[0] === lineFragment && !lineFragment.endsWith('/')) {
        return [[hits[0] + ' '], lineFragment];
    }

    return [hits, lineFragment];
}
```

### getRelativePath()

**Purpose**: Returns the current working directory with home directory abbreviated as ~

**Returns**: (string) Path string with ~ substitution

**Implementation**:
```javascript
function getRelativePath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    const cwd = process.cwd();

    if (cwd === home) {
        return '~';
    } else if (cwd.startsWith(home)) {
        return '~' + cwd.slice(home.length);
    } else {
        return cwd;
    }
}
```

### getColoredPrompt()

**Purpose**: Generates the ANSI-colored prompt string for the interactive CLI

**Returns**: (string) Colored prompt in format "ploinky ~/path>"

**Implementation**:
```javascript
function getColoredPrompt() {
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const magenta = '\x1b[35m';

    // Bold magenta for "ploinky", cyan for path, green for ">"
    return `${bold}${magenta}ploinky${reset} ${cyan}${getRelativePath()}${reset}${green}>${reset} `;
}
```

### startInteractiveMode()

**Purpose**: Initializes and runs the interactive REPL mode with command history, completion, and signal handling

**Implementation**:
```javascript
function startInteractiveMode() {
    // Ensure clean TTY state when entering interactive mode
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        try { process.stdin.setRawMode(false); } catch (_) {}
    }

    const restoreTTY = () => {
        try {
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
                process.stdin.setRawMode(false);
            }
            try { process.stdout.write('\x1b[?25h\x1b[0m'); } catch(_) {}
        } catch(_) {}
    };

    // Load history from .ploinky_history in current directory
    const historyPath = path.join(process.cwd(), '.ploinky_history');
    let history = [];
    try {
        if (fs.existsSync(historyPath)) {
            const lines = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
            history = lines.slice(-1000).reverse(); // Keep last 1000, newest first
        }
    } catch (e) {
        debugLog('Could not read history file:', e.message);
    }

    // Create readline interface
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getColoredPrompt(),
        history: history,
        historySize: 1000,
        completer: process.stdin.isTTY ? completer : undefined
    });

    inputState.registerInterface?.(rl);
    enableMultilineNavigation(rl);

    const cleanupAndExit = () => {
        try { cleanupCliSessions(); } catch (_) {}
        try { inputState.registerInterface?.(null); } catch (_) {}
        restoreTTY();
        try { rl.close(); } catch(_) {}
        process.exit(0);
    };

    // Signal handlers
    process.on('SIGINT', () => cleanupAndExit());
    process.on('SIGTERM', () => cleanupAndExit());
    process.on('uncaughtException', (err) => {
        try { console.error(err); } catch(_) {}
        cleanupAndExit();
    });
    process.on('exit', () => { try { restoreTTY(); } catch(_) {} });

    // Process each line of input
    rl.on('line', async (line) => {
        if (inputState.isSuspended()) {
            return;
        }
        const trimmedLine = line.trim();
        if (trimmedLine) {
            if (trimmedLine === 'exit' || trimmedLine === 'quit') {
                return cleanupAndExit();
            }
            // Append to history file
            try {
                fs.appendFileSync(historyPath, trimmedLine + '\n');
            } catch (e) {
                debugLog('Could not write to history file:', e.message);
            }
            const args = trimmedLine.split(/\s+/);
            try {
                await handleCommand(args);
            } catch (error) {
                console.error(`Error: ${error.message}`);
                debugLog(`Command error details: ${error.stack}`);
            }
            rl.setPrompt(getColoredPrompt());
        }
        if (process.stdin.isTTY) {
            rl.prompt();
        }
    }).on('close', async () => {
        restoreTTY();
        try { cleanupCliSessions(); } catch (_) {}
        try { inputState.registerInterface?.(null); } catch (_) {}
        if (process.stdin.isTTY) { console.log('Bye.'); }
        process.exit(0);
    });

    // Handle EOF (Ctrl-D)
    try {
        rl.input.on('end', () => { try { restoreTTY(); rl.close(); } catch(_) {} });
        process.stdin.on('end', () => { try { restoreTTY(); rl.close(); } catch(_) {} });
    } catch(_) {}

    // Show welcome message in TTY mode
    if (process.stdin.isTTY) {
        console.log('Welcome to Ploinky interactive mode.');
        console.log("Type 'help' for a list of commands. Use 'exit' to leave, 'shutdown' to close session containers, or 'destroy' to remove all Ploinky containers.");
        rl.prompt();
    }
}
```

### main()

**Purpose**: Application entry point - handles argument parsing and mode selection

**Implementation**:
```javascript
function main() {
    try {
        let args = process.argv.slice(2);

        // Handle --debug/-d flag
        const debugIndex = args.findIndex(arg => arg === '--debug' || arg === '-d');
        if (debugIndex > -1) {
            setDebugMode(true);
            args.splice(debugIndex, 1);
            console.log('[INFO] Debug mode enabled.');
        }

        debugLog('Raw arguments:', args);
        initEnvironment();
        try { bootstrap(); } catch (_) {}

        if (args.length === 0) {
            // No arguments - start interactive mode
            startInteractiveMode();
        } else {
            if (args[0] === 'help') {
                showHelp();
                return;
            }
            // Execute single command and exit
            handleCommand(args).catch(error => {
                console.error(`❌ Error: ${error.message}`);
                process.exit(1);
            });
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}
```

## Entry Point Guard

```javascript
// Only run main() if this file is the entry point
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (!entryPoint || entryPoint === fileURLToPath(import.meta.url)) {
    main();
}
```

## Event Handlers / Callbacks

### readline 'line' Event
Processes each line of user input:
1. Checks if input is suspended (e.g., password prompt)
2. Handles exit/quit commands
3. Appends to history file
4. Splits into args and calls handleCommand()
5. Updates prompt and re-prompts

### readline 'close' Event
Cleanup on close:
1. Restores TTY state
2. Cleans up session containers
3. Unregisters interface
4. Exits process

### Signal Handlers
- `SIGINT`: Cleanup and exit
- `SIGTERM`: Cleanup and exit
- `uncaughtException`: Log error, cleanup, exit
- `exit`: Restore TTY

## Error Handling

- File operations wrapped in try/catch with fallback behavior
- Command errors logged with stack trace in debug mode
- History file errors are non-fatal (logged but continue)
- TTY restoration errors silently ignored

## State Management

- `DEBUG_MODE`: Global debug flag via setDebugMode()
- `history`: Array of command history loaded from file
- `inputState`: Module for managing suspended input state
- Command history persisted to `.ploinky_history`

## Integration Points

- `services/config.js`: Environment initialization, debug mode
- `commands/cli.js`: Command execution and agent management
- `services/commandRegistry.js`: Dynamic command registry
- `services/help.js`: Help system
- `services/inputState.js`: Input suspension management
- `services/ploinkyboot.js`: Bootstrap operations
- `services/multilineNavigation.js`: Multiline input support

## Usage Example

```bash
# Interactive mode
ploinky

# Single command execution
ploinky start agent myagent

# Debug mode
ploinky --debug list agents

# Help
ploinky help
```

## Edge Cases & Constraints

- Non-TTY mode (piped input) skips prompt display
- History limited to last 1000 commands
- Tab completion only in TTY mode
- ~ expansion supports HOME or USERPROFILE env vars
- File completion handles directories with trailing /

## Related Modules

- [shell-integration.md](./shell-integration.md) - LLM shell mode
- [services/config.md](./services/config/service-config.md) - Configuration
- [commands/cli.md](./commands/commands-cli.md) - Command handling
