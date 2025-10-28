// OpenAI Whisper speech-to-text strategy
// Records audio in the browser and sends to server for transcription

const STT_ENABLED_KEY = 'vc_openai_stt_enabled';
const STT_LANG_KEY = 'vc_openai_stt_lang';

function normalizeWhitespace(str) {
    return str.replace(/\s+/g, ' ').trim();
}

export function initOpenAISpeechToText(elements = {}, options = {}) {
    const {
        sttBtn,
        sttStatus,
        sttLang,
        sttEnable,
    } = elements;

    const {
        composer,
        purgeTriggerRe,
        sendTriggerRe,
        toEndpoint,
        dlog = () => { }
    } = options;

    // Check if MediaRecorder API is available
    const isSupported = typeof MediaRecorder !== 'undefined' && typeof navigator?.mediaDevices?.getUserMedia === 'function';

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let mediaStream = null;
    let transcriptBuffer = '';
    // Default to enabled on first use
    let isEnabled = localStorage.getItem(STT_ENABLED_KEY) !== 'false';
    let sttLanguage = localStorage.getItem(STT_LANG_KEY) || 'en';

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
        transcriptBuffer = '';
    }

    if (composer) {
        composer.setPurgeHandler(({ resetVoice }) => {
            if (resetVoice || isRecording) {
                resetTranscriptState();
            }
        });
    }

    function appendVoiceText(text) {
        if (!text || !composer) {
            return;
        }
        composer.appendVoiceText(text);
    }

    async function sendAudioForTranscription(audioBlob) {
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('language', sttLanguage);

            const url = toEndpoint ? toEndpoint('/stt') : '/webchat/stt';

            updateVoiceStatus('Transcribing...');
            dlog('[stt] Sending audio for transcription');

            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Transcription failed: ${response.status}`);
            }

            const data = await response.json();

            if (data.text) {
                const normalizedText = normalizeWhitespace(data.text);
                dlog('[stt] Transcription received:', normalizedText);

                transcriptBuffer = normalizedText;
                appendVoiceText(normalizedText);

                // Check for send trigger
                if (sendTriggerRe && sendTriggerRe.test(normalizedText)) {
                    dlog('[stt] Send trigger detected');
                    if (composer && typeof composer.sendMessage === 'function') {
                        composer.sendMessage();
                    }
                    resetTranscriptState();
                }

                updateVoiceStatus('Ready');
            }
        } catch (error) {
            dlog('[stt] Transcription error:', error);
            updateVoiceStatus(`Error: ${error.message}`);

            // Show user-friendly error
            if (composer && typeof composer.showError === 'function') {
                composer.showError('Transcription failed. Please try again.');
            }
        }
    }

    async function startRecording() {
        if (isRecording || !isSupported) {
            return;
        }

        try {
            dlog('[stt] Requesting microphone access');
            updateVoiceStatus('Requesting mic...');

            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Try to use webm/opus if available, fallback to webm
            let mimeType = 'audio/webm;codecs=opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'audio/webm';
            }

            audioChunks = [];
            mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                dlog('[stt] Recording stopped, processing audio');

                if (audioChunks.length > 0) {
                    const audioBlob = new Blob(audioChunks, { type: mimeType });
                    await sendAudioForTranscription(audioBlob);
                }

                // Clean up
                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }

                audioChunks = [];
                isRecording = false;
                setMicVisual(false);
            };

            mediaRecorder.onerror = (event) => {
                dlog('[stt] MediaRecorder error:', event.error);
                updateVoiceStatus('Recording error');
                stopRecording();
            };

            mediaRecorder.start();
            isRecording = true;
            setMicVisual(true);
            updateVoiceStatus('Recording...');
            dlog('[stt] Recording started');

        } catch (error) {
            dlog('[stt] Error starting recording:', error);
            updateVoiceStatus('Mic access denied');

            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
                mediaStream = null;
            }

            isRecording = false;
            setMicVisual(false);
        }
    }

    function stopRecording() {
        if (!isRecording || !mediaRecorder) {
            return;
        }

        dlog('[stt] Stopping recording');

        if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }

    function toggleRecording() {
        // Auto-enable on first click if disabled
        if (!isEnabled) {
            dlog('[stt] Auto-enabling STT');
            isEnabled = true;
            localStorage.setItem(STT_ENABLED_KEY, 'true');
            if (sttEnable) {
                sttEnable.checked = true;
            }
            if (sttBtn) {
                sttBtn.disabled = false;
            }
            updateVoiceStatus('Enabled');
            return;
        }

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    // Set up microphone button
    if (sttBtn && isSupported) {
        sttBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleRecording();
        });
        sttBtn.disabled = false;
        sttBtn.title = 'Click to start/stop recording (OpenAI Whisper)';
    } else if (sttBtn) {
        sttBtn.disabled = true;
        sttBtn.title = 'Speech-to-text not supported in this browser';
    }

    // Set up enable/disable toggle
    if (sttEnable && isSupported) {
        sttEnable.checked = isEnabled;
        sttEnable.disabled = false;

        sttEnable.addEventListener('change', () => {
            isEnabled = sttEnable.checked;
            localStorage.setItem(STT_ENABLED_KEY, isEnabled ? 'true' : 'false');

            if (!isEnabled && isRecording) {
                stopRecording();
            }

            if (sttBtn) {
                sttBtn.disabled = !isEnabled;
            }

            dlog('[stt] Enabled:', isEnabled);
        });
    } else if (sttEnable) {
        sttEnable.disabled = true;
        sttEnable.checked = false;
    }

    // Set up language selector
    if (sttLang && isSupported) {
        // Populate language options
        const languages = [
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'it', name: 'Italian' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'nl', name: 'Dutch' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh', name: 'Chinese' },
            { code: 'ru', name: 'Russian' },
            { code: 'ar', name: 'Arabic' },
            { code: 'hi', name: 'Hindi' }
        ];

        sttLang.innerHTML = languages.map(lang =>
            `<option value="${lang.code}" ${lang.code === sttLanguage ? 'selected' : ''}>${lang.name}</option>`
        ).join('');

        sttLang.disabled = false;

        sttLang.addEventListener('change', () => {
            sttLanguage = sttLang.value;
            localStorage.setItem(STT_LANG_KEY, sttLanguage);
            dlog('[stt] Language changed to:', sttLanguage);
        });
    } else if (sttLang) {
        sttLang.disabled = true;
    }

    // Initialize status
    if (isSupported) {
        updateVoiceStatus('Ready (OpenAI Whisper)');
    } else {
        updateVoiceStatus('Not supported');
    }

    return {
        isSupported,
        resetTranscriptState,
        stop: () => {
            if (isRecording) {
                stopRecording();
            }
        }
    };
}

