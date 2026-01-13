# cli/commands/llmSystemCommands.js - LLM System Commands

## Overview

Provides LLM-powered command suggestion and system command execution. When an unrecognized command is entered, uses an LLM to suggest appropriate Ploinky or system commands.

## Source File

`cli/commands/llmSystemCommands.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { debugLog } from '../services/utils.js';
import {
    loadValidLlmApiKeys,
    collectAvailableLlmKeys,
    populateProcessEnvFromEnvFile,
    resolveEnvFilePath,
} from '../services/llmProviderUtils.js';
import * as inputState from '../services/inputState.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LLM_SYSTEM_CONTEXT_PATH = path.join(PROJECT_ROOT, 'docs', 'ploinky-overview.md');
const WORKSPACE_ENV_FILENAME = '.env';

let cachedLlmSystemContext = null;
let cachedInvoker = null;
let invokerVersion = 0;
```

## Internal Functions

### getDefaultInvoker()

**Purpose**: Gets the LLM invoker from achillesAgentLib

**Returns**: Promise<Function> LLM invoker strategy

**Implementation**:
```javascript
async function getDefaultInvoker() {
    if (cachedInvoker) return cachedInvoker;
    let llmPath;
    try {
        llmPath = require.resolve('achillesAgentLib/utils/LLMClient.mjs');
    } catch (error) {
        throw new Error(`Unable to resolve Achilles LLM client: ${error?.message || error}`);
    }
    const urlWithVersion = `${pathToFileURL(llmPath).href}?v=${invokerVersion}`;
    const mod = await import(urlWithVersion);
    cachedInvoker = mod.defaultLLMInvokerStrategy;
    return cachedInvoker;
}
```

### loadLlmSystemContext()

**Purpose**: Loads Ploinky system context for LLM prompts

**Returns**: (string) System context content

**Implementation**:
```javascript
function loadLlmSystemContext() {
    if (cachedLlmSystemContext !== null) {
        return cachedLlmSystemContext;
    }
    try {
        const content = fs.readFileSync(LLM_SYSTEM_CONTEXT_PATH, 'utf8');
        cachedLlmSystemContext = content.trim();
    } catch (error) {
        cachedLlmSystemContext = '';
        debugLog('loadLlmSystemContext failed:', error?.message || error);
    }
    return cachedLlmSystemContext;
}
```

### buildLlmPrompt(rawInput)

**Purpose**: Builds the prompt for LLM command suggestion

**Parameters**:
- `rawInput` (string): User's command input

**Returns**: (string) Complete prompt

**Implementation**:
```javascript
function buildLlmPrompt(rawInput) {
    const sections = [];
    const systemContext = loadLlmSystemContext();
    if (systemContext) {
        sections.push(`System context for Ploinky CLI and runtime:\n${systemContext}`);
    }

    sections.push(
        `You are a helpful general-purpose assistant. You can do anything, and when appropriate provide Ploinky-specific guidance.
In addition to your broad knowledge, you have detailed context about the Ploinky CLI (included above).
Given the user input, you have 2 choices of responding: describe the best command you find that would fulfill the user's needs or just answer normally. Decide if the user needs a system command(ls, pwd, etc.), a ploinky command or just a plain response(that does not require any command). Try to find the single best one-line command. If more than one command is needed, respond with a short list, one actionable command per line. Suggested commands MUST respect the following format:
\`\`\`
command
\`\`\`
User input: "${rawInput}"`);

    return sections.join('\n\n');
}
```

### extractSingleCommandFromSuggestion(suggestion)

**Purpose**: Extracts a single command from LLM suggestion

**Parameters**:
- `suggestion` (string): LLM response

**Returns**: (string) Extracted command or empty string

**Implementation**:
```javascript
function extractSingleCommandFromSuggestion(suggestion) {
    if (typeof suggestion !== 'string' || !suggestion.includes('```')) return '';
    const matches = [...suggestion.matchAll(/```([\s\S]*?)```/g)];
    if (matches.length !== 1) return '';
    const blockContent = matches[0][1].trim();
    if (!blockContent) return '';
    if (blockContent.includes('\n')) return '';
    return blockContent;
}
```

### promptToExecuteSuggestedCommand(commandText)

**Purpose**: Prompts user to confirm execution of suggested command

**Parameters**:
- `commandText` (string): Command to execute

**Returns**: Promise<boolean> Whether to execute

**Implementation**:
```javascript
async function promptToExecuteSuggestedCommand(commandText) {
    const activeInterface = inputState.getInterface?.();
    if (!activeInterface || !process.stdin.isTTY) {
        console.log(`LLM suggested: ${commandText}`);
        return false;
    }

    inputState.suspend?.();
    let prompt = `LLM suggested: ${commandText}. Execute? (y/n) `;
    try {
        while (true) {
            const raw = await new Promise((resolve) => {
                activeInterface.question(prompt, (answer) => resolve(answer));
            });
            discardLastHistoryEntry(activeInterface, raw);
            const normalized = (raw || '').trim().toLowerCase();
            if (!normalized) return false;
            if (normalized === 'y' || normalized === 'yes') return true;
            if (normalized === 'n' || normalized === 'no') return false;
            prompt = 'Please respond with y or n: ';
        }
    } finally {
        inputState.resume?.();
    }
}
```

### commandExistsSync(cmd)

**Purpose**: Checks if a command exists in PATH

**Parameters**:
- `cmd` (string): Command name

**Returns**: (boolean)

### resolveCdTarget(target)

**Purpose**: Resolves cd target path

**Parameters**:
- `target` (string): Target directory

**Returns**: (string) Resolved absolute path

**Implementation**:
```javascript
function resolveCdTarget(target) {
    const homeDir = os.homedir() || process.cwd();
    if (!target || target === '~') {
        return homeDir;
    }
    if (target.startsWith('~/')) {
        return path.join(homeDir, target.slice(2));
    }
    return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}
