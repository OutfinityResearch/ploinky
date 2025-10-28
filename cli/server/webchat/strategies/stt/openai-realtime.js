// OpenAI Realtime API speech-to-text strategy
// Streams audio in real-time via WebSocket for instant transcription

const STT_ENABLED_KEY = 'vc_realtime_stt_enabled';
const STT_LANG_KEY = 'vc_realtime_stt_lang';

function normalizeWhitespace(str) {
    return str.replace(/\s+/g, ' ').trim();
}

export function initRealtimeSpeechToText(elements = {}, options = {}) {
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

    // Check if required APIs are available
    const isSupported = typeof MediaRecorder !== 'undefined' &&
        typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
        typeof WebSocket !== 'undefined';

    let ws = null;
    let mediaRecorder = null;
    let audioContext = null;
    let audioWorkletNode = null;
    let mediaStream = null;
    let isRecording = false;
    // Default to enabled on first use
    let isEnabled = localStorage.getItem(STT_ENABLED_KEY) !== 'false';
    let sttLanguage = localStorage.getItem(STT_LANG_KEY) || 'en';
    let currentTranscript = '';
    let transcriptBuffer = '';
    let reconnectAttempts = 0;
    let sessionId = null;
    const MAX_RECONNECT_ATTEMPTS = 3;

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
        currentTranscript = '';
        transcriptBuffer = '';
    }

    if (composer) {
        composer.setPurgeHandler(({ resetVoice }) => {
            if (resetVoice || isRecording) {
                resetTranscriptState();
            }
        });
    }

    function appendVoiceText(text, isPartial = false) {
        if (!text || !composer) {
            return;
        }

        if (isPartial) {
            // For partial transcripts, update in place
            composer.setVoiceText(text);
        } else {
            // For final transcripts, append
            composer.appendVoiceText(text);
        }
    }

    async function connectWebSocket() {
        return new Promise(async (resolve, reject) => {
            try {
                // Request ephemeral token from server
                dlog('[stt-realtime] Requesting session token');
                const tokenUrl = toEndpoint ? toEndpoint('/realtime-token') : '/webchat/realtime-token';

                const tokenResponse = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({})
                });

                if (!tokenResponse.ok) {
                    const errorData = await tokenResponse.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Failed to get session token');
                }

                const tokenData = await tokenResponse.json();
                const ephemeralKey = tokenData.client_secret.value;

                dlog('[stt-realtime] Token received, connecting to OpenAI');

                // Connect directly to OpenAI with ephemeral token
                const model = 'gpt-4o-realtime-preview-2024-10-01';
                const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

                ws = new WebSocket(wsUrl, ['realtime', `openai-insecure-api-key.${ephemeralKey}`]);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => {
                    dlog('[stt-realtime] Connected to OpenAI');
                    reconnectAttempts = 0;
                    resolve();
                };

                ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        dlog('[stt-realtime] Received:', message.type);

                        // After session.created, configure the session
                        if (message.type === 'session.created') {
                            sessionId = message.session?.id || null;
                            console.debug('[stt-realtime] Session payload', message.session);
                            dlog('[stt-realtime] Configuring session');
                            const updatePayload = {
                                type: 'session.update',
                                session: {
                                    type: 'realtime',
                                    instructions: 'You are a transcription assistant. Only transcribe what the user says.',
                                    input_audio_transcription: {
                                        model: 'gpt-4o-mini-transcribe'
                                    },
                                    turn_detection: {
                                        type: 'server_vad',
                                        threshold: 0.5,
                                        prefix_padding_ms: 300,
                                        silence_duration_ms: 500
                                    }
                                }
                            };

                            if (sessionId) {
                                updatePayload.session.id = sessionId;
                            }

                            ws.send(JSON.stringify(updatePayload));
                            return;
                        }

                        if (message.type === 'session.updated') {
                            dlog('[stt-realtime] Session configured successfully');
                            updateVoiceStatus('Listening... (speak now)');
                            return;
                        }

                        // Handle OpenAI Realtime API events
                        if (message.type === 'conversation.item.input_audio_transcription.completed') {
                            const text = normalizeWhitespace(message.transcript || '');
                            if (text) {
                                transcriptBuffer += (transcriptBuffer ? ' ' : '') + text;
                                currentTranscript = transcriptBuffer;
                                appendVoiceText(text, false);

                                // Check for send trigger
                                if (sendTriggerRe && sendTriggerRe.test(text)) {
                                    dlog('[stt-realtime] Send trigger detected');
                                    if (composer && typeof composer.sendMessage === 'function') {
                                        composer.sendMessage();
                                    }
                                    resetTranscriptState();
                                }
                            }
                        } else if (message.type === 'conversation.item.input_audio_transcription.failed') {
                            dlog('[stt-realtime] Transcription failed');
                            updateVoiceStatus('Transcription failed');
                        } else if (message.type === 'input_audio_buffer.speech_started') {
                            dlog('[stt-realtime] Speech detected');
                            updateVoiceStatus('Listening...');
                        } else if (message.type === 'input_audio_buffer.speech_stopped') {
                            dlog('[stt-realtime] Speech ended');
                            updateVoiceStatus('Processing...');
                            // Commit the audio buffer for transcription
                            ws.send(JSON.stringify({
                                type: 'input_audio_buffer.commit'
                            }));
                        } else if (message.type === 'error') {
                            dlog('[stt-realtime] Error:', message.error);
                            updateVoiceStatus(`Error: ${message.error?.message || 'Unknown error'}`);
                            stopRecording();
                        }
                    } catch (error) {
                        dlog('[stt-realtime] Message parse error:', error);
                    }
                };

                ws.onerror = (error) => {
                    dlog('[stt-realtime] WebSocket error:', error);
                    updateVoiceStatus('Connection error');
                    reject(error);
                };

                ws.onclose = () => {
                    dlog('[stt-realtime] WebSocket closed');
                    if (isRecording) {
                        updateVoiceStatus('Disconnected');
                        stopRecording();
                    }
                    ws = null;
                };

            } catch (error) {
                dlog('[stt-realtime] Connection error:', error);
                updateVoiceStatus('Failed to connect');
                reject(error);
            }
        });
    }

    async function startRecording() {
        if (isRecording || !isSupported) {
            return;
        }

        try {
            dlog('[stt-realtime] Starting recording');
            updateVoiceStatus('Connecting...');

            // Connect WebSocket
            await connectWebSocket();

            // Get microphone access
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Create AudioContext for processing
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            const source = audioContext.createMediaStreamSource(mediaStream);

            // Create ScriptProcessor for audio chunks
            const bufferSize = 4096;
            const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

            processor.onaudioprocess = (e) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);

                    // Convert Float32Array to Int16Array (PCM16)
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        const s = Math.max(-1, Math.min(1, inputData[i]));
                        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }

                    // Send as base64 using OpenAI's API format
                    const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(pcm16.buffer)));
                    ws.send(JSON.stringify({
                        type: 'input_audio_buffer.append',
                        audio: base64
                    }));
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
            audioWorkletNode = processor;

            isRecording = true;
            setMicVisual(true);
            updateVoiceStatus('Listening... (speak naturally)');
            dlog('[stt-realtime] Recording started');

        } catch (error) {
            dlog('[stt-realtime] Error starting recording:', error);

            if (error.name === 'NotAllowedError') {
                updateVoiceStatus('Mic access denied');
            } else {
                updateVoiceStatus('Failed to start');
            }

            stopRecording();
        }
    }

    function stopRecording() {
        if (!isRecording) {
            return;
        }

        dlog('[stt-realtime] Stopping recording');

        // Close WebSocket
        if (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stop' }));
            }
            ws.close();
            ws = null;
        }
        sessionId = null;

        // Stop audio processing
        if (audioWorkletNode) {
            audioWorkletNode.disconnect();
            audioWorkletNode = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        isRecording = false;
        setMicVisual(false);
        updateVoiceStatus('Ready (Real-time)');

        // Finalize any pending transcript
        if (transcriptBuffer) {
            currentTranscript = transcriptBuffer;
        }
    }

    function toggleRecording() {
        // Auto-enable on first click if disabled
        if (!isEnabled) {
            dlog('[stt-realtime] Auto-enabling STT');
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
        sttBtn.title = 'Click to start/stop real-time transcription (OpenAI Realtime API)';
    } else if (sttBtn) {
        sttBtn.disabled = true;
        sttBtn.title = 'Real-time speech-to-text not supported in this browser';
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

            dlog('[stt-realtime] Enabled:', isEnabled);
        });
    } else if (sttEnable) {
        sttEnable.disabled = true;
        sttEnable.checked = false;
    }

    // Set up language selector
    if (sttLang && isSupported) {
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
            dlog('[stt-realtime] Language changed to:', sttLanguage);

            // If currently recording, restart with new language
            if (isRecording) {
                stopRecording();
                setTimeout(() => startRecording(), 500);
            }
        });
    } else if (sttLang) {
        sttLang.disabled = true;
    }

    // Initialize status
    if (isSupported) {
        updateVoiceStatus('Ready (Real-time)');
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
