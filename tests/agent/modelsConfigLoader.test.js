'use strict';

const assert = require('assert');

const { loadModelsConfiguration } = require('../../Agent/client/modelsConfigLoader');

const config = loadModelsConfiguration();

assert.ok(config.providers instanceof Map, 'providers should be a Map');
assert.ok(config.models instanceof Map, 'models should be a Map');
assert.ok(config.providers.has('openai'), 'openai provider should be defined');
assert.ok(config.models.has('gpt-4o-mini'), 'gpt-4o-mini model should be defined');

const gpt4oMini = config.models.get('gpt-4o-mini');
assert.strictEqual(gpt4oMini.mode, 'fast', 'gpt-4o-mini mode should normalize to fast');

console.log('modelsConfigLoader sanity check passed');
