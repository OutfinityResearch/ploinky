const PROCESS_PREFIX_RE = /^(?:\s*\.+\s*){3,}/;

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
    addServerMsg,
    showTypingIndicator,
    hideTypingIndicator,
    markUserInputSent
}) {
    let es = null;
    let chatBuffer = '';

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
        if (stripped !== text) {
            showTypingIndicator();
        }
        if (!stripped.trim()) {
            return;
        }
        hideTypingIndicator();
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
            setTimeout(() => {
                try {
                    start();
                } catch (error) {
                    dlog('SSE restart error', error);
                }
            }, 1000);
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

    function sendCommand(cmd) {
        addClientMsg(cmd);
        markUserInputSent();
        fetch(toEndpoint(`input?tabId=${TAB_ID}`), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: `${cmd}\n`
        }).catch((error) => {
            dlog('chat error', error);
            hideTypingIndicator(true);
            addServerMsg('[input error]');
            showBanner('Chat error', 'err');
        });
        return true;
    }

    function uploadFile(file, caption) {
        const formData = new FormData();
        formData.append('file', file);

        const uploadMessage = caption || file.name;
        addClientMsg(uploadMessage);
        markUserInputSent();
        showTypingIndicator();

        const agentSegment = encodeURIComponent(agentName);
        const uploadUrl = `/blobs/${agentSegment}`;

        fetch(uploadUrl, {
            method: 'POST',
            body: formData,
        })
        .then(res => {
            if (!res.ok) {
                return res.text().then(text => { throw new Error(text || 'Upload failed') });
            }
            return res.json();
        })
        .then(data => {
            hideTypingIndicator();
            if (data.url) {
                // If the user provided a caption, send it to the TTY as a normal command.
                const metaPayload = {
                    name: file.name,
                    url: data.url,
                    size: data.size ?? file.size ?? null,
                    mime: data.mime ?? file.type ?? null,
                    id: data.id ?? null
                };
                const hiddenLine = `: [[uploaded-file]]${JSON.stringify(metaPayload)}`;
                const parts = [];
                if (caption) {
                    parts.push(caption);
                }
                parts.push(hiddenLine);
                const combined = `${parts.join('\n')}\n`;

                fetch(toEndpoint(`input?tabId=${TAB_ID}`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: combined
                }).catch((error) => {
                    dlog('chat error after upload', error);
                    addServerMsg('[input error]');
                });
                // Display the result of the upload as a separate, informational message.
                // This does NOT get executed by the shell.
                addServerMsg(`File uploaded: ${data.url}`);
            } else {
                throw new Error(data.error || 'Invalid upload response');
            }
        })
        .catch(error => {
            dlog('upload error', error);
            hideTypingIndicator();
            addServerMsg(`[upload error: ${error.message}]`);
            showBanner('Upload error', 'err');
        });
    }

    return {
        start,
        stop,
        sendCommand,
        uploadFile
    };
}
