'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_IDS = [
    '../../Agent/client/LLMAgentClient',
    '../../Agent/client/LLMClient',
    '../../Agent/client/modelsConfigLoader',
    '../../Agent/client/providerRegistry',
    '../../Agent/client/providerBootstrap',
    '../../Agent/client/providers',
    '../../Agent/client/providers/index.js',
];

const ENV_KEYS = [
    'LLM_MODELS_CONFIG_PATH',
    'PLOINKY_SKIP_BUILTIN_PROVIDERS',
    'STUBA_API_KEY',
    'STUBB_API_KEY',
    'STUBB_MODEL_KEY',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]));

function restoreEnv() {
    for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
}

function clearModule(moduleId) {
    try {
        const resolved = require.resolve(moduleId);
        if (require.cache[resolved]) {
            delete require.cache[resolved];
        }
    } catch (error) {
        // Module may not have been loaded yet; ignore.
    }
}

function resetModuleCaches() {
    MODULE_IDS.forEach(clearModule);
}

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-autoconfig-'));
    const clientDir = path.join(root, 'Agent', 'client');
    const providersDir = path.join(clientDir, 'providers');
    fs.mkdirSync(providersDir, { recursive: true });

    const config = {
        providers: {
            stuba: {
                baseURL: 'https://stuba.example/v1',
                apiKeyEnv: 'STUBA_API_KEY',
                defaultModel: 'model-a-fast',
                module: './providers/stubProviderA.js',
            },
            stubb: {
                baseURL: 'https://stubb.example/v1',
                apiKeyEnv: 'STUBB_API_KEY',
                module: './providers/stubProviderB.js',
            },
            stubmissing: {
                baseURL: 'https://missing.example/v1',
                apiKeyEnv: 'STUBM_API_KEY',
                module: './providers/not-found.js',
            },
        },
        models: {
            'model-a-fast': { provider: 'stuba', mode: 'fast' },
            'model-a-deep': { provider: 'stuba', mode: 'deep' },
            'model-b-fast': {
                provider: 'stubb',
                mode: 'fast',
                baseURL: 'https://stubb.example/model-fast',
                apiKeyEnv: 'STUBB_MODEL_KEY',
            },
            'model-b-invalid': { provider: 'stubb', mode: 'fastest' },
        },
    };

    fs.writeFileSync(path.join(clientDir, 'models.json'), JSON.stringify(config, null, 4));

    const stubModuleSource = `'use strict';\nconst calls = [];\nasync function callLLM(history, options) {\n    calls.push({ historyLength: Array.isArray(history) ? history.length : 0, model: options?.model, providerKey: options?.providerKey });\n    return JSON.stringify({ provider: options?.providerKey, model: options?.model });\n}\nmodule.exports = { callLLM, __calls: calls };\n`;

    fs.writeFileSync(path.join(providersDir, 'stubProviderA.js'), stubModuleSource);
    fs.writeFileSync(path.join(providersDir, 'stubProviderB.js'), stubModuleSource);

    return {
        root,
        configPath: path.join(clientDir, 'models.json'),
        baseDir: clientDir,
    };
}

function cleanupFixture(fixture) {
    if (fixture && fixture.root) {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
}

function setProviderKeys(values) {
    ['STUBA_API_KEY', 'STUBB_API_KEY', 'STUBB_MODEL_KEY'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            process.env[key] = values[key];
        } else {
            delete process.env[key];
        }
    });
}

function summarizeAgents(llmAgent) {
    if (typeof llmAgent.__resetForTests === 'function') {
        llmAgent.__resetForTests();
    }
    return llmAgent.listAgents();
}

function findProvider(summary, key, bucket = 'active') {
    return summary.providers[bucket]?.find(entry => entry.providerKey === key) || null;
}

let fixture;

