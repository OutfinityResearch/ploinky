const VOICE_CACHE_TTL_MS = 10_000;
const GOOGLE_EN_US_NAME = 'google us english';

function hasSpeechSynthesisSupport() {
    return typeof window !== 'undefined' &&
        typeof window.speechSynthesis !== 'undefined' &&
        typeof window.SpeechSynthesisUtterance === 'function';
}

function getSynth() {
    return hasSpeechSynthesisSupport() ? window.speechSynthesis : null;
}

function waitForVoicesOnce(synth) {
    return new Promise((resolve) => {
        let settled = false;

        const handle = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(synth.getVoices());
        };

        const failSafe = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(synth.getVoices());
        }, 750);

        function cleanup() {
            if (failSafe) {
                clearTimeout(failSafe);
            }
            if (typeof synth.removeEventListener === 'function') {
                synth.removeEventListener('voiceschanged', handle);
            } else {
                synth.onvoiceschanged = null;
            }
        }

        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', handle, { once: true });
        } else {
            synth.onvoiceschanged = handle;
        }

        // Trigger voice load attempt in some browsers.
        synth.getVoices();
    });
}

function normalizeVoiceLabel(voice) {
    const name = voice.name || voice.voiceURI || 'Voice';
    const locale = voice.lang ? ` (${voice.lang})` : '';
    const label = `${name}${locale}`;
    return label;
}

function selectPreferredVoice(voices) {
    if (!Array.isArray(voices) || !voices.length) {
        return null;
    }

    const toToken = (voice) => (voice?.name || voice?.voiceURI || '').trim();
    const googleExact = voices.find((voice) => (voice?.name || '').trim().toLowerCase() === GOOGLE_EN_US_NAME);
    if (googleExact) {
        return toToken(googleExact);
    }

    const googleEnVariant = voices.find((voice) => {
        const name = (voice?.name || '').toLowerCase();
        const lang = (voice?.lang || '').toLowerCase();
        return name.includes('google') && lang.startsWith('en-us');
    });
    if (googleEnVariant) {
        return toToken(googleEnVariant);
    }

    const enUsVoice = voices.find((voice) => (voice?.lang || '').toLowerCase().startsWith('en-us'));
    if (enUsVoice) {
        return toToken(enUsVoice);
    }

    const defaultVoice = voices.find((voice) => voice?.default);
    if (defaultVoice) {
        return toToken(defaultVoice);
    }

    return toToken(voices[0]) || null;
}

export function createBrowserTtsStrategy({ dlog = () => {} } = {}) {
    const synth = getSynth();
    if (!synth) {
        return {
            id: 'browser',
            label: 'Browser',
            isSupported: false,
            getDefaultVoice() {
                return null;
            },
            async getVoiceOptions() {
                return [];
            },
            async requestSpeech() {
                throw new Error('Speech synthesis not supported in this environment.');
            },
            cancel() {}
        };
    }

    let lastVoiceCache = { at: 0, voices: [] };

    async function loadVoices() {
        const now = Date.now();
        if ((now - lastVoiceCache.at) < VOICE_CACHE_TTL_MS && lastVoiceCache.voices.length) {
            return lastVoiceCache.voices;
        }
        let voices = synth.getVoices();
        if (!voices || !voices.length) {
            voices = await waitForVoicesOnce(synth);
        }
        if (!Array.isArray(voices)) {
            voices = [];
        }
        lastVoiceCache = { at: Date.now(), voices };
        return voices;
    }

    function resolveVoiceChoice(voiceName, voices) {
        if (!voiceName) {
            return null;
        }
        const trimmed = voiceName.trim().toLowerCase();
        if (!trimmed) {
            return null;
        }
        return voices.find((voice) => {
            const name = (voice.name || voice.voiceURI || '').toLowerCase();
            return name === trimmed;
        }) || null;
    }

    function subscribeToVoiceChanges(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        const handler = () => {
            try {
                lastVoiceCache = { at: 0, voices: [] };
                listener();
            } catch (error) {
                dlog('tts voice change listener failed', error);
            }
        };

        if (typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', handler);
            return () => synth.removeEventListener?.('voiceschanged', handler);
        }

        const prevHandler = synth.onvoiceschanged;
        synth.onvoiceschanged = (...args) => {
            try {
                handler(...args);
            } finally {
                if (typeof prevHandler === 'function') {
                    prevHandler(...args);
                }
            }
        };
        return () => {
            if (synth.onvoiceschanged === handler) {
                synth.onvoiceschanged = null;
            }
        };
    }

    async function getVoiceOptions() {
        const voices = await loadVoices();
        return voices.map((voice) => ({
            value: voice.name || voice.voiceURI,
            label: normalizeVoiceLabel(voice)
        }));
    }

    async function requestSpeech({ text, voice, rate }) {
        if (!text) {
            throw new Error('Missing text for speech synthesis.');
        }
        const utterance = new window.SpeechSynthesisUtterance(text);
        const voices = await loadVoices();
        const chosen = resolveVoiceChoice(voice, voices);
        if (chosen) {
            utterance.voice = chosen;
        }
        if (Number.isFinite(rate) && rate > 0) {
            utterance.rate = Math.min(2, Math.max(0.5, rate));
        }

        return {
            async play() {
                return new Promise((resolve, reject) => {
                    let settled = false;

                    const handleEnd = () => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        cleanup();
                        resolve();
                    };

                    const handleError = (event) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        cleanup();
                        const err = event?.error || event?.message || 'Speech synthesis failed.';
                        reject(new Error(err));
                    };

                    function cleanup() {
                        utterance.onend = null;
                        utterance.onerror = null;
                    }

                    utterance.onend = handleEnd;
                    utterance.onerror = handleError;

                    try {
                        synth.cancel();
                        synth.speak(utterance);
                    } catch (error) {
                        cleanup();
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            },
            stop() {
                try {
                    synth.cancel();
                } catch (_) {
                    // Ignore cancellation errors
                }
            },
            cleanup() {}
        };
    }

    function getDefaultVoiceToken() {
        const cachedVoices = lastVoiceCache.voices && lastVoiceCache.voices.length
            ? lastVoiceCache.voices
            : synth.getVoices();
        const token = selectPreferredVoice(cachedVoices || []);
        return token || null;
    }

    return {
        id: 'browser',
        label: 'Browser',
        isSupported: true,
        async getVoiceOptions() {
            return getVoiceOptions();
        },
        getDefaultVoice() {
            return getDefaultVoiceToken();
        },
        onVoicesChanged(listener) {
            return subscribeToVoiceChanges(listener);
        },
        async requestSpeech(options) {
            return requestSpeech(options);
        },
        cancel() {
            try {
                synth.cancel();
            } catch (_) {
                // Ignore cancellation issues
            }
        }
    };
}
