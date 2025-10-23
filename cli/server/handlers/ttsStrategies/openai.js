import { DEFAULT_VOICE, VOICE_OPTIONS, normalizeVoiceChoice } from '../../webchat/strategies/tts/voices.js';

const MAX_TEXT_LENGTH = Number(process.env.WEBCHAT_TTS_MAX_CHARS || 4000);
const DEFAULT_MODEL = process.env.WEBCHAT_TTS_MODEL || 'gpt-4o-mini-tts';

function clampSpeed(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 1;
    }
    if (numeric < 0.5) return 0.5;
    if (numeric > 2) return 2;
    return numeric;
}

export function createOpenAITtsServerStrategy({ apiKey, fetchImpl = fetch } = {}) {
    const key = (apiKey || process.env.OPENAI_API_KEY || '').trim();
    if (!key) {
        return null;
    }

    const headers = {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };

    return {
        id: 'openai',
        label: 'OpenAI',
        isAvailable: true,
        getVoiceOptions() {
            return VOICE_OPTIONS;
        },
        normalizeVoice(voice) {
            return normalizeVoiceChoice(voice);
        },
        clampSpeed,
        trimText(text) {
            const source = (text || '').trim();
            if (!source) return '';
            if (source.length > MAX_TEXT_LENGTH) {
                return `${source.slice(0, MAX_TEXT_LENGTH)}…`;
            }
            return source;
        },
        async synthesize({ text, voice = DEFAULT_VOICE, speed = 1 }) {
            const payload = {
                model: DEFAULT_MODEL,
                voice: normalizeVoiceChoice(voice),
                input: text,
                response_format: 'mp3'
            };
            const clampedSpeed = clampSpeed(speed);
            if (clampedSpeed !== 1) {
                payload.speed = clampedSpeed;
            }

            let response;
            try {
                response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
            } catch (error) {
                const err = new Error('openai_tts_network_error');
                err.cause = error;
                throw err;
            }

            if (!response.ok) {
                let details = '';
                try {
                    details = await response.text();
                } catch (_) {
                    details = '';
                }
                const err = new Error('openai_tts_request_failed');
                err.status = response.status;
                err.details = details?.slice?.(0, 500) || details;
                throw err;
            }

            let arrayBuffer;
            try {
                arrayBuffer = await response.arrayBuffer();
            } catch (error) {
                const err = new Error('openai_tts_invalid_audio');
                err.cause = error;
                throw err;
            }

            const base64Audio = Buffer.from(arrayBuffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'audio/mpeg';
            return { audio: base64Audio, contentType };
        }
    };
}
