const PROCESS_PREFIX_RE = /^(?:\s*\.+\s*){3,}/;
const ENVELOPE_FLAG = '__webchatMessage';
const ENVELOPE_VERSION = 1;

function stripCtrlAndAnsi(input) {
    try {
        let out = input || '';
        out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
        out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
        return out;
    } catch (_) {
        return input;
    }
}

function isProcessingChunk(text) {
    if (!text) {
        return false;
    }
    const trimmed = text.replace(/\s/g, '');
    if (trimmed.length === 0 || !/^[.·…]+$/.test(trimmed)) {
        return false;
    }
    const hasWhitespace = /\s/.test(text);
    return hasWhitespace || trimmed.length > 3;
}

function stripProcessingPrefix(text) {
    if (!text) {
        return text;
    }
    const match = PROCESS_PREFIX_RE.exec(text);
    if (!match) {
        return text;
    }
    if (match[0].length >= text.length) {
        return '';
    }
    return text.slice(match[0].length);
}

function serializeEnvelope({ text = '', attachments = [] } = {}) {
    const normalizedAttachments = Array.isArray(attachments)
        ? attachments.map((raw) => {
            if (!raw || typeof raw !== 'object') {
                return null;
            }
            const record = {
                id: typeof raw.id === 'string' ? raw.id : null,
                filename: typeof raw.filename === 'string' ? raw.filename : null,
                mime: typeof raw.mime === 'string' ? raw.mime : null,
                size: Number.isFinite(raw.size) ? raw.size : null,
                downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : null,
                localPath: typeof raw.localPath === 'string' ? raw.localPath : null
            };
            const hasValue = Object.values(record).some((value) => value !== null);
            return hasValue ? record : null;
        }).filter(Boolean)
        : [];

    return JSON.stringify({
        [ENVELOPE_FLAG]: ENVELOPE_VERSION,
        version: ENVELOPE_VERSION,
        text: typeof text === 'string' ? text : '',
        attachments: normalizedAttachments
    });
}

