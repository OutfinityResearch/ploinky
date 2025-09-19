'use strict';

const assert = require('assert');
const path = require('path');

const { registerBuiltInProviders } = require('../../Agent/client/providers');
const { registerProvidersFromConfig } = require('../../Agent/client/providerBootstrap');
const { getProvider } = require('../../Agent/client/providerRegistry');
const { loadModelsConfiguration } = require('../../Agent/client/modelsConfigLoader');

registerBuiltInProviders();

const configPath = path.join(__dirname, '../../Agent/client/models.json');
const modelsConfiguration = loadModelsConfiguration({ configPath });
registerProvidersFromConfig(modelsConfiguration, { baseDir: path.dirname(configPath) });

const openaiProvider = getProvider('openai');
assert.ok(openaiProvider, 'openai provider should be registered');
assert.strictEqual(typeof openaiProvider.callLLM, 'function', 'openai provider must expose callLLM');

const googleProvider = getProvider('google');
assert.ok(googleProvider, 'google provider should be registered');
assert.strictEqual(typeof googleProvider.callLLM, 'function', 'google provider must expose callLLM');

console.log('providerRegistry test passed');
