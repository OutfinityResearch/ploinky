import { createOpenAITtsServerStrategy } from './openai.js';
import { createNoopTtsServerStrategy } from './noop.js';

const PROVIDERS = new Map([
    ['browser', () => createNoopTtsServerStrategy()],
    ['openai', createOpenAITtsServerStrategy],
    ['none', () => createNoopTtsServerStrategy()]
]);

export function createServerTtsStrategy({ provider } = {}) {
    const normalized = (provider || '').trim().toLowerCase();
    const factory = PROVIDERS.get(normalized) || PROVIDERS.get('openai');
    const strategy = factory ? factory({}) : null;
    if (strategy && strategy.isAvailable !== false) {
        return strategy;
    }
    return createNoopTtsServerStrategy();
}

export function getServerTtsVoiceOptions(strategy) {
    if (!strategy || typeof strategy.getVoiceOptions !== 'function') {
        return [];
    }
    try {
        return strategy.getVoiceOptions();
    } catch (_) {
        return [];
    }
}