export function createNetwork({
    TAB_ID,
    toEndpoint,
    dlog,
    showBanner,
    hideBanner,
    statusEl,
    statusDot,
    agentName
}, {
    addClientMsg,
    addClientAttachment,
    addServerMsg,
    showTypingIndicator,
    hideTypingIndicator,
    markUserInputSent
}) {
    let es = null;
    let chatBuffer = '';
    const pendingEchoes = [];
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let pendingUploads = 0;

    function trackUploadStart() {
        pendingUploads += 1;
        showTypingIndicator();
    }

    function trackUploadEnd() {
        pendingUploads = Math.max(0, pendingUploads - 1);
        if (pendingUploads === 0) {
            hideTypingIndicator(true);
        }
    }

    function handleServerChunk(raw) {
        if (raw === undefined || raw === null) {
            return;
        }
        let text = String(raw);
        if (!text) {
            return;
        }

        if (isProcessingChunk(text)) {
            showTypingIndicator();
            return;
        }

        const stripped = stripProcessingPrefix(text);

        const normalized = stripped.trim();

        // Check if this looks like an envelope echo - filter it out
        // Envelopes can start with { or [ or other characters depending on how they're echoed
        if (normalized.includes('"__webchatMessage"') &&
            normalized.includes('"version"') &&
            normalized.includes('"text"') &&
            normalized.includes('"attachments"')) {
            // This is an envelope echo - suppress it
            return;
        }

        if (normalized && pendingEchoes.length) {
            const expected = pendingEchoes[0];
            if (normalized === expected) {
                pendingEchoes.shift();
                return;
            }
        }
        if (stripped !== text) {
            showTypingIndicator();
        }
        if (!stripped.trim()) {
            return;
        }
        if (pendingUploads === 0) {
            hideTypingIndicator();
        }
        addServerMsg(stripped);
    }

    function pushSrvFromBuffer() {
        if (!chatBuffer) {
            return;
        }
        const parts = chatBuffer.split(/\r?\n/);
        chatBuffer = parts.pop() ?? '';
        parts.forEach((part) => {
            const clean = stripCtrlAndAnsi(part);
            handleServerChunk(clean);
        });

        const tailClean = stripCtrlAndAnsi(chatBuffer);
        if (isProcessingChunk(tailClean)) {
            showTypingIndicator();
        }
    }

    function start() {
        dlog('SSE connecting');
        showBanner('Connecting…');
        try {
            es?.close?.();
        } catch (_) {
            // Ignore close failures
        }

        es = new EventSource(toEndpoint(`stream?tabId=${TAB_ID}`));

        es.onopen = () => {
            // Reset reconnect attempts on successful connection
            reconnectAttempts = 0;

            hideTypingIndicator(true);
            if (statusEl) {
                statusEl.textContent = 'online';
            }
            if (statusDot) {
                statusDot.classList.remove('offline');
                statusDot.classList.add('online');
            }
            showBanner('Connected', 'ok');
            setTimeout(() => hideBanner(), 800);
        };

        es.onerror = () => {
            hideTypingIndicator(true);
            if (statusEl) {
                statusEl.textContent = 'offline';
            }
            if (statusDot) {
                statusDot.classList.remove('online');
                statusDot.classList.add('offline');
            }
            try {
                es.close();
            } catch (_) {
                // Ignore close failures
            }

            // Clear any pending reconnect timer
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }

            // CRITICAL FIX: Exponential backoff to prevent reconnection storms
            reconnectAttempts++;
            const baseDelay = 1000; // 1 second
            const maxDelay = 60000; // 60 seconds max
            const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);

            // Add jitter to prevent thundering herd
            const jitter = Math.random() * 1000;
            const totalDelay = delay + jitter;

            if (reconnectAttempts > 1) {
                showBanner(`Reconnecting in ${Math.ceil(totalDelay / 1000)}s (attempt ${reconnectAttempts})...`);
            }

            dlog(`SSE reconnect scheduled in ${Math.ceil(totalDelay)}ms (attempt ${reconnectAttempts})`);

            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                try {
                    start();
                } catch (error) {
                    dlog('SSE restart error', error);
                }
            }, totalDelay);
        };

        es.onmessage = (event) => {
            try {
                const text = JSON.parse(event.data);
                chatBuffer += stripCtrlAndAnsi(text);
                pushSrvFromBuffer();
            } catch (error) {
                dlog('term write error', error);
            }
        };
    }

    function stop() {
        // Clear reconnect timer
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;

        if (!es) {
            return;
        }
        try {
            es.close();
        } catch (_) {
            // Ignore close failures
        }
        es = null;
    }

    function postEnvelope(payload = {}) {
        const text = typeof payload.text === 'string' ? payload.text : '';
        const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
        const serialized = serializeEnvelope({ text, attachments });
        const trimmedEnvelope = serialized.trim();
        const trimmedText = text.trim();

        if (trimmedEnvelope) {
            pendingEchoes.push(trimmedEnvelope);
            pendingEchoes.push(serialized);
            pendingEchoes.push(`${serialized}\n`);
        }
        if (trimmedText) {
            pendingEchoes.push(trimmedText);
        }
        if (pendingEchoes.length > 25) {
            pendingEchoes.splice(0, pendingEchoes.length - 25);
        }

        markUserInputSent();

        return fetch(toEndpoint(`input?tabId=${TAB_ID}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `${serialized}\n`
        }).catch((error) => {
            dlog('chat error', error);
            if (pendingUploads === 0) {
                hideTypingIndicator(true);
            }
            addServerMsg('[input error]');
            showBanner('Chat error', 'err');
            throw error;
        });
    }

    function sendCommand(cmd) {
        const message = typeof cmd === 'string' ? cmd : '';
        addClientMsg(message);
        postEnvelope({ text: message });
        return true;
    }

    function uploadAttachment(filePayload, caption) {
        const { file, previewUrl, revokePreview, previewNeedsRevoke, isImage } = filePayload || {};
        const isFileObject = (typeof File !== 'undefined' && file instanceof File)
            || (file && typeof file.name === 'string' && typeof file.size !== 'undefined');
        if (!isFileObject) {
            if (typeof caption === 'string' && caption.trim()) {
                addClientMsg(caption);
            } else {
                addServerMsg('[upload error: no file selected]');
            }
            return Promise.reject(new Error('no file selected'));
        }

        let clientAttachment = null;
        if (typeof addClientAttachment === 'function') {
            clientAttachment = addClientAttachment({
                fileName: file.name,
                size: file.size,
                mime: file.type,
                previewUrl,
                isImage,
                caption
            });
        } else {
            addClientMsg(caption || file.name);
        }
        trackUploadStart();

        const uploadUrl = '/blobs';

        const mime = file.type || 'application/octet-stream';
        const headers = {
            'Content-Type': mime,
            'X-Mime-Type': mime,
            'X-File-Name': encodeURIComponent(file.name)
        };

        return fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: file,
        })
            .then(res => {
                if (!res.ok) {
                    return res.text().then(text => { throw new Error(text || 'Upload failed') });
                }
                return res.json();
            })
            .then(data => {
                trackUploadEnd();
                const localPath = data.localPath || data.url || null;
                if (!localPath) {
                    throw new Error(data.error || 'Invalid upload response');
                }
                const displayName = data.filename || file.name;
                const basePath = localPath.startsWith('/') ? localPath : `/${localPath}`;
                const absoluteUrl = data.downloadUrl
                    || new URL(basePath, window.location.origin).href;
                if (clientAttachment && typeof clientAttachment.markUploaded === 'function') {
                    clientAttachment.markUploaded({
                        downloadUrl: absoluteUrl,
                        size: data.size ?? (Number.isFinite(file.size) ? file.size : null),
                        mime: data.mime ?? file.type ?? null,
                        localPath,
                        id: data.id ?? null
                    });
                    if (isImage && typeof clientAttachment.replacePreview === 'function') {
                        clientAttachment.replacePreview(absoluteUrl);
                    }
                } else {
                    const linkLabel = displayName || absoluteUrl;
                    const infoMessageFallback = `File uploaded: [${linkLabel}](${absoluteUrl})`;
                    addServerMsg(infoMessageFallback);
                }
                if (previewNeedsRevoke && typeof revokePreview === 'function') {
                    revokePreview();
                }
                return {
                    id: data.id ?? null,
                    filename: displayName || null,
                    mime: data.mime ?? file.type ?? null,
                    size: data.size ?? (Number.isFinite(file.size) ? file.size : null),
                    downloadUrl: absoluteUrl || null,
                    localPath
                };
            })
            .catch(error => {
                trackUploadEnd();
                dlog('upload error', error);
                if (clientAttachment && typeof clientAttachment.markFailed === 'function') {
                    clientAttachment.markFailed(error.message || 'Upload failed');
                } else {
                    addServerMsg(`[upload error: ${error.message}]`);
                }
                showBanner('Upload error', 'err');
                throw error;
            });
    }

    function sendAttachments(fileSelections, caption) {
        const selections = Array.isArray(fileSelections) ? fileSelections : [];
        const text = typeof caption === 'string' ? caption : '';

        if (!selections.length) {
            if (text.trim()) {
                sendCommand(text);
            }
            return;
        }

        const uploads = selections.map((selection, index) => uploadAttachment(selection, index === 0 ? text : ''));

        Promise.allSettled(uploads).then((results) => {
            const attachments = [];
            let hasSuccess = false;

            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value) {
                    hasSuccess = true;
                    attachments.push(result.value);
                }
            });

            const trimmedText = text.trim();

            if (!hasSuccess && !trimmedText) {
                return;
            }

            postEnvelope({ text, attachments });
        }).catch(() => {
            // Individual upload rejections already handled with UI feedback.
        });
    }

    return {
        start,
        stop,
        sendCommand,
        sendAttachments
    };
}
