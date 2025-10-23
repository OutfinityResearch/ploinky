import { initBrowserSpeechToText } from './browser.js';
import { initNoopSpeechToText } from './noop.js';

const PROVIDERS = new Map([
    ['browser', initBrowserSpeechToText],
    ['none', initNoopSpeechToText]
]);

export function createSttInitializer({ provider } = {}) {
    const normalized = (provider || '').trim().toLowerCase();
    if (normalized && PROVIDERS.has(normalized)) {
        return PROVIDERS.get(normalized);
    }
    const initializer = PROVIDERS.get('browser') || initNoopSpeechToText;
    return initializer;
}

export function listAvailableSttProviders() {
    return Array.from(PROVIDERS.keys());
}
