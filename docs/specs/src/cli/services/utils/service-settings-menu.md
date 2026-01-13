# cli/services/settingsMenu.js - Settings Menu

## Overview

Provides an interactive terminal-based settings menu for configuring LLM models and environment variables. Displays available models filtered by API keys present in the environment.

## Source File

`cli/services/settingsMenu.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { populateProcessEnvFromEnvFile, resolveEnvFilePath, collectAvailableLlmKeys } from './llmProviderUtils.js';
import * as inputState from './inputState.js';
```

## Constants

```javascript
// Configurable environment variables
const VAR_SPECS = [
    { key: 'ACHILLES_ENABLED_DEEP_MODELS', label: 'Enabled deep model', type: 'model', mode: 'deep' },
    { key: 'ACHILLES_ENABLED_FAST_MODELS', label: 'Enabled fast model', type: 'model', mode: 'fast' },
    { key: 'ACHILLES_DEFAULT_MODEL_TYPE', label: 'Default model type', type: 'enum', options: ['fast', 'deep'] },
    { key: 'ACHILLES_DEBUG', label: 'Debug logging', type: 'enum', options: ['true', 'false'] },
];
```

## Data Structures

```javascript
/**
 * @typedef {Object} VarSpec
 * @property {string} key - Environment variable name
 * @property {string} label - Display label
 * @property {string} type - 'model' or 'enum'
 * @property {string} [mode] - 'fast' or 'deep' (for type='model')
 * @property {string[]} [options] - Enum options (for type='enum')
 */

/**
 * @typedef {Object} ModelEntry
 * @property {string} name - Model name
 * @property {string} provider - Provider key
 * @property {number} inputPrice - Input price per 1M tokens
 * @property {number} outputPrice - Output price per 1M tokens
 * @property {number} context - Context window size
 */

/**
 * @typedef {Object} MenuState
 * @property {Object[]} variables - Variable entries with current values
 * @property {number} selectedVar - Currently selected variable index
 * @property {boolean} selectingValue - In value selection mode
 * @property {number} selectedValueIndex - Selected value option index
 * @property {string[]} valueOptions - Available value options
 */
```

## Internal Functions

### resolveLlmConfigPath()

**Purpose**: Finds LLMConfig.json path

**Returns**: (string) Path to LLMConfig.json

**Search Locations**:
1. `./node_modules/achillesAgentLib/LLMConfig.json`
2. `../../../node_modules/achillesAgentLib/LLMConfig.json`

**Implementation**:
```javascript
function resolveLlmConfigPath() {
    const candidates = [
        path.resolve(process.cwd(), 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}
```

### loadModelOptions(availableKeys)

**Purpose**: Loads available models filtered by API keys

**Parameters**:
- `availableKeys` (string[]): Available API key environment variable names

**Returns**: `{ fast: ModelEntry[], deep: ModelEntry[] }`

**Implementation**:
```javascript
function loadModelOptions(availableKeys) {
    const configPath = resolveLlmConfigPath();
    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
        return { fast: [], deep: [] };
    }

    const providers = parsed.providers || {};
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    const keySet = new Set((availableKeys || []).map(k => k && k.trim()).filter(Boolean));
    const result = { fast: [], deep: [] };

    for (const model of models) {
        const name = model?.name;
        const mode = model?.mode === 'deep' ? 'deep' : 'fast';
        const providerKey = model?.provider || model?.providerKey;
        if (!name || !providerKey) continue;

        const providerCfg = providers[providerKey];
        const apiKeyEnv = providerCfg?.apiKeyEnv;
        if (!apiKeyEnv || !keySet.has(apiKeyEnv)) continue;

        result[mode].push({
            name,
            provider: providerKey,
            inputPrice: model?.inputPrice,
            outputPrice: model?.outputPrice,
            context: model?.context
        });
    }

    // Dedupe by name
    for (const key of Object.keys(result)) {
        const seen = new Set();
        result[key] = result[key].filter(entry => {
            if (seen.has(entry.name)) return false;
            seen.add(entry.name);
            return true;
        });
    }
    return result;
}
```

