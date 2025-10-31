import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { debugLog } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedValidApiKeys = null;
const LLM_CONFIG_RELATIVE_PATH = ['node_modules', 'ploinkyAgentLib', 'LLMConfig.json'];

function resolveLlmConfigPath() {
    const candidates = [
        path.resolve(process.cwd(), ...LLM_CONFIG_RELATIVE_PATH),
        path.resolve(__dirname, '..', '..', ...LLM_CONFIG_RELATIVE_PATH),
        path.resolve(__dirname, '..', '..', '..', ...LLM_CONFIG_RELATIVE_PATH)
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (error) {
            debugLog('resolveLlmConfigPath: check failed', error?.message || error);
        }
    }

    return candidates[0];
}

function loadValidLlmApiKeys() {
    if (cachedValidApiKeys) {
        return cachedValidApiKeys;
    }
    try {
        const configPath = resolveLlmConfigPath();
        if (!configPath || !fs.existsSync(configPath)) {
            cachedValidApiKeys = [];
            return cachedValidApiKeys;
        }
        const contents = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(contents);
        const providers = parsed?.providers || {};
        const keys = Object.values(providers)
            .map(entry => entry?.apiKeyEnv)
            .filter(Boolean);
        cachedValidApiKeys = Array.from(new Set(keys));
    } catch (error) {
        cachedValidApiKeys = [];
        debugLog('loadValidLlmApiKeys: unable to load config', error?.message || error);
    }
    return cachedValidApiKeys;
}

function parseEnvFile(envPath) {
    try {
        const contents = fs.readFileSync(envPath, 'utf8');
        const result = {};
        for (const rawLine of contents.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const equalIndex = line.indexOf('=');
            if (equalIndex === -1) continue;
            const key = line.slice(0, equalIndex).trim();
            if (!key) continue;
            let value = line.slice(equalIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
        return result;
    } catch (error) {
        debugLog('parseEnvFile: failed to read env file', error?.message || error);
        return {};
    }
}

function collectAvailableLlmKeys(envPath) {
    const validKeys = loadValidLlmApiKeys();
    if (!validKeys.length) return [];
    const envFileExists = Boolean(envPath && fs.existsSync(envPath));
    const envVars = envFileExists ? parseEnvFile(envPath) : {};

    return validKeys.filter((keyName) => {
        if (envFileExists) {
            const fileValue = envVars[keyName];
            return typeof fileValue === 'string' && fileValue.trim().length > 0;
        }
        const envValue = process.env[keyName];
        return typeof envValue === 'string' && envValue.trim().length > 0;
    });
}

export {
    loadValidLlmApiKeys,
    collectAvailableLlmKeys
};
