# cli/shell.js - LLM Shell Integration

## Overview

The Ploinky Shell provides an LLM-based command recommendation system. Unlike the main CLI which executes Ploinky commands directly, this shell mode forwards user queries to an LLM for command suggestions, with optional automatic execution of suggested commands.

## Source File

`cli/shell.js`

## Dependencies

```javascript
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import {
    suggestCommandWithLLM,
    extractSingleCommandFromSuggestion,
    formatValidApiKeyList,
    promptToExecuteSuggestedCommand,
    handleSystemCommand,
    resetLlmInvokerCache,
} from './commands/llmSystemCommands.js';
import { getPrioritizedModels } from 'achillesAgentLib/utils/LLMClient.mjs';
import {
    loadValidLlmApiKeys,
    collectAvailableLlmKeys,
    populateProcessEnvFromEnvFile,
    resolveEnvFilePath,
} from './services/llmProviderUtils.js';
import { runSettingsMenu } from './services/settingsMenu.js';
import * as inputState from './services/inputState.js';
```

## Constants & Configuration

```javascript
const WORKSPACE_ENV_FILENAME = '.env';

// ANSI Color Codes
const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BLUE = '\x1b[34m';

// Shell branding
const SHELL_TAG = `${ANSI_BOLD}${ANSI_MAGENTA}[Ploinky Shell]${ANSI_RESET}`;

// Built-in shell commands
const SETTINGS_COMMAND = '/settings';
const SETTINGS_ALIAS = 'settings';
const SHELL_COMMANDS = [SETTINGS_COMMAND, SETTINGS_ALIAS, '/help', 'help'];

// State flags
let envInfoLogged = false;
let modelsInfoLogged = false;
let cachedKeyState = null;
```

## Data Structures

```javascript
/**
 * Cached LLM key state
 * @typedef {Object} KeyState
 * @property {string[]} availableKeys - List of available API key env var names
 * @property {string[]} validKeys - List of recognized valid key names
 * @property {boolean} ok - Whether at least one key is available
 * @property {string} envPath - Resolved path to .env file
 */

/**
 * LLM suggestion result
 * @typedef {Object} LLMResult
 * @property {'ok'|'error'} status - Result status
 * @property {string} [suggestion] - The suggested command(s)
 * @property {Object} [error] - Error details if status is 'error'
 * @property {number} error.code - Error code (e.g., 401 for auth)
 * @property {string} error.message - Error message
 */

/**
 * Usable models structure
 * @typedef {Object} UsableModels
 * @property {Array<{name: string, provider: string}>} fast - Fast models
 * @property {Array<{name: string, provider: string}>} deep - Deep models
 */
```

## Public API

### resetEnvCaches()

**Purpose**: Clears all cached environment and key state

**Implementation**:
```javascript
function resetEnvCaches() {
    cachedKeyState = null;
    envInfoLogged = false;
    modelsInfoLogged = false;
    resetLlmInvokerCache();
}
```

### maskApiKey(value)

**Purpose**: Masks an API key for display (shows first 4 and last 4 characters)

**Parameters**:
- `value` (string): The API key to mask

**Returns**: (string) Masked key like "sk-a...xyz9"

**Implementation**:
```javascript
function maskApiKey(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (trimmed.length <= 8) {
        return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
    }
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
```

### printUsage()

**Purpose**: Displays usage information for the shell

**Implementation**:
```javascript
function printUsage() {
    console.log('Ploinky Shell only provides LLM-based command recommendations.');
    console.log('Usage:');
    console.log('  ploinky -l                   # Interactive shell mode');
    console.log('  ploinky -l <command or text> # Single recommendation and exit');
}
```

### printShellHelp()

**Purpose**: Displays help for shell-specific commands

**Implementation**:
```javascript
function printShellHelp() {
    console.log('Ploinky Shell commands:');
    console.log('  /settings   Open the interactive settings menu for LLM config flags');
    console.log('  /help, help Show this help');
    console.log('All other input is sent to the LLM for command recommendations.');
}
```

