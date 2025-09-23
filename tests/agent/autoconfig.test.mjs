import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_KEYS = [
    'LLM_MODELS_CONFIG_PATH',
    'PLOINKY_SKIP_BUILTIN_PROVIDERS',
    'STUBA_API_KEY',
    'STUBB_API_KEY',
    'STUBB_MODEL_KEY',
];

const originalEnv = Object.fromEntries(
    ENV_KEYS.map(key => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]),
);

function restoreEnv() {
    for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
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
                module: './providers/stubProviderA.mjs',
            },
            stubb: {
                baseURL: 'https://stubb.example/v1',
                apiKeyEnv: 'STUBB_API_KEY',
                module: './providers/stubProviderB.mjs',
            },
            stubmissing: {
                baseURL: 'https://missing.example/v1',
                apiKeyEnv: 'STUBM_API_KEY',
                module: './providers/not-found.mjs',
            },
        },
        models: [
            { name: 'model-a-fast', provider: 'stuba', mode: 'fast' },
            { name: 'model-a-deep', provider: 'stuba', mode: 'deep' },
            {
                name: 'model-b-fast',
                provider: 'stubb',
                mode: 'fast',
                baseURL: 'https://stubb.example/model-fast',
                apiKeyEnv: 'STUBB_MODEL_KEY',
            },
            { name: 'model-b-invalid', provider: 'stubb', mode: 'fastest' },
        ],
    };

    fs.writeFileSync(path.join(clientDir, 'models.json'), JSON.stringify(config, null, 4));

    const stubModuleSource = `const calls = [];\nexport async function callLLM(history, options) {\n    calls.push({ historyLength: Array.isArray(history) ? history.length : 0, model: options?.model, providerKey: options?.providerKey });\n    return JSON.stringify({ provider: options?.providerKey, model: options?.model });\n}\nexport const __calls = calls;\nexport default { callLLM, __calls: calls };\n`;

    fs.writeFileSync(path.join(providersDir, 'stubProviderA.mjs'), stubModuleSource);
    fs.writeFileSync(path.join(providersDir, 'stubProviderB.mjs'), stubModuleSource);

    return {
        root,
        configPath: path.join(clientDir, 'models.json'),
        baseDir: clientDir,
    };
}

function cleanupFixture(fixture) {
    if (fixture?.root) {
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

function summarizeAgents(llmAgentModule) {
    if (typeof llmAgentModule.__resetForTests === 'function') {
        llmAgentModule.__resetForTests();
    }
    return llmAgentModule.listAgents();
}

function findProvider(summary, key, bucket = 'active') {
    return summary.agents[bucket]?.find(entry => entry.name === key || entry.providerKey === key) || null;
}

function freshImport(relativePath) {
    const resolved = path.resolve(__dirname, relativePath);
    const url = pathToFileURL(resolved);
    url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
    return import(url.href);
}

(async () => {
    let fixture;
    try {
        fixture = createFixture();

        process.env.LLM_MODELS_CONFIG_PATH = fixture.configPath;
        process.env.PLOINKY_SKIP_BUILTIN_PROVIDERS = '1';

        const modelsModule = await freshImport('../../Agent/client/modelsConfigLoader.mjs');
        const bootstrapModule = await freshImport('../../Agent/client/providerBootstrap.mjs');
        const providerRegistry = await freshImport('../../Agent/client/providerRegistry.mjs');
        const providersIndex = await freshImport('../../Agent/client/providers/index.mjs');

        providersIndex.resetBuiltInProviders?.();
        providerRegistry.resetProviders?.();

        const modelsConfiguration = modelsModule.loadModelsConfiguration({ configPath: fixture.configPath });
        await bootstrapModule.registerProvidersFromConfig(modelsConfiguration, { baseDir: fixture.baseDir });

        const llmAgent = await freshImport('../../Agent/client/LLMAgentClient.mjs');
        const llmClient = await freshImport('../../Agent/client/LLMClient.mjs');
        if (typeof llmAgent.__resetForTests !== 'function') {
            throw new Error('LLMAgentClient is missing __resetForTests export required for the test harness.');
        }

        const registeredProviders = providerRegistry.listProviders().sort();
        assert.deepStrictEqual(registeredProviders, ['stuba', 'stubb'], 'Only stub providers should be registered');

        const warningText = modelsConfiguration.issues.warnings.join(' \n');
        assert.ok(
            warningText.includes('Failed to register provider "stubmissing"'),
            'Expected warning for provider with missing module.'
        );

        const invalidModel = modelsConfiguration.models.get('model-b-invalid');
        assert.strictEqual(invalidModel.mode, 'fast', 'Invalid mode should normalize to fast');

        setProviderKeys({
            STUBA_API_KEY: 'token-a',
            STUBB_API_KEY: 'token-b',
            STUBB_MODEL_KEY: 'token-bm',
        });
        let summary = summarizeAgents(llmAgent);

        assert.deepStrictEqual(
            summary.agents.active.map(agent => agent.name).sort(),
            ['default', 'stuba', 'stubb'],
            'Both providers should be active when all keys are present.'
        );
        assert.strictEqual(summary.defaultAgent, 'default', 'Default agent should be named "default".');

        const stubbActive = findProvider(summary, 'stubb', 'active');
        assert.ok(stubbActive, 'stubb provider should be active.');
        assert.ok(stubbActive.fastModels.includes('model-b-fast'), 'stubb should expose the fast model.');

        await assert.rejects(
            llmClient.callLLM([], 'hi there', { providerKey: 'stuba', baseURL: 'https://stuba.example/v1', apiKey: 'token-a' }),
            /options\.model/,
            'callLLM should require options.model to be specified.'
        );
        const stubMissingSummary = findProvider(summary, 'stubmissing', 'inactive');
        assert.ok(stubMissingSummary, 'stubmissing provider should remain inactive.');

        setProviderKeys({
            STUBA_API_KEY: 'token-a',
            STUBB_MODEL_KEY: 'token-bm',
        });
        summary = summarizeAgents(llmAgent);
        assert.deepStrictEqual(
            summary.agents.active.map(provider => provider.name).sort(),
            ['default', 'stuba', 'stubb'],
            'Model-specific keys should keep provider stubb active even without the provider key.'
        );

        setProviderKeys({ STUBA_API_KEY: 'token-a' });
        summary = summarizeAgents(llmAgent);
        const activeNames = summary.agents.active.map(provider => provider.name);
        assert.ok(activeNames.includes('default'), 'default agent should remain available when some models have keys.');
        assert.ok(activeNames.includes('stuba'), 'stuba should remain active when its key is present.');
        assert.ok(!activeNames.includes('stubb'), 'stubb should become inactive without any API keys.');
        const stubbInactive = findProvider(summary, 'stubb', 'inactive');
        assert.ok(stubbInactive, 'stubb should appear in inactive providers.');
        assert.strictEqual(stubbInactive.reason, 'missing API keys');

        setProviderKeys({});
        summary = summarizeAgents(llmAgent);
        assert.strictEqual(summary.agents.active.length, 0, 'No agents should remain active when keys are cleared.');
        assert.strictEqual(summary.defaultAgent, null, 'Default agent should be null when registry is empty.');

        console.log('autoconfig behaviour test passed');
    } finally {
        cleanupFixture(fixture);
        restoreEnv();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
