import { createOpenAITtsStrategy } from './openai.js';
import { createNoopTtsStrategy } from './noop.js';

const KNOWN_PROVIDERS = new Map([
    ['openai', createOpenAITtsStrategy],
    ['none', () => createNoopTtsStrategy()]
]);

export function createTtsStrategy({ provider, toEndpoint, dlog } = {}) {
    const normalized = (provider || '').trim().toLowerCase() || 'openai';
    const factory = KNOWN_PROVIDERS.get(normalized);
    if (factory) {
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