```

### extractLlmErrorDetails(error)

**Purpose**: Extracts error details from LLM invocation failure

**Parameters**:
- `error` (Error): LLM error object

**Returns**: `{code: number|null, message: string}`

### suggestCommandWithLLM(commandLabel, options)

**Purpose**: Gets LLM suggestion for a command

**Parameters**:
- `commandLabel` (string): Command that was entered
- `options` (string[]): Command options

**Returns**: Promise<{status: string, suggestion?: string, error?: Object}>

## Public API

### resetLlmInvokerCache()

**Purpose**: Resets the cached LLM invoker (for testing/hot reload)

**Implementation**:
```javascript
export function resetLlmInvokerCache() {
    cachedInvoker = null;
    invokerVersion += 1;
}
```

### handleSystemCommand(command, options)

**Purpose**: Executes a system command (cd or external)

**Parameters**:
- `command` (string): Command to execute
- `options` (string[]): Command arguments

**Returns**: Promise<boolean> True if command was handled

**Implementation**:
```javascript
export async function handleSystemCommand(command, options = []) {
    if (!command) return false;

    // Handle cd specially
    if (command === 'cd') {
        const destination = resolveCdTarget(options[0]);
        try {
            process.chdir(destination);
        } catch (error) {
            console.error(`cd: ${error?.message || error}`);
        }
        return true;
    }

    // Check if command exists
    if (!commandExistsSync(command)) {
        return false;
    }

    // Spawn the command
    return await new Promise((resolve) => {
        const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
        let settled = false;
        const finalize = (result) => {
            if (settled) return;
            settled = true;
            try { restoreInput(); } catch (_) { }
            resolve(result);
        };

        let child;
        try {
            child = spawn(command, options, { stdio: 'inherit' });
        } catch (error) {
            console.error(error?.message || error);
            finalize(true);
            return;
        }

        child.on('error', (error) => {
            if (error?.code === 'ENOENT') {
                finalize(false);
            } else {
                console.error(error?.message || error);
                finalize(true);
            }
        });

        child.on('exit', () => {
            finalize(true);
        });
    });
}
```

### handleInvalidCommand(command, options, executeSuggestion)

**Purpose**: Handles unrecognized commands with LLM assistance

**Parameters**:
- `command` (string): Unrecognized command
- `options` (string[]): Command options
- `executeSuggestion` (Function): Callback to execute suggested command

**Async**: Yes

**Implementation**:
```javascript
export async function handleInvalidCommand(command, options = [], executeSuggestion) {
    const commandLabel = command || '';
    const validKeyNames = loadValidLlmApiKeys();
    const envPath = resolveEnvFilePath(path.resolve(process.cwd(), WORKSPACE_ENV_FILENAME));
    populateProcessEnvFromEnvFile(envPath);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const validKeysList = formatValidApiKeyList(validKeyNames);

    // No API keys available
    if (!availableKeys.length) {
        console.log(`Command '${commandLabel}' is not recognized. Type help or configure .env with: ${validKeysList}`);
        return;
    }

    console.log('Asking the LLM for guidance...');

    const llmResult = await suggestCommandWithLLM(commandLabel, options);

    if (llmResult?.status === 'ok' && llmResult.suggestion) {
        const singleCommand = extractSingleCommandFromSuggestion(llmResult.suggestion);
        if (singleCommand && typeof executeSuggestion === 'function') {
            const shouldExecute = await promptToExecuteSuggestedCommand(singleCommand);
            if (shouldExecute) {
                try {
                    await executeSuggestion(singleCommand);
                } catch (error) {
                    console.error(`Failed to execute: ${error?.message || error}`);
                }
            }
        } else {
            console.log('LLM suggested:');
            console.log(llmResult.suggestion);
        }
        return;
    }

    if (llmResult?.status === 'error' && llmResult.error) {
        if (llmResult.error.code === 401) {
            console.log('LLM call failed: API key invalid.');
        } else {
            console.log(`LLM call failed: ${llmResult.error.message}`);
        }
        console.log('Run `help` to see all available Ploinky commands.');
        return;
    }

    console.log(`Command '${commandLabel}' is not recognized. Type help or configure .env.`);
}
```

## Exports

```javascript
export {
    resetLlmInvokerCache,
    handleSystemCommand,
    handleInvalidCommand,
    suggestCommandWithLLM,
    extractSingleCommandFromSuggestion,
    formatValidApiKeyList,
    promptToExecuteSuggestedCommand,
};
```

## Usage Example

```javascript
import { handleSystemCommand, handleInvalidCommand } from './llmSystemCommands.js';

// Execute system command
await handleSystemCommand('ls', ['-la']);

// Handle unrecognized command with LLM
await handleInvalidCommand('deploy app', [], async (cmd) => {
    // Execute the suggested command
    await executePloinkyCommand(cmd);
});
```

## Related Modules

- [service-llm-provider-utils.md](../services/utils/service-llm-provider-utils.md) - LLM utilities
- [service-input-state.md](../services/utils/service-input-state.md) - Input state management
- [commands-cli.md](./commands-cli.md) - Command dispatcher
