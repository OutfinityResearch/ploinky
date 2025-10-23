export function createNoopTtsServerStrategy() {
    return {
        id: 'none',
        label: 'Disabled',
        isAvailable: false,
        getVoiceOptions() {
            return [];
        },
        normalizeVoice(voice) {
            return null;
        },
        clampSpeed(value) {
            return 1;
        },
        trimText(text) {
            return '';
        },
        async synthesize() {
            throw new Error('Text-to-speech unavailable');
        }
    };
}
