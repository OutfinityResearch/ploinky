const path = require('path');
const { registerProvider } = require('./providerRegistry');

function resolveModuleExports(moduleId, baseDir) {
    const resolvedId = moduleId.startsWith('.') || moduleId.startsWith('/')
        ? path.resolve(baseDir, moduleId)
        : moduleId;
    const exports = require(resolvedId);
    return { exports, resolvedId };
}

function extractHandler(exports) {
    if (!exports) {
        return null;
    }

    if (typeof exports.callLLM === 'function') {
        return exports;
    }

    if (typeof exports === 'function') {
        return { callLLM: exports };
    }

    if (exports.default) {
        return extractHandler(exports.default);
    }

    return null;
}

function registerProvidersFromConfig(modelsConfiguration, options = {}) {
    const warnings = [];
    const baseDir = options.baseDir
        || (modelsConfiguration.path ? path.dirname(modelsConfiguration.path) : __dirname);

    for (const provider of modelsConfiguration.providers.values()) {
        const moduleId = provider.module;
        if (!moduleId) {
            continue;
        }

        try {
            const { exports, resolvedId } = resolveModuleExports(moduleId, baseDir);
            const handler = extractHandler(exports);
            if (!handler) {
                warnings.push(`Provider "${provider.providerKey}" module "${moduleId}" does not export a callLLM handler.`);
                continue;
            }

            registerProvider({
                key: provider.providerKey,
                handler,
                metadata: {
                    module: moduleId,
                    resolvedModule: resolvedId,
                    source: 'config',
                },
            });
        } catch (error) {
            warnings.push(`Failed to register provider "${provider.providerKey}" from module "${moduleId}": ${error.message}`);
        }
    }

    if (warnings.length && modelsConfiguration?.issues?.warnings) {
        modelsConfiguration.issues.warnings.push(...warnings);
    }

    return warnings;
}

module.exports = {
    registerProvidersFromConfig,
};
