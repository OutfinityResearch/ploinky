const { registerProvider } = require('../providerRegistry');
const openai = require('./openai');
const google = require('./google');
const anthropic = require('./anthropic');
const huggingFace = require('./huggingFace');


let registered = false;

function registerBuiltInProviders(options = {}) {
    if (registered) {
        return;
    }

    const skip = options.skip || process.env.PLOINKY_SKIP_BUILTIN_PROVIDERS === '1';
    if (skip) {
        registered = true;
        return;
    }

    registerProvider({ key: 'openai', handler: openai, metadata: { module: './providers/openai.js' } });
    registerProvider({ key: 'google', handler: google, metadata: { module: './providers/google.js' } });
    registerProvider({ key: 'anthropic', handler: anthropic, metadata: { module: './providers/anthropic.js' } });
    registerProvider({ key: 'huggingface', handler: huggingFace, metadata: { module: './providers/huggingFace.js' } });
    registerProvider({ key: 'openrouter', handler: openai, metadata: { module: './providers/openai.js' } });
    registerProvider({ key: 'custom', handler: openai, metadata: { module: './providers/openai.js' } });

    registered = true;
}

module.exports = {
    registerBuiltInProviders,
    resetBuiltInProviders: () => { registered = false; },
};