### parseCurrentModelValue(raw)

**Purpose**: Parses current model value from environment

**Parameters**:
- `raw` (string): Raw environment value (JSON array or string)

**Returns**: (string) Model name or 'unset'

**Implementation**:
```javascript
function parseCurrentModelValue(raw) {
    if (!raw) return 'unset';
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'string') {
            return parsed[0];
        }
    } catch (_) {}
    return raw;
}
```

### formatModelValue(modelName)

**Purpose**: Formats model name for environment storage

**Parameters**:
- `modelName` (string): Model name

**Returns**: (string|null) JSON array string or null

**Implementation**:
```javascript
function formatModelValue(modelName) {
    if (!modelName || modelName === 'unset') return null;
    return JSON.stringify([modelName]);
}
```

### formatPrice(value)

**Purpose**: Formats price for display

**Parameters**:
- `value` (number|null): Price value

**Returns**: (string) Formatted price (e.g., '$0.01')

**Implementation**:
```javascript
function formatPrice(value) {
    if (value === null || value === undefined) return '?';
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return `$${num}`;
}
```

### formatModelOption(entry)

**Purpose**: Formats model entry for display

**Parameters**:
- `entry` (ModelEntry): Model entry

**Returns**: (string) Formatted string (e.g., 'gpt-4 [openai] ($0.03/$0.06, ctx 128000)')

**Implementation**:
```javascript
function formatModelOption(entry) {
    if (!entry) return 'unset';
    const priceIn = formatPrice(entry.inputPrice);
    const priceOut = formatPrice(entry.outputPrice);
    const ctx = entry.context || '?';
    return `${entry.name} [${entry.provider}] (${priceIn}/${priceOut}, ctx ${ctx})`;
}
```

### createMenuRenderer()

**Purpose**: Creates a stateful menu renderer

**Returns**: (Function) Render function with `clear` method

**Behavior**:
- Tracks rendered lines count
- Clears previous output before re-rendering
- Supports arrow-based navigation display

**Implementation**:
```javascript
function createMenuRenderer() {
    const renderState = { rendered: false, lines: 0 };

    const clear = () => {
        if (!renderState.rendered || renderState.lines <= 0) return;
        readline.moveCursor(process.stdout, 0, -renderState.lines);
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);
        renderState.rendered = false;
        renderState.lines = 0;
    };

    const render = (state) => {
        const { variables, selectedVar, selectingValue, selectedValueIndex, valueOptions } = state;

        // Clear previous render
        if (renderState.rendered && renderState.lines > 0) {
            readline.moveCursor(process.stdout, 0, -renderState.lines);
            readline.cursorTo(process.stdout, 0);
            readline.clearScreenDown(process.stdout);
        }

        const lines = [
            '=== Ploinky Env Config ===',
            '(Prices shown per 1M tokens: input/output)',
            'Arrow Up/Down to navigate, Enter to edit, Esc/Backspace to exit.',
            '',
        ];

        variables.forEach((entry, idx) => {
            const pointer = idx === selectedVar ? '>' : ' ';
            lines.push(`${pointer} ${entry.label}: ${entry.current}`);
            if (selectingValue && idx === selectedVar) {
                valueOptions.forEach((opt, vIdx) => {
                    const vPointer = vIdx === selectedValueIndex ? '>' : ' ';
                    lines.push(`   ${vPointer} ${opt}`);
                });
            }
        });

        process.stdout.write(`${lines.join('\n')}\n`);
        renderState.rendered = true;
        renderState.lines = lines.length;
    };

    render.clear = clear;
    return render;
}
```

## Public API

### runSettingsMenu(options)

**Purpose**: Runs the interactive settings menu

**Parameters**:
- `options` (Object):
  - `onEnvChange` (Function): Callback when env var changes `(key, value) => void`

**Returns**: (Promise<number>) Exit code (0)

**Requirements**: TTY terminal required

**Key Bindings**:
| Key | Action |
|-----|--------|
| Up Arrow | Move selection up |
| Down Arrow | Move selection down |
| Enter | Enter value selection / Confirm value |
| Escape | Exit menu |
| Backspace | Exit menu |
| Ctrl+C | Exit menu |

