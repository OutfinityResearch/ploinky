export function createNoopTtsStrategy() {
    return {
        id: 'none',
        label: 'Disabled',
        isSupported: false,
        getDefaultVoice() {
            return null;
        },
        async getVoiceOptions() {
            return [];
        },
        async requestSpeech() {
            throw new Error('Text-to-speech is not available.');
        },
        cancel() {}
    };
}
