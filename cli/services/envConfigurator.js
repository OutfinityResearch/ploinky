import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { populateProcessEnvFromEnvFile, resolveEnvFilePath, collectAvailableLlmKeys } from './llmProviderUtils.js';
import * as inputState from './inputState.js';

const VAR_SPECS = [
    { key: 'ACHILLES_ENABLED_DEEP_MODELS', label: 'Enabled deep model', type: 'model', mode: 'deep' },
    { key: 'ACHILLES_ENABLED_FAST_MODELS', label: 'Enabled fast model', type: 'model', mode: 'fast' },
    { key: 'ACHILLES_DEFAULT_MODEL_TYPE', label: 'Default model type', type: 'enum', options: ['fast', 'deep'] },
    { key: 'ACHILLES_DEBUG', label: 'Debug logging', type: 'enum', options: ['true', 'false'] },
];

function resolveLlmConfigPath() {
    const candidates = [
        path.resolve(process.cwd(), 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'achillesAgentLib', 'LLMConfig.json'),
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

    // dedupe by name
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

function parseCurrentModelValue(raw) {
    if (!raw) return 'unset';
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'string') {
            return parsed[0];
        }
    } catch (_) { /* noop */ }
    return raw;
}

function formatModelValue(modelName) {
    if (!modelName || modelName === 'unset') return null;
    return JSON.stringify([modelName]);
}

function buildValueOptions(spec, models) {
    if (spec.type === 'enum') {
        return ['unset', ...spec.options];
    }
    if (spec.type === 'model') {
        const list = spec.mode === 'deep' ? models.deep : models.fast;
        return ['unset', ...list.map((entry) => `${entry.name} [${entry.provider}]`)];
    }
    return ['unset'];
}

function extractValueFromOption(option) {
    if (!option || option === 'unset') return 'unset';
    const bracketIndex = option.indexOf(' [');
    if (bracketIndex !== -1) {
        return option.slice(0, bracketIndex);
    }
    return option;
}

function getCurrentValueDisplay(spec) {
    const raw = process.env[spec.key];
    if (!raw) return 'unset';
    if (spec.type === 'model') {
        return parseCurrentModelValue(raw);
    }
    return raw;
}

function applyValue(spec, optionValue) {
    if (optionValue === 'unset') {
        delete process.env[spec.key];
        return;
    }
    if (spec.type === 'model') {
        const formatted = formatModelValue(optionValue);
        if (formatted) {
            process.env[spec.key] = formatted;
        } else {
            delete process.env[spec.key];
        }
        return;
    }
    process.env[spec.key] = optionValue;
}

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
        if (renderState.rendered && renderState.lines > 0) {
            readline.moveCursor(process.stdout, 0, -renderState.lines);
            readline.cursorTo(process.stdout, 0);
            readline.clearScreenDown(process.stdout);
        }

        const lines = [
            '=== Ploinky Env Config ===',
            'Arrow Up/Down to navigate, Enter to edit, Esc/Backspace to exit.',
            '',
        ];

        variables.forEach((entry, idx) => {
            const pointer = idx === selectedVar ? '>' : ' ';
            const current = entry.current;
            lines.push(`${pointer} ${entry.label}: ${current}`);
            if (selectingValue && idx === selectedVar) {
                valueOptions.forEach((opt, vIdx) => {
                    const vPointer = vIdx === selectedValueIndex ? '>' : ' ';
                    lines.push(`   ${vPointer} ${opt}`);
                });
            }
        });

        const output = `${lines.join('\n')}\n`;
        process.stdout.write(output);
        renderState.rendered = true;
        renderState.lines = (output.match(/\n/g) || []).length;
    };

    render.clear = clear;
    return render;
}

export async function runEnvConfigurator({ onEnvChange } = {}) {
    if (!process.stdin.isTTY) {
        console.log('Interactive TTY is required for env configuration.');
        return;
    }

    const envPath = resolveEnvFilePath(process.cwd());
    populateProcessEnvFromEnvFile(envPath);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const modelOptions = loadModelOptions(availableKeys);

    const variables = VAR_SPECS.map((spec) => ({
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
    const menuRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });
    readline.emitKeypressEvents(menuRl.input);
    const wasRaw = Boolean(menuRl.input.isRaw);
    try { menuRl.input.setRawMode(true); } catch (_) { /* noop */ }
    try { menuRl.input.resume(); } catch (_) { /* noop */ }

    let keyHandler = null;

    const cleanup = () => {
        try { renderMenu.clear?.(); } catch (_) { /* noop */ }
        try { menuRl.input.setRawMode(wasRaw); } catch (_) { /* noop */ }
        try { if (keyHandler) menuRl.input.off('keypress', keyHandler); } catch (_) { /* noop */ }
        try { menuRl.close(); } catch (_) { /* noop */ }
        restoreInput();
    };

    return await new Promise((resolve) => {
        const onKey = (str, key) => {
            if (key?.name === 'escape' || key?.name === 'backspace' || (key?.ctrl && key.name === 'c')) {
                cleanup();
                return resolve(0);
            }
            if (key?.name === 'up') {
                if (state.selectingValue) {
                    state.selectedValueIndex = (state.selectedValueIndex - 1 + state.valueOptions.length) % state.valueOptions.length;
                } else {
                    state.selectedVar = (state.selectedVar - 1 + state.variables.length) % state.variables.length;
                    state.valueOptions = buildValueOptions(state.variables[state.selectedVar], modelOptions);
                    state.selectedValueIndex = 0;
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
                    state.selectedValueIndex = 0;
                }
                renderMenu(state);
                return;
            }
            if (key?.name === 'return') {
                if (!state.selectingValue) {
                    state.selectingValue = true;
                    renderMenu(state);
                    return;
                }
                const spec = state.variables[state.selectedVar];
                const option = state.valueOptions[state.selectedValueIndex];
                const value = extractValueFromOption(option);
                applyValue(spec, value);
                if (typeof onEnvChange === 'function') {
                    try { onEnvChange(spec.key, value); } catch (_) { /* noop */ }
                }
                state.variables[state.selectedVar].current = getCurrentValueDisplay(spec);
                state.selectingValue = false;
                renderMenu(state);
                return;
            }
        };

        keyHandler = onKey;
        menuRl.input.on('keypress', keyHandler);
        renderMenu(state);
    }).finally(() => {
        cleanup();
    });
}
