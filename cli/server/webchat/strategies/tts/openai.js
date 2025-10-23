import { DEFAULT_VOICE, VOICE_OPTIONS } from './voices.js';

export function createOpenAITtsStrategy({ toEndpoint, dlog = () => {} } = {}) {
    if (typeof toEndpoint !== 'function') {
        return null;
    }

    async function requestSpeech({ text, voice, rate }) {
        const payload = {
            text,
            voice: voice || DEFAULT_VOICE,
            speed: rate
        };
        const response = await fetch(toEndpoint('tts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            let details = '';
            try {
                const data = await response.json();
                details = data?.error || '';
            } catch (_) {
                details = await response.text();
            }
            const error = new Error(details || 'Text-to-speech request failed.');
            error.status = response.status;
            throw error;
        }
        const data = await response.json();
        if (!data?.audio) {
            throw new Error('Text-to-speech response missing audio payload.');
        }
        try {
            const bytes = base64ToUint8Array(data.audio);
            const mime = data.contentType || 'audio/mpeg';
            const blob = new Blob([bytes], { type: mime });
            const url = URL.createObjectURL(blob);
            return {
                url,
                mime,
                cleanup() {
                    try {
                        URL.revokeObjectURL(url);
                    } catch (_) {
                        /* ignore */
                    }
                }
            };
        } catch (error) {
            dlog('tts decode error', error);
            throw new Error('Failed to decode audio response.');
        }
    }

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const length = binary.length;
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    return {
        id: 'openai',
        label: 'OpenAI',
        isSupported: true,
        getDefaultVoice() {
            return DEFAULT_VOICE;
        },
        async getVoiceOptions() {
            return VOICE_OPTIONS;
        },
        async requestSpeech(options) {
            return requestSpeech(options);
        },
        cancel() {}
    };
}
