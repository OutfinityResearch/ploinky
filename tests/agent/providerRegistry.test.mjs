import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerBuiltInProviders, resetBuiltInProviders } from '../../Agent/client/providers/index.mjs';
import { registerProvidersFromConfig } from '../../Agent/client/providerBootstrap.mjs';
import { getProvider, resetProviders } from '../../Agent/client/providerRegistry.mjs';
import { loadModelsConfiguration } from '../../Agent/client/modelsConfigLoader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

resetBuiltInProviders();
resetProviders();

registerBuiltInProviders();

const configPath = path.join(__dirname, '../../Agent/client/models.json');
const modelsConfiguration = loadModelsConfiguration({ configPath });
await registerProvidersFromConfig(modelsConfiguration, { baseDir: path.dirname(configPath) });

const openaiProvider = getProvider('openai');
assert.ok(openaiProvider, 'openai provider should be registered');
assert.strictEqual(typeof openaiProvider.callLLM, 'function', 'openai provider must expose callLLM');

const googleProvider = getProvider('google');
assert.ok(googleProvider, 'google provider should be registered');
assert.strictEqual(typeof googleProvider.callLLM, 'function', 'google provider must expose callLLM');

console.log('providerRegistry test passed');