### ensureLlmKeyAvailability()

**Purpose**: Ensures LLM API keys are available, loading from .env if needed

**Returns**: `Promise<KeyState>` - Cached key state

**Implementation**:
```javascript
async function ensureLlmKeyAvailability() {
    if (cachedKeyState) return cachedKeyState;
    const envPath = resolveEnvFilePath(process.cwd());
    populateProcessEnvFromEnvFile(envPath);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const validKeys = loadValidLlmApiKeys();
    cachedKeyState = {
        availableKeys,
        validKeys,
        ok: availableKeys.length > 0,
        envPath,
    };
    return cachedKeyState;
}
```

### resolveLlmConfigPath()

**Purpose**: Finds the LLMConfig.json file path

**Returns**: (string) Path to LLMConfig.json

**Implementation**:
```javascript
function resolveLlmConfigPath() {
    const candidates = [
        path.resolve(process.cwd(), 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
    ];
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (_) { /* ignore */ }
    }
    return candidates[0];
}
```

### loadUsableModels(availableKeys)

**Purpose**: Loads available models based on configured API keys

**Parameters**:
- `availableKeys` (string[]): Available API key environment variable names

**Returns**: `UsableModels` - Object with fast and deep model arrays

**Implementation**:
```javascript
function loadUsableModels(availableKeys) {
    const configPath = resolveLlmConfigPath();
    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
        return { fast: [], deep: [] };
    }
    const providers = parsed.providers || {};
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    const keySet = new Set((availableKeys || []).map((k) => k && k.trim()).filter(Boolean));
    const result = { fast: [], deep: [] };

    for (const model of models) {
        const name = typeof model?.name === 'string' ? model.name : null;
        const mode = model?.mode === 'deep' ? 'deep' : 'fast';
        const providerKey = model?.provider || model?.providerKey || null;
        if (!name || !providerKey) continue;
        const providerCfg = providers[providerKey];
        const apiKeyEnv = providerCfg?.apiKeyEnv;
        if (!apiKeyEnv || !keySet.has(apiKeyEnv)) continue;
        result[mode].push({ name, provider: providerKey });
    }

    // Deduplicate
    for (const key of Object.keys(result)) {
        const seen = new Set();
        result[key] = result[key].filter((entry) => {
            if (seen.has(entry.name)) return false;
            seen.add(entry.name);
            return true;
        });
    }
    return result;
}
```

### handleSetEnv()

**Purpose**: Opens the settings menu and refreshes caches after changes

**Implementation**:
```javascript
async function handleSetEnv() {
    await runSettingsMenu({
        onEnvChange: () => {
            resetEnvCaches();
        }
    });
    // Refresh cache with new values
    cachedKeyState = null;
    await ensureLlmKeyAvailability();
    if (process.stdin.isTTY) {
        try {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
        } catch (_) { /* ignore */ }
    }
    await logCurrentModelChoice();
}
```

### showMissingKeyMessage(validKeys)

**Purpose**: Displays message when no LLM API key is configured

**Parameters**:
- `validKeys` (string[]): List of valid API key names

**Implementation**:
```javascript
function showMissingKeyMessage(validKeys) {
    const validKeysList = formatValidApiKeyList(validKeys);
    console.log(`[Ploinky Shell] No LLM API key configured. Add one of ${validKeysList} to ${WORKSPACE_ENV_FILENAME} or export it as an environment variable before retrying.`);
}
```

### logAvailableModels(availableKeys)

**Purpose**: Logs available LLM models grouped by provider

**Parameters**:
- `availableKeys` (string[]): Available API key env var names

