# cli/services/inputState.js - Input State Management

## Overview

Manages readline interface state for the CLI. Provides suspend/resume functionality for handling external commands that need raw terminal access.

## Source File

`cli/services/inputState.js`

## State Variables

```javascript
let suspended = false;
let activeInterface = null;
```

## Public API

### isSuspended()

**Purpose**: Checks if input is suspended

**Returns**: (boolean) Suspension state

**Implementation**:
```javascript
export function isSuspended() {
    return suspended;
}
```

### suspend()

**Purpose**: Suspends input processing

**Implementation**:
```javascript
export function suspend() {
    suspended = true;
}
```

### resume()

**Purpose**: Resumes input processing

**Implementation**:
```javascript
export function resume() {
    suspended = false;
}
```

### registerInterface(rl)

**Purpose**: Registers the active readline interface

**Parameters**:
- `rl` (readline.Interface): Readline interface

**Implementation**:
```javascript
export function registerInterface(rl) {
    activeInterface = rl || null;
}
```

### getInterface()

**Purpose**: Gets the registered readline interface

**Returns**: (readline.Interface|null) Active interface

**Implementation**:
```javascript
export function getInterface() {
    return activeInterface;
}
```

### prepareForExternalCommand()

**Purpose**: Prepares terminal for external command execution

**Returns**: (Function) Restore function to call after command completes

**Behavior**:
1. Suspends input processing
2. Pauses readline interface
3. Disables raw mode if enabled
4. Returns function to restore state

**Implementation**:
```javascript
export function prepareForExternalCommand() {
    const rl = activeInterface;
    if (!rl || !rl.input) {
        // No interactive session
        return () => {};
    }
    const inputStream = rl.input;
    let restored = false;
    let pausedRl = false;
    let pausedInput = false;
    let previousRawMode = null;
    let hasRawMode = false;

    // Suspend and pause
    suspend();
    if (rl && typeof rl.pause === 'function') {
        rl.pause();
        pausedRl = true;
    } else if (inputStream && typeof inputStream.pause === 'function') {
        inputStream.pause();
        pausedInput = true;
    }

    // Disable raw mode if enabled
    if (inputStream && typeof inputStream.setRawMode === 'function') {
        const isRaw = Boolean(inputStream.isRaw);
        previousRawMode = isRaw;
        hasRawMode = true;
        if (isRaw) {
            try {
                inputStream.setRawMode(false);
            } catch (_) {}
        }
    }

    // Return restore function
    return () => {
        if (restored) return;
        restored = true;

        // Restore raw mode
        if (hasRawMode && typeof inputStream.setRawMode === 'function' && previousRawMode !== null) {
            try {
                inputStream.setRawMode(previousRawMode);
            } catch (_) {}
        }

        // Resume interface
        if (pausedRl && typeof rl?.resume === 'function') {
            rl.resume();
            try {
                rl.prompt();
            } catch (_) {}
        } else if (pausedInput && typeof inputStream?.resume === 'function') {
            inputStream.resume();
        }

        resume();
    };
}
```

## Exports

```javascript
export {
    isSuspended,
    suspend,
    resume,
    registerInterface,
    getInterface,
    prepareForExternalCommand
};
```

## Usage Example

```javascript
import {
    registerInterface,
    prepareForExternalCommand,
    isSuspended,
    getInterface
} from './inputState.js';
import readline from 'readline';
import { spawn } from 'child_process';

// Register interface during CLI init
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
registerInterface(rl);

// Before running external command
async function runExternalCommand(cmd, args) {
    const restore = prepareForExternalCommand();

    try {
        await new Promise((resolve) => {
            const child = spawn(cmd, args, { stdio: 'inherit' });
            child.on('exit', resolve);
        });
    } finally {
        restore();
    }
}

// Check state
if (isSuspended()) {
    console.log('Input is suspended');
}

// Get interface for question prompts
const rl = getInterface();
if (rl) {
    rl.question('Continue? ', (answer) => {
        console.log(answer);
    });
}
```

## Integration Points

- Used by `handleSystemCommand` in llmSystemCommands.js
- Used by `promptToExecuteSuggestedCommand` for LLM suggestions
- Registered in cli/index.js during CLI initialization

## Related Modules

- [cli-main.md](../../cli-main.md) - Registers interface
- [commands-llm-system.md](../../commands/commands-llm-system.md) - Uses for external commands
