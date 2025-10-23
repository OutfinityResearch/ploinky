import { createSttInitializer } from './strategies/stt/index.js';

export function initSpeechToText(elements = {}, options = {}) {
    const initializer = createSttInitializer({ provider: options.provider });
    try {
        return initializer(elements, options);
    } catch (error) {
        console.error('[webchat] stt initialization error:', error);
        return {
            isSupported: false,
            resetTranscriptState: () => {},
            stop: () => {}
        };
    }
}
