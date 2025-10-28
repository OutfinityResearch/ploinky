import { createBrowserTtsStrategy } from './browser.js';
import { createOpenAITtsStrategy } from './openai.js';
import { createNoopTtsStrategy } from './noop.js';

const KNOWN_PROVIDERS = new Map([
    ['browser', createBrowserTtsStrategy],
    ['openai', createOpenAITtsStrategy],
    ['none', () => createNoopTtsStrategy()]
]);

export function createTtsStrategy({ provider, toEndpoint, dlog } = {}) {
    const normalized = (provider || '').trim().toLowerCase();

    if (normalized === 'none') {
        return createNoopTtsStrategy();
    }

    const attempts = [];
    if (normalized) {
        attempts.push(normalized);
    }
    if (!attempts.includes('browser')) {
        attempts.push('browser');
    }
    if (!attempts.includes('openai')) {
        attempts.push('openai');
    }

    for (const key of attempts) {
        const factory = KNOWN_PROVIDERS.get(key);
        if (!factory) {
            continue;
        }
        const strategy = factory({ toEndpoint, dlog });
        if (strategy && strategy.isSupported !== false) {
            return strategy;
        }
    }

    return createNoopTtsStrategy();
}

export function listAvailableTtsProviders() {
    return Array.from(KNOWN_PROVIDERS.keys());
}
