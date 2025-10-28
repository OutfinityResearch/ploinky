function normalizeWhitespace(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
}

export function initBrowserSpeechToText(elements = {}, options = {}) {
    const {
        sttBtn,
        sttStatus,
        sttLang,
        sttEnable,
        settingsBtn,
        settingsPanel
    } = elements;

    const {
        composer,
        purgeTriggerRe,
        sendTriggerRe,
        dlog = () => {}
    } = options;

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const sttSupported = typeof SpeechRecognitionClass === 'function';
    const sttLangKey = 'vc_stt_lang';
    const sttEnabledKey = 'vc_stt_enabled';

    let sttRecognition = null;
    let sttListening = false;
    let sttActive = false;
    let sttLangCode = localStorage.getItem(sttLangKey) || 'en-GB';
    let finalSegments = [];
    let interimTranscript = '';
    let sttAppliedTranscript = '';

    function updateVoiceStatus(text) {
        if (sttStatus) {
            sttStatus.textContent = text;
        }
    }

    function setMicVisual(active) {
        if (!sttBtn) {
            return;
        }
        sttBtn.classList.toggle('active', active);
        sttBtn.classList.toggle('muted', !active);
        sttBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function resetTranscriptState() {
        finalSegments = [];
        interimTranscript = '';
        sttAppliedTranscript = '';
    }

    if (composer) {
        composer.setPurgeHandler(({ resetVoice }) => {
            if (resetVoice || sttActive) {
                resetTranscriptState();
            }
        });
    }

    function appendVoiceText(addition) {
        if (!addition || !composer) {
            return;
        }
        composer.appendVoiceText(addition);
    }

    function updateComposerFromVoice() {
        const combined = normalizeWhitespace(finalSegments.join(' '));
        if (!combined || combined === sttAppliedTranscript) {
            return;
        }
        const addition = combined.slice(sttAppliedTranscript.length);
        if (!addition.trim()) {
            sttAppliedTranscript = combined;
            return;
        }
        appendVoiceText(addition);
        sttAppliedTranscript = combined;
    }

    function handleVoiceSend(rawJoined) {
        const cleaned = normalizeWhitespace((rawJoined || '').replace(/\bsend\b/gi, ' '));
        if (!composer) {
            resetTranscriptState();
            return;
        }
        composer.setValue(cleaned);
        if (cleaned) {
            composer.submit();
        } else {
            composer.clear();
        }
        resetTranscriptState();
    }

    function handleVoicePurge() {
        if (!composer) {
            return;
        }
        composer.purge({ resetVoice: true });
    }

    function stopRecognition() {
        if (!sttRecognition) {
            return;
        }
        try {
            sttRecognition.onresult = null;
            sttRecognition.onerror = null;
            sttRecognition.onend = null;
            sttRecognition.stop();
        } catch (_) {
            // Ignore stop failures
        }
        sttRecognition = null;
        sttListening = false;
    }

    function startRecognition() {
        if (!sttSupported) {
            updateVoiceStatus('Unsupported');
            setMicVisual(false);
            return;
        }
        if (!sttEnable?.checked) {
            updateVoiceStatus('Muted');
            setMicVisual(false);
            return;
        }
        if (!sttActive || sttListening) {
            return;
        }

        resetTranscriptState();

        try {
            sttRecognition = new SpeechRecognitionClass();
            sttRecognition.lang = sttLang?.value || sttLangCode || 'en-GB';
            sttRecognition.continuous = true;
            sttRecognition.interimResults = true;

            sttRecognition.onresult = (event) => {
                interimTranscript = '';
                let triggered = false;
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i];
                    const transcript = (result[0]?.transcript || '').trim();
                    if (!transcript) {
                        continue;
                    }
                    if (result.isFinal) {
                        finalSegments.push(transcript);
                        const joined = finalSegments.join(' ');
                        if (purgeTriggerRe?.test?.(joined)) {
                            triggered = true;
                            handleVoicePurge();
                            break;
                        }
                        if (sendTriggerRe?.test?.(joined)) {
                            triggered = true;
                            handleVoiceSend(joined);
                            break;
                        }
                    } else {
                        interimTranscript = interimTranscript ? `${interimTranscript} ${transcript}` : transcript;
                    }
                }
                if (!triggered) {
                    updateComposerFromVoice();
                }
            };

            sttRecognition.onerror = (event) => {
                dlog('stt error', event);
                const err = event?.error || event?.message || 'unknown';
                const fatal = err === 'not-allowed' || err === 'service-not-allowed';
                sttListening = false;
                if (fatal) {
                    sttActive = false;
                    updateVoiceStatus('Permission denied');
                    setMicVisual(false);
                    stopRecognition();
                } else {
                    updateVoiceStatus(`Error: ${err}`);
                }
            };

            sttRecognition.onend = () => {
                sttListening = false;
                if (sttActive && sttEnable?.checked) {
                    setTimeout(() => {
                        if (!sttListening && sttActive && sttEnable?.checked) {
                            startRecognition();
                        }
                    }, 200);
                } else {
                    updateVoiceStatus(sttEnable?.checked ? 'Paused' : 'Muted');
                }
                setMicVisual(sttActive && sttEnable?.checked);
            };

            sttRecognition.start();
            sttListening = true;
            updateVoiceStatus('Listening…');
            setMicVisual(true);
        } catch (error) {
            dlog('stt start failed', error);
            updateVoiceStatus('Mic blocked');
            setMicVisual(false);
        }
    }

    function applyEnableState(checked) {
        if (sttBtn) {
            sttBtn.setAttribute('aria-disabled', checked ? 'false' : 'true');
        }
        if (!checked) {
            sttActive = false;
            setMicVisual(false);
            stopRecognition();
            updateVoiceStatus('Muted');
            resetTranscriptState();
        } else {
            sttActive = true;
            setMicVisual(true);
            startRecognition();
        }
    }

    if (settingsBtn && settingsPanel) {
        let settingsOpen = false;
        const toggleSettings = () => {
            settingsOpen = !settingsOpen;
            settingsPanel.classList.toggle('show', settingsOpen);
            settingsBtn.classList.toggle('active', settingsOpen);
        };
        settingsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleSettings();
        });
        document.addEventListener('click', (event) => {
            if (!settingsOpen) {
                return;
            }
            if (!settingsPanel.contains(event.target) && !settingsBtn.contains(event.target)) {
                settingsOpen = false;
                settingsPanel.classList.remove('show');
                settingsBtn.classList.remove('active');
            }
        });
        document.addEventListener('keydown', (event) => {
            if (!settingsOpen) {
                return;
            }
            if (event.key === 'Escape') {
                settingsOpen = false;
                settingsPanel.classList.remove('show');
                settingsBtn.classList.remove('active');
            }
        });
    }

    try {
        function fillLangs() {
            const voices = window.speechSynthesis?.getVoices?.() || [];
            const list = voices.map((voice) => voice.lang).filter(Boolean);
            const common = ['en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR', 'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'];
            const langs = Array.from(new Set([...list, ...common])).sort();
            if (sttLang) {
                sttLang.innerHTML = '';
                langs.forEach((code) => {
                    const option = document.createElement('option');
                    option.value = code;
                    option.textContent = code;
                    if (code === sttLangCode) {
                        option.selected = true;
                    }
                    sttLang.appendChild(option);
                });
            }
        }

        fillLangs();
        window.speechSynthesis?.addEventListener?.('voiceschanged', fillLangs);
    } catch (_) {
        // Ignore voice population issues
    }

    if (sttLang) {
        sttLang.addEventListener('change', (event) => {
            sttLangCode = event.target.value || 'en-GB';
            try {
                localStorage.setItem(sttLangKey, sttLangCode);
            } catch (_) {
                // Ignore storage failures
            }
            if (sttListening) {
                stopRecognition();
                setTimeout(startRecognition, 150);
            }
        });
    }

    if (sttEnable) {
        sttEnable.checked = false;
        try {
            localStorage.setItem(sttEnabledKey, 'false');
        } catch (_) {
            // Ignore storage failures
        }
        sttEnable.addEventListener('change', () => {
            try {
                localStorage.setItem(sttEnabledKey, sttEnable.checked ? 'true' : 'false');
            } catch (_) {
                // Ignore storage failures
            }
            applyEnableState(sttEnable.checked);
        });
    }

    if (sttBtn) {
        sttBtn.addEventListener('click', () => {
            if (!sttSupported) {
                updateVoiceStatus('Unsupported');
                return;
            }
            if (sttEnable && !sttEnable.checked) {
                sttEnable.checked = true;
                try {
                    localStorage.setItem(sttEnabledKey, 'true');
                } catch (_) {
                    // Ignore storage failures
                }
                applyEnableState(true);
                return;
            }
            sttActive = !sttActive;
            setMicVisual(sttActive);
            if (sttActive) {
                updateVoiceStatus('Listening…');
                startRecognition();
            } else {
                stopRecognition();
                updateVoiceStatus('Muted');
                resetTranscriptState();
            }
        });
    }

    if (!sttSupported) {
        updateVoiceStatus('Unsupported');
        if (sttBtn) {
            sttBtn.disabled = true;
            setMicVisual(false);
        }
        return { isSupported: false, resetTranscriptState };
    }

    if (sttEnable) {
        applyEnableState(sttEnable.checked);
    } else {
        sttActive = true;
        setMicVisual(true);
        startRecognition();
    }

    return {
        isSupported: true,
        resetTranscriptState,
        stop: () => {
            sttActive = false;
            stopRecognition();
            updateVoiceStatus('Muted');
        }
    };
}