**Implementation**:
```javascript
async function logAvailableModels(availableKeys = []) {
    if (modelsInfoLogged) return;
    modelsInfoLogged = true;
    const usableKeys = new Set((availableKeys || []).map((k) => k && k.trim()).filter(Boolean));
    try {
        const { fast = [], deep = [] } = loadUsableModels(Array.from(usableKeys));
        const mapEntry = (entry, mode) => ({
            name: entry?.name || entry,
            mode: mode || entry?.mode || 'fast',
            provider: entry?.provider || entry?.providerKey || 'unknown'
        });

        const usableFast = (fast || []).map((entry) => mapEntry(entry, 'fast')).filter((e) => e.name);
        const usableDeep = (deep || []).map((entry) => mapEntry(entry, 'deep')).filter((e) => e.name);
        const combined = [...usableFast, ...usableDeep].filter((entry) => entry && entry.name);
        const grouped = combined.reduce((acc, entry) => {
            const provider = entry.provider || 'unknown';
            if (!acc[provider]) acc[provider] = [];
            acc[provider].push(`${entry.name} (${entry.mode})`);
            return acc;
        }, {});

        if (!usableKeys.size) {
            console.log(`${SHELL_TAG} ${ANSI_YELLOW}No LLM API keys available; skipping model list.${ANSI_RESET}`);
            return;
        }

        const providerNames = Object.keys(grouped);
        if (providerNames.length) {
            const segments = providerNames.sort().map((provider) => {
                const models = grouped[provider] || [];
                return `${provider}: ${models.join(', ')}`;
            });
            console.log(`${SHELL_TAG} ${ANSI_GREEN}Available LLM models (by key):${ANSI_RESET} ${segments.join(' | ')}`);
        } else {
            console.log(`${SHELL_TAG} ${ANSI_YELLOW}No LLM models available for the detected API keys.${ANSI_RESET}`);
        }
    } catch (error) {
        console.log(`${SHELL_TAG} ${ANSI_YELLOW}Failed to list LLM models: ${error?.message || error}${ANSI_RESET}`);
    }
}
```

### logCurrentModelChoice()

**Purpose**: Logs the currently selected LLM model

**Implementation**:
```javascript
async function logCurrentModelChoice() {
    try {
        const prioritized = await getPrioritizedModels();
        const current = Array.isArray(prioritized) && prioritized.length ? prioritized[0] : null;
        if (current) {
            console.log(`${SHELL_TAG} ${ANSI_GREEN}Current LLM model:${ANSI_RESET} ${current}`);
        } else {
            console.log(`${SHELL_TAG} ${ANSI_YELLOW}No LLM model available for current settings.${ANSI_RESET}`);
        }
    } catch (error) {
        console.log(`${SHELL_TAG} ${ANSI_YELLOW}Unable to resolve current LLM model: ${error?.message || error}${ANSI_RESET}`);
    }
}
```

### logEnvDetails(envPath)

**Purpose**: Logs environment configuration details (once per session)

**Parameters**:
- `envPath` (string): Path to resolved .env file

**Implementation**:
```javascript
function logEnvDetails(envPath) {
    if (envInfoLogged) return;
    envInfoLogged = true;
    const validKeys = new Set(loadValidLlmApiKeys());
    console.log('');
    if (envPath) {
        const label = fs.existsSync(envPath) ? 'Resolved .env' : 'No .env found';
        console.log(`${SHELL_TAG} ${ANSI_CYAN}${label}${ANSI_RESET} ${ANSI_DIM}${envPath}${ANSI_RESET}`);
    } else {
        console.log(`${SHELL_TAG} ${ANSI_CYAN}No .env path resolved.${ANSI_RESET}`);
    }

    // Log masked API keys
    const envKeyLines = Array.from(validKeys).map((key) => {
        const value = process.env[key];
        if (typeof value !== 'string' || !value.trim()) return null;
        return `${key}=${maskApiKey(value)}`;
    }).filter(Boolean);
    if (envKeyLines.length) {
        console.log(`${SHELL_TAG} ${ANSI_YELLOW}LLM API keys in use:${ANSI_RESET} ${envKeyLines.join(', ')}`);
    } else {
        console.log(`${SHELL_TAG} ${ANSI_YELLOW}No LLM API keys detected in environment.${ANSI_RESET}`);
    }

    // Log debug/override flags
    const debugVars = [
        'ACHILLES_DEBUG',
        'ACHILLES_ENABLED_DEEP_MODELS',
        'ACHILLES_ENABLED_FAST_MODELS',
        'ACHILLES_DEFAULT_MODEL_TYPE'
    ];
    const activeDebugVars = debugVars
        .map((key) => [key, process.env[key]])
        .filter(([, value]) => typeof value === 'string' && value.trim().length);
    if (activeDebugVars.length) {
        const flags = activeDebugVars.map(([key, value]) => `${key}=${value}`);
        console.log(`${SHELL_TAG} ${ANSI_BLUE}Debug/override flags:${ANSI_RESET} ${flags.join(', ')}`);
    }
    console.log('');
}
```