**Implementation**:
```javascript
export async function runSettingsMenu({ onEnvChange } = {}) {
    if (!process.stdin.isTTY) {
        console.log('Interactive TTY is required for env configuration.');
        return;
    }

    // Load environment and available API keys
    const envPath = resolveEnvFilePath(process.cwd());
    populateProcessEnvFromEnvFile(envPath);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const modelOptions = loadModelOptions(availableKeys);

    // Initialize state
    const variables = VAR_SPECS.map(spec => ({
        ...spec,
        current: getCurrentValueDisplay(spec),
    }));

    let state = {
        variables,
        selectedVar: 0,
        selectingValue: false,
        selectedValueIndex: 0,
        valueOptions: buildValueOptions(variables[0], modelOptions),
    };

    const renderMenu = createMenuRenderer();
    const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    return await new Promise((resolve) => {
        const onKey = (str, key) => {
            // Exit on escape/backspace/ctrl+c
            if (key?.name === 'escape' || key?.name === 'backspace' ||
                (key?.ctrl && key.name === 'c')) {
                cleanup();
                return resolve(0);
            }

            // Navigation
            if (key?.name === 'up') {
                if (state.selectingValue) {
                    state.selectedValueIndex = (state.selectedValueIndex - 1 + state.valueOptions.length) % state.valueOptions.length;
                } else {
                    state.selectedVar = (state.selectedVar - 1 + state.variables.length) % state.variables.length;
                    state.valueOptions = buildValueOptions(state.variables[state.selectedVar], modelOptions);
                }
                renderMenu(state);
                return;
            }

            if (key?.name === 'down') {
                if (state.selectingValue) {
                    state.selectedValueIndex = (state.selectedValueIndex + 1) % state.valueOptions.length;
                } else {
                    state.selectedVar = (state.selectedVar + 1) % state.variables.length;
                    state.valueOptions = buildValueOptions(state.variables[state.selectedVar], modelOptions);
                }
                renderMenu(state);
                return;
            }

            // Selection
            if (key?.name === 'return') {
                if (!state.selectingValue) {
                    state.selectingValue = true;
                    renderMenu(state);
                    return;
                }

                // Apply selected value
                const spec = state.variables[state.selectedVar];
                const option = state.valueOptions[state.selectedValueIndex];
                const value = extractValueFromOption(option);
                applyValue(spec, value);

                if (typeof onEnvChange === 'function') {
                    onEnvChange(spec.key, value);
                }

                state.variables[state.selectedVar].current = getCurrentValueDisplay(spec);
                state.selectingValue = false;
                renderMenu(state);
            }
        };

        process.stdin.on('keypress', onKey);
        renderMenu(state);
    });
}
```

## Menu Display

```
=== Ploinky Env Config ===
(Prices shown per 1M tokens: input/output)
Arrow Up/Down to navigate, Enter to edit, Esc/Backspace to exit.

> Enabled deep model: gpt-4-turbo
  Enabled fast model: gpt-3.5-turbo
  Default model type: fast
  Debug logging: false
```

When selecting a value:
```
> Enabled deep model: gpt-4-turbo
   > unset
     gpt-4 [openai] ($0.03/$0.06, ctx 128000)
     gpt-4-turbo [openai] ($0.01/$0.03, ctx 128000)
     claude-3-opus [anthropic] ($0.015/$0.075, ctx 200000)
```

## Exports

```javascript
export { runSettingsMenu };
```

## Usage Example

```javascript
import { runSettingsMenu } from './settingsMenu.js';

// Run interactive menu
await runSettingsMenu({
    onEnvChange: (key, value) => {
        console.log(`Setting ${key} = ${value}`);
    }
});
```

## Related Modules

- [service-llm-provider-utils.md](./service-llm-provider-utils.md) - LLM provider utilities
- [service-input-state.md](./service-input-state.md) - Input state management
- [commands-env-vars.md](../../commands/commands-env-vars.md) - Environment commands
