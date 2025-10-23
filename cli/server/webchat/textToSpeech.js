import { createTtsStrategy } from './strategies/tts/index.js';

const TTS_ENABLED_KEY = 'vc_tts_enabled';
const TTS_VOICE_KEY = 'vc_tts_voice';
const TTS_RATE_KEY = 'vc_tts_rate';

const MAX_QUEUE_LENGTH = 8;
const MAX_TEXT_LENGTH = 4000;
const DEFAULT_MODEL_SPEED = 1;

function clampRate(value) {
    if (!Number.isFinite(value)) {
        return DEFAULT_MODEL_SPEED;
    }
    return Math.min(2, Math.max(0.5, value));
}

function safeSetText(el, text) {
    if (!el) return;
    try {
        el.textContent = text;
    } catch (_) {
        // Ignore DOM update failures
    }
}

export function initTextToSpeech(elements = {}, { dlog = () => {}, toEndpoint, provider } = {}) {
    const strategy = createTtsStrategy({ provider, toEndpoint, dlog });

    const noop = {
        handleServerOutput: () => {},
        cancel: () => {}
    };

    const {
        ttsEnable,
        ttsVoice,
        ttsRate,
        ttsRateValue
    } = elements;

    if (!strategy || strategy.isSupported === false) {
        if (ttsEnable) {
            ttsEnable.checked = false;
            ttsEnable.disabled = true;
            ttsEnable.title = 'Text-to-speech not available.';
        }
        if (ttsVoice) {
            ttsVoice.disabled = true;
        }
        if (ttsRate) {
            ttsRate.disabled = true;
        }
        safeSetText(ttsRateValue, 'N/A');
        return noop;
    }

    let voiceOptions = [];

    const state = {
        enabled: false,
        voice: strategy.getDefaultVoice ? strategy.getDefaultVoice() : null,
        rate: DEFAULT_MODEL_SPEED,
        queue: [],
        playing: false,
        currentAudio: null,
        currentCleanup: null,
        lastSpokenText: '',
        disableOnError: false
    };

    function persistEnabled() {
        try {
            localStorage.setItem(TTS_ENABLED_KEY, state.enabled ? 'true' : 'false');
        } catch (_) {
            // Ignore storage issues
        }
    }

    function persistVoice() {
        if (!state.voice) {
            try {
                localStorage.removeItem(TTS_VOICE_KEY);
            } catch (_) {
                // Ignore
            }
            return;
        }
        try {
            localStorage.setItem(TTS_VOICE_KEY, state.voice);
        } catch (_) {
            // Ignore
        }
    }

    function persistRate() {
        try {
            localStorage.setItem(TTS_RATE_KEY, String(state.rate));
        } catch (_) {
            // Ignore storage issues
        }
    }

    function updateRateLabel() {
        safeSetText(ttsRateValue, `${state.rate.toFixed(1)}×`);
    }

    function loadPreferences() {
        try {
            const storedEnabled = localStorage.getItem(TTS_ENABLED_KEY);
            if (storedEnabled === 'true') {
                state.enabled = true;
            }
        } catch (_) {
            state.enabled = false;
        }

        try {
            const storedVoice = localStorage.getItem(TTS_VOICE_KEY);
            if (storedVoice) {
                state.voice = storedVoice;
            }
        } catch (_) {
            // Ignore
        }

        try {
            const storedRate = parseFloat(localStorage.getItem(TTS_RATE_KEY));
            if (Number.isFinite(storedRate)) {
                state.rate = clampRate(storedRate);
            }
        } catch (_) {
            state.rate = DEFAULT_MODEL_SPEED;
        }
    }

    function clearQueue() {
        state.queue.length = 0;
    }

    function stopCurrentAudio() {
        if (state.currentCleanup) {
            try {
                state.currentCleanup();
            } catch (_) {
                // Ignore cleanup failures
            }
            state.currentCleanup = null;
        }
        if (!state.currentAudio) {
            return;
        }
        try {
            state.currentAudio.pause();
        } catch (_) {
            // Ignore pause failures
        }
        state.currentAudio = null;
    }

    function stopAll() {
        clearQueue();
        stopCurrentAudio();
        state.playing = false;
        if (typeof strategy.cancel === 'function') {
            try {
                strategy.cancel();
            } catch (_) {
                // Ignore cancel failures
            }
        }
    }

    function setEnabled(value) {
        state.enabled = Boolean(value);
        if (ttsEnable) {
            ttsEnable.checked = state.enabled;
        }
        persistEnabled();
        if (!state.enabled) {
            stopAll();
            state.lastSpokenText = '';
        }
    }

    async function refreshVoiceOptions() {
        if (!ttsVoice) {
            return;
        }
        try {
            const options = await strategy.getVoiceOptions?.();
            voiceOptions = Array.isArray(options) && options.length ? options : [];
        } catch (error) {
            dlog('tts voice options error', error);
            voiceOptions = [];
        }

        if (!voiceOptions.length) {
            const fallback = strategy.getDefaultVoice ? strategy.getDefaultVoice() : null;
            if (fallback) {
                voiceOptions = [{ value: fallback, label: fallback }];
            }
        }

        ttsVoice.innerHTML = '';
        if (voiceOptions.length) {
            voiceOptions.forEach((option) => {
                const node = document.createElement('option');
                node.value = option.value;
                node.textContent = option.label || option.value;
                ttsVoice.appendChild(node);
            });
        } else {
            const node = document.createElement('option');
            node.value = '';
            node.textContent = 'No voices available';
            ttsVoice.appendChild(node);
        }

        if (!voiceOptions.some((option) => option.value === state.voice)) {
            state.voice = voiceOptions[0]?.value || null;
        }
        if (ttsVoice) {
            ttsVoice.value = state.voice || '';
        }
        persistVoice();
    }

    function applyPreferencesToControls() {
        if (ttsEnable) {
            ttsEnable.checked = state.enabled;
        }
        if (ttsRate) {
            ttsRate.value = String(state.rate);
        }
        updateRateLabel();
    }

    loadPreferences();
    applyPreferencesToControls();
    if (ttsVoice) {
        refreshVoiceOptions().catch((error) => dlog('tts voice refresh failed', error));
    }

    if (ttsEnable) {
        ttsEnable.addEventListener('change', () => {
            setEnabled(ttsEnable.checked);
        });
    }

    if (ttsVoice) {
        ttsVoice.addEventListener('change', () => {
            const selected = ttsVoice.value || null;
            state.voice = selected;
            persistVoice();
        });
    }

    if (ttsRate) {
        const handleRateChange = () => {
            const parsed = parseFloat(ttsRate.value);
            state.rate = clampRate(parsed);
            ttsRate.value = String(state.rate);
            updateRateLabel();
            persistRate();
        };
        ttsRate.addEventListener('input', handleRateChange);
        ttsRate.addEventListener('change', handleRateChange);
    }

    function enqueueSpeech(text) {
        if (!state.enabled || state.disableOnError) {
            return;
        }
        const source = (text || '').trim();
        if (!source) {
            return;
        }
        const trimmed = typeof strategy.trimText === 'function'
            ? strategy.trimText(source)
            : source;
        if (!trimmed) {
            return;
        }
        const delta = trimmed.length > MAX_TEXT_LENGTH
            ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}…`
            : trimmed;
        if (delta === state.lastSpokenText) {
            return;
        }
        state.queue.push(delta);
        if (state.queue.length > MAX_QUEUE_LENGTH) {
            state.queue.splice(0, state.queue.length - MAX_QUEUE_LENGTH);
        }
        processQueue();
    }

    function playAudioUrl(url) {
        return new Promise((resolve) => {
            const audio = new Audio(url);
            audio.preload = 'auto';
            state.currentAudio = audio;

            const finish = () => {
                if (state.currentAudio === audio) {
                    state.currentAudio = null;
                }
                resolve();
            };

            audio.addEventListener('ended', finish);
            audio.addEventListener('error', finish);

            const playPromise = audio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.catch((error) => {
                    dlog('tts playback blocked', error);
                    finish();
                });
            }
        });
    }

    let processing = false;

    async function processQueue() {
        if (processing || !state.enabled || state.disableOnError) {
            return;
        }
        if (!state.queue.length) {
            return;
        }
        processing = true;
        while (state.queue.length && state.enabled && !state.disableOnError) {
            const text = state.queue.shift();
            if (!text) {
                continue;
            }
            let result;
            try {
                result = await strategy.requestSpeech({
                    text,
                    voice: state.voice,
                    rate: state.rate
                });
                if (!result || !result.url) {
                    throw new Error('tts_missing_audio');
                }
                state.lastSpokenText = text;
                state.currentCleanup = typeof result.cleanup === 'function' ? result.cleanup : null;
                await playAudioUrl(result.url);
                if (state.currentCleanup) {
                    state.currentCleanup();
                    state.currentCleanup = null;
                }
            } catch (error) {
                dlog('tts request error', error);
                if (error?.status === 503) {
                    state.disableOnError = true;
                    setEnabled(false);
                    if (ttsEnable) {
                        ttsEnable.disabled = true;
                        ttsEnable.title = 'Text-to-speech unavailable (server not configured).';
                    }
                    safeSetText(ttsRateValue, 'N/A');
                }
                break;
            }
        }
        processing = false;
    }

    function handleServerOutput(text) {
        if (!state.enabled || state.disableOnError) {
            return;
        }
        enqueueSpeech(text);
    }

    function cancel() {
        stopAll();
    }

    return {
        handleServerOutput,
        cancel
    };
}