### shellCompleter(line)

**Purpose**: Tab completion for shell mode - completes shell commands and file paths

**Parameters**:
- `line` (string): Current input line

**Returns**: `[string[], string]` - Completions and line fragment

**Implementation**:
```javascript
function shellCompleter(line) {
    const words = line.split(/\s+/).filter(Boolean);
    const lineFragment = line.endsWith(' ') ? '' : (words[words.length - 1] || '');
    const commands = Array.from(new Set(SHELL_COMMANDS));

    // First token - suggest shell commands only
    if (words.length <= 1 && !line.endsWith(' ')) {
        const hits = commands.filter((cmd) => cmd.startsWith(lineFragment));
        return [hits, lineFragment];
    }

    // Known shell command - no further completion
    const firstToken = words[0];
    if (commands.includes(firstToken)) {
        return [[], lineFragment];
    }

    // Fall back to file path completion
    let completions = [];
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

    if (dirPath.startsWith('~')) {
        dirPath = dirPath.replace('~', process.env.HOME || process.env.USERPROFILE);
    }

    try {
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            const files = fs.readdirSync(dirPath);
            const fileMatches = files
                .filter((f) => f.startsWith(filePrefix))
                .map((f) => {
                    const fullPath = path.join(dirPath, f);
                    const isDir = fs.statSync(fullPath).isDirectory();
                    if (pathToComplete.includes('/')) {
                        const prefix = pathToComplete.substring(0, pathToComplete.lastIndexOf('/') + 1);
                        return prefix + f + (isDir ? '/' : '');
                    }
                    return f + (isDir ? '/' : '');
                });
            completions = [...new Set([...completions, ...fileMatches])];
        }
    } catch (_) {
        completions = [...new Set(completions)];
    }

    const hits = completions.filter((c) => c.startsWith(lineFragment));
    if (hits.length === 1 && hits[0] === lineFragment && !lineFragment.endsWith('/')) {
        return [[hits[0] + ' '], lineFragment];
    }
    return [hits, lineFragment];
}
```

### renderLlmSuggestion(llmResult)

**Purpose**: Renders LLM suggestion result to console

**Parameters**:
- `llmResult` (LLMResult): Result from LLM

**Returns**: `{ok: boolean, singleCommand: string|null}`

**Implementation**:
```javascript
function renderLlmSuggestion(llmResult) {
    if (!llmResult?.status) {
        console.log('No suggestion received from the LLM. Try rephrasing your request.');
        return { ok: false, singleCommand: null };
    }

    if (llmResult.status === 'ok' && llmResult.suggestion) {
        const singleCommand = extractSingleCommandFromSuggestion(llmResult.suggestion);
        if (!singleCommand) {
            console.log('LLM suggested:');
            console.log(llmResult.suggestion);
        }
        return { ok: true, singleCommand };
    }

    if (llmResult.status === 'error' && llmResult.error) {
        if (llmResult.error.code === 401) {
            console.log('LLM call failed: API key invalid.');
        } else {
            console.log(`LLM call failed: ${llmResult.error.message}`);
        }
        return { ok: false, singleCommand: null };
    }

    console.log('No suggestion received from the LLM. Try rephrasing your request.');
    return { ok: false, singleCommand: null };
}
```

