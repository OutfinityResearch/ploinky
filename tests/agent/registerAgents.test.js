'use strict';

const assert = require('assert');

const llmAgentClient = require('../../Agent/client/LLMAgentClient');

const TRACKED_KEYS = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'HUGGINGFACE_API_KEY',
    'OPENROUTER_API_KEY',
];

const originalEnv = Object.fromEntries(
    TRACKED_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]),
);

function restoreTrackedEnv() {
    for (const key of TRACKED_KEYS) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
}

function resetAgentState(envOverrides = {}) {
    llmAgentClient.__resetForTests();
    for (const key of TRACKED_KEYS) {
        delete process.env[key];
    }
    Object.entries(envOverrides).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    });
}

(async () => {
    try {
        resetAgentState({ OPENAI_API_KEY: 'stub-openai-key' });

        const customRegistration = llmAgentClient.registerLLMAgent({
            name: 'customTasker',
            role: 'Specialist',
            fastModels: ['gpt-4o-mini'],
            deepModels: ['gpt-5'],
        });

        assert.strictEqual(customRegistration.status, 'active');
        assert.strictEqual(customRegistration.agent.name, 'customTasker');

        const activeSummary = llmAgentClient.listAgents();
        const customAgent = activeSummary.agents.active.find((agent) => agent.name === 'customTasker');
        assert.ok(customAgent, 'Expected custom agent to appear in active list.');
        assert.strictEqual(customAgent.providerKey, 'openai');
        assert.ok(customAgent.fastModels.includes('gpt-4o-mini'));
        assert.ok(customAgent.deepModels.includes('gpt-5'));

        resetAgentState();

        const inactiveRegistration = llmAgentClient.registerLLMAgent({
            name: 'needsKeys',
        });

        assert.strictEqual(inactiveRegistration.status, 'inactive');
        assert.strictEqual(inactiveRegistration.reason, 'missing API keys');

        const inactiveSummary = llmAgentClient.listAgents();
        const inactiveAgent = inactiveSummary.agents.inactive.find((agent) => agent.name === 'needsKeys');
        assert.ok(inactiveAgent, 'Expected agent without keys to appear in inactive list.');
        assert.strictEqual(inactiveAgent.reason, 'missing API keys');

        resetAgentState({ OPENAI_API_KEY: 'stub-openai-key' });

        const autoRegistration = llmAgentClient.registerLLMAgent({ name: 'autoDefaults' });

        assert.strictEqual(autoRegistration.status, 'active');
        assert.deepStrictEqual(
            new Set(autoRegistration.agent.availableModels),
            new Set(['gpt-4o-mini', 'gpt-5-mini', 'gpt-5', 'gpt-4.1'])
        );
        ['gpt-4o-mini', 'gpt-5-mini'].forEach((model) => {
            assert.ok(autoRegistration.agent.fastModels.includes(model), `Expected fast model ${model}`);
        });
        ['gpt-5', 'gpt-4.1'].forEach((model) => {
            assert.ok(autoRegistration.agent.deepModels.includes(model), `Expected deep model ${model}`);
        });

        const autoSummary = llmAgentClient.listAgents();
        const autoAgent = autoSummary.agents.active.find((agent) => agent.name === 'autoDefaults');
        assert.ok(autoAgent, 'Expected auto-configured agent to be active.');
        assert.strictEqual(autoAgent.providerKey, 'openai');

        resetAgentState({ OPENAI_API_KEY: 'stub-openai-key' });

        llmAgentClient.registerDefaultLLMAgent({});

        const defaultSummary = llmAgentClient.listAgents();
        const defaultAgent = defaultSummary.agents.active.find((agent) => agent.name === 'default');
        assert.ok(defaultAgent, 'Expected default agent to be active.');
        assert.ok(defaultAgent.fastModels.includes('gpt-4o-mini'));
        assert.ok(defaultAgent.availableModels.includes('gpt-4o-mini'));

        console.log('Agent registration behaviors verified.');
    } finally {
        restoreTrackedEnv();
        llmAgentClient.__resetForTests();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