try {
    fixture = createFixture();

    process.env.LLM_MODELS_CONFIG_PATH = fixture.configPath;
    process.env.PLOINKY_SKIP_BUILTIN_PROVIDERS = '1';

    resetModuleCaches();

    const { loadModelsConfiguration } = require('../../Agent/client/modelsConfigLoader');
    const { registerProvidersFromConfig } = require('../../Agent/client/providerBootstrap');
    const providerRegistry = require('../../Agent/client/providerRegistry');
    const providersIndex = require('../../Agent/client/providers');

    if (typeof providersIndex.resetBuiltInProviders === 'function') {
        providersIndex.resetBuiltInProviders();
    }
    if (typeof providerRegistry.resetProviders === 'function') {
        providerRegistry.resetProviders();
    }

    const modelsConfiguration = loadModelsConfiguration({ configPath: fixture.configPath });
    registerProvidersFromConfig(modelsConfiguration, { baseDir: fixture.baseDir });

    const llmAgent = require('../../Agent/client/LLMAgentClient');
    if (typeof llmAgent.__resetForTests !== 'function') {
        throw new Error('LLMAgentClient is missing __resetForTests export required for the test harness.');
    }

    // Provider registration sanity checks
    const registeredProviders = providerRegistry.listProviders().sort();
    assert.deepStrictEqual(registeredProviders, ['stuba', 'stubb'], 'Only stub providers should be registered');

    const warningText = modelsConfiguration.issues.warnings.join(' \n');
    assert.ok(
        warningText.includes('Failed to register provider "stubmissing"'),
        'Expected warning for provider with missing module.'
    );

    const invalidModel = modelsConfiguration.models.get('model-b-invalid');
    assert.strictEqual(invalidModel.mode, 'fast', 'Invalid mode should normalize to fast');

    // Scenario 1: all keys present
    setProviderKeys({
        STUBA_API_KEY: 'token-a',
        STUBB_API_KEY: 'token-b',
        STUBB_MODEL_KEY: 'token-bm',
    });
    let summary = summarizeAgents(llmAgent);

    assert.deepStrictEqual(
        summary.providers.active.map(provider => provider.providerKey).sort(),
        ['stuba', 'stubb'],
        'Both providers should be active when all keys are present.'
    );
    assert.strictEqual(summary.defaultAgent, 'stuba', 'Default agent should prefer stuba when active.');

    const stubbActive = findProvider(summary, 'stubb', 'active');
    assert.ok(stubbActive, 'stubb provider should be active.');
    assert.ok(
        stubbActive.availableModels.some(model => model.name === 'model-b-fast' && model.mode === 'fast'),
        'stubb should expose the fast model.'
    );

    const stubMissingSummary = findProvider(summary, 'stubmissing', 'inactive');
    assert.ok(stubMissingSummary, 'stubmissing provider should remain inactive.');

    // Scenario 2: provider-level key missing, model override available
    setProviderKeys({
        STUBA_API_KEY: 'token-a',
        STUBB_MODEL_KEY: 'token-bm',
    });
    summary = summarizeAgents(llmAgent);
    assert.deepStrictEqual(
        summary.providers.active.map(provider => provider.providerKey).sort(),
        ['stuba', 'stubb'],
        'Model-specific keys should keep provider stubb active even without the provider key.'
    );

    // Scenario 3: all stubb keys missing
    setProviderKeys({ STUBA_API_KEY: 'token-a' });
    summary = summarizeAgents(llmAgent);
    assert.deepStrictEqual(
        summary.providers.active.map(provider => provider.providerKey),
        ['stuba'],
        'stubb should become inactive without any API keys.'
    );
    const stubbInactive = findProvider(summary, 'stubb', 'inactive');
    assert.ok(stubbInactive, 'stubb should appear in inactive providers.');
    assert.strictEqual(stubbInactive.reason, 'missing API keys');

    // Scenario 4: no providers active
    setProviderKeys({});
    summary = summarizeAgents(llmAgent);
    assert.strictEqual(summary.providers.active.length, 0, 'No providers should remain active when keys are cleared.');
    assert.strictEqual(summary.defaultAgent, null, 'Default agent should be null when registry is empty.');

    console.log('autoconfig behaviour test passed');
} catch (error) {
    cleanupFixture(fixture);
    resetModuleCaches();
    restoreEnv();
    throw error;
} finally {
    cleanupFixture(fixture);
    resetModuleCaches();
    restoreEnv();
}