### runSuggestedCommand(commandText)

**Purpose**: Executes a suggested command using shell or direct spawn

**Parameters**:
- `commandText` (string): Command to execute

**Implementation**:
```javascript
async function runSuggestedCommand(commandText) {
    const trimmedSuggestion = (commandText || '').trim();
    if (!trimmedSuggestion) return;

    const shellMetaPattern = /[|&;<>(){}\[\]`$]/;
    if (shellMetaPattern.test(trimmedSuggestion)) {
        // Contains shell metacharacters - use shell
        console.log(`[LLM] Executing shell command: ${trimmedSuggestion}`);
        await new Promise((resolve) => {
            const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                try { restoreInput(); } catch (_) {}
                resolve();
            };
            let child;
            try {
                child = spawn(process.env.SHELL || 'bash', ['-lc', trimmedSuggestion], { stdio: 'inherit' });
            } catch (error) {
                console.error(`[LLM] Failed to start suggested command: ${error?.message || error}`);
                finish();
                return;
            }
            child.on('exit', (code) => {
                if (code && code !== 0) {
                    console.error(`[LLM] Command exited with code ${code}`);
                }
                finish();
            });
            child.on('error', (error) => {
                console.error(`[LLM] Failed to run suggested command: ${error?.message || error}`);
                finish();
            });
        });
        return;
    }

    // No shell metacharacters - direct spawn
    const argsToRun = trimmedSuggestion.split(/\s+/).filter(Boolean);
    if (!argsToRun.length) return;
    await new Promise((resolve) => {
        const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            try { restoreInput(); } catch (_) {}
            resolve();
        };
        let child;
        try {
            child = spawn(argsToRun[0], argsToRun.slice(1), { stdio: 'inherit' });
        } catch (error) {
            console.error(`[LLM] Failed to start suggested command: ${error?.message || error}`);
            finish();
            return;
        }
        child.on('exit', (code) => {
            if (code && code !== 0) {
                console.error(`[LLM] Command exited with code ${code}`);
            }
            finish();
        });
        child.on('error', (error) => {
            console.error(`[LLM] Failed to run suggested command: ${error?.message || error}`);
            finish();
        });
    });
}
```

### handleUserInput(rawInput)

**Purpose**: Main handler for user input - routes to help, settings, or LLM

**Parameters**:
- `rawInput` (string): User input

**Returns**: `Promise<boolean>` - Whether handling succeeded

**Implementation**:
```javascript
async function handleUserInput(rawInput) {
    const normalized = (rawInput || '').trim();
    if (!normalized) {
        console.log('Enter a command or question to get an LLM recommendation.');
        return false;
    }

    if (normalized === '/help' || normalized === 'help') {
        printShellHelp();
        return true;
    }

    if (normalized === SETTINGS_COMMAND || normalized === SETTINGS_ALIAS) {
        await handleSetEnv();
        return true;
    }

    // Try as system command first
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length) {
        const [cmd, ...options] = parts;
        const handled = await handleSystemCommand(cmd, options);
        if (handled) return true;
    }

    // Check for LLM key availability
    const keyState = await ensureLlmKeyAvailability();
    if (!keyState.ok) {
        showMissingKeyMessage(keyState.validKeys);
        return false;
    }

    // Query LLM
    console.log('Asking the LLM for guidance...');
    const llmResult = await suggestCommandWithLLM(normalized);
    const { ok, singleCommand } = renderLlmSuggestion(llmResult);
    if (!ok) {
        return false;
    }

    // Prompt to execute single command
    if (singleCommand) {
        if (process.stdin.isTTY) {
            const shouldExecute = await promptToExecuteSuggestedCommand(singleCommand);
            if (shouldExecute) {
                await runSuggestedCommand(singleCommand);
            }
        } else {
            console.log('LLM suggested command:');
            console.log(singleCommand);
        }
    }

    return true;
}
```

### startInteractiveMode()

**Purpose**: Starts interactive shell mode with readline

**Implementation**:
```javascript
function startInteractiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: process.stdin.isTTY ? shellCompleter : undefined,
        prompt: getColoredPrompt(),
    });
    inputState.registerInterface?.(rl);

    // Log environment details
    ensureLlmKeyAvailability()
        .then((state) => {
            const envPath = state?.envPath || resolveEnvFilePath(process.cwd());
            logEnvDetails(envPath);
            return logAvailableModels(state?.availableKeys || []);
        })
        .catch(() => {});

    console.log('Ploinky Shell mode. Ploinky commands are disabled; only LLM recommendations are available. Type \'exit\' or \'quit\' to leave.');
    logCurrentModelChoice()
        .catch(() => {})
        .finally(() => {
            rl.prompt();
        });

    rl.on('line', async (line) => {
        if (inputState.isSuspended && inputState.isSuspended()) {
            return;
        }
        const trimmed = (line || '').trim();
        if (trimmed === 'exit' || trimmed === 'quit') {
            rl.close();
            return;
        }
        await handleUserInput(trimmed);
        rl.setPrompt(getColoredPrompt());
        rl.prompt();
    });

    rl.on('SIGINT', () => {
        try { process.stdout.write('\n'); } catch (_) {}
        rl.close();
    });

    rl.on('close', () => {
        inputState.registerInterface?.(null);
        process.exit(0);
    });
}
```

### main()

**Purpose**: Entry point - handles args and mode selection

**Implementation**:
```javascript
async function main() {
    const args = process.argv.slice(2);
    const state = await ensureLlmKeyAvailability();
    const envPath = state?.envPath || resolveEnvFilePath(process.cwd());
    logEnvDetails(envPath);
    await logAvailableModels(state?.availableKeys || []);

    if (args.includes('-h') || args.includes('--help')) {
        printUsage();
        return;
    }

    if (args.join(' ').trim() === SETTINGS_COMMAND || args.join(' ').trim() === SETTINGS_ALIAS) {
        await handleSetEnv();
        process.exit(0);
    }

    if (args.length === 0) {
        startInteractiveMode();
        return;
    }

    await logCurrentModelChoice();

    // Single command mode
    const inlineInput = args.join(' ');
    const ok = await handleUserInput(inlineInput);
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(`ploinky-shell failed: ${error?.message || error}`);
    process.exit(1);
});
```

## State Management

- `envInfoLogged`: Tracks if environment info has been logged this session
- `modelsInfoLogged`: Tracks if model list has been logged this session
- `cachedKeyState`: Cached LLM API key availability state

## Integration Points

- `achillesAgentLib/utils/LLMClient.mjs`: LLM model prioritization
- `commands/llmSystemCommands.js`: LLM suggestion and command execution
- `services/llmProviderUtils.js`: API key management
- `services/settingsMenu.js`: Interactive settings configuration
- `services/inputState.js`: Input state management for child processes

## Usage Example

```bash
# Interactive shell mode
ploinky -l

# Single query
ploinky -l "how do I list docker containers"

# Open settings
ploinky -l /settings
```

## Edge Cases & Constraints

- Requires at least one LLM API key to function
- Shell metacharacters trigger shell execution vs direct spawn
- TTY mode required for command execution prompts
- Settings menu resets all caches on change

## Related Modules

- [cli-main.md](./cli-main.md) - Main CLI entry point
- [commands/llm-system-commands.md](./commands/commands-llm-system.md) - LLM command handling
- [services/llm-provider-utils.md](./services/utils/service-llm-provider-utils.md) - LLM provider utilities
