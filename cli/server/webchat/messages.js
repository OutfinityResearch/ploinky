import { formatBytes, getFileIcon } from './fileHelpers.js';

function formatTime() {
    const date = new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function createMessages({
    chatList,
    typingIndicator
}, {
    markdown,
    initialViewMoreLineLimit,
    sidePanel,
    onServerOutput
}) {
    const lastServerMsg = { bubble: null, fullText: '' };
    let userInputSent = false;
    let lastClientCommand = '';
    let viewMoreLineLimit = Math.max(1, initialViewMoreLineLimit || 1);
    let serverSpeechHandler = typeof onServerOutput === 'function' ? onServerOutput : null;
    let speechDebounceTimer = null;

    function appendMessageEl(node) {
        if (!node || !chatList) {
            return;
        }
        try {
            if (typingIndicator && typingIndicator.parentNode === chatList) {
                chatList.insertBefore(node, typingIndicator);
            } else {
                chatList.appendChild(node);
            }
        } catch (_) {
            try {
                chatList.appendChild(node);
            } catch (__) {
                // Ignore append errors
            }
        }
    }

    let typingActive = false;

    function showTypingIndicator() {
        if (!typingIndicator) {
            return;
        }
        typingActive = true;
        typingIndicator.classList.add('show');
        typingIndicator.setAttribute('aria-hidden', 'false');
        try {
            chatList.scrollTop = chatList.scrollHeight;
        } catch (_) {
            // Ignore scroll failures
        }
    }

    function hideTypingIndicator(force = false) {
        if (!typingIndicator) {
            return;
        }
        if (!typingActive && !force) {
            return;
        }
        typingActive = false;
        typingIndicator.classList.remove('show');
        typingIndicator.setAttribute('aria-hidden', 'true');
    }

    function renderMarkdown(text) {
        if (!text) {
            return '';
        }
        if (markdown && typeof markdown.render === 'function') {
            try {
                return markdown.render(text);
            } catch (error) {
                console.error('[webchat] Markdown render error:', error);
                return text;
            }
        }
        return text;
    }

    function updatePanelIfActive(bubble, text) {
        if (sidePanel.isActive(bubble)) {
            sidePanel.updateIfActive(bubble, text);
        }
    }

    function updateBubbleContent(bubble, fullText) {
        const safeText = typeof fullText === 'string' ? fullText : '';
        bubble.dataset.fullText = safeText;

        const lines = safeText.split('\n');
        const limit = Math.max(1, viewMoreLineLimit);
        const shouldCollapse = lines.length > limit;
        const displayText = shouldCollapse ? lines.slice(0, limit).join('\n') : safeText;

        const textContainer = bubble.querySelector('.wa-message-text');
        const moreNode = bubble.querySelector('.wa-message-more');
        if (textContainer) {
            textContainer.innerHTML = renderMarkdown(displayText);
            sidePanel.bindLinkDelegation(textContainer);
        }

        if (shouldCollapse) {
            if (!moreNode) {
                const viewMore = document.createElement('div');
                viewMore.className = 'wa-message-more';
                viewMore.textContent = 'View more';
                viewMore.onclick = () => sidePanel.openText(bubble, safeText);
                bubble.appendChild(viewMore);
            } else {
                moreNode.onclick = () => sidePanel.openText(bubble, safeText);
            }
            updatePanelIfActive(bubble, safeText);
        } else if (moreNode) {
            moreNode.remove();
            if (sidePanel.isActive(bubble)) {
                sidePanel.close();
            }
        } else if (sidePanel.isActive(bubble)) {
            sidePanel.close();
        }
    }

    function applyViewMoreSettingToAllBubbles() {
        if (!chatList) {
            return;
        }
        const bubbles = chatList.querySelectorAll('.wa-message-bubble');
        bubbles.forEach((bubble) => {
            const text = bubble.dataset?.fullText;
            if (typeof text === 'string') {
                updateBubbleContent(bubble, text);
            }
        });
    }

    function emitServerOutput(text) {
        if (!serverSpeechHandler) {
            return;
        }
        const safe = typeof text === 'string' ? text.trim() : '';
        if (!safe) {
            return;
        }
        try {
            serverSpeechHandler(safe);
        } catch (error) {
            console.warn('[webchat] tts handler error:', error);
        }
    }

    function scheduleSpeech(text) {
        if (!serverSpeechHandler) {
            return;
        }
        if (speechDebounceTimer) {
            clearTimeout(speechDebounceTimer);
        }
        const captured = typeof text === 'string' ? text : '';
        speechDebounceTimer = setTimeout(() => {
            speechDebounceTimer = null;
            emitServerOutput(captured);
        }, 250);
    }

    function addClientMsg(text) {
        lastClientCommand = text;
        const wrapper = document.createElement('div');
        wrapper.className = 'wa-message out';
        wrapper.innerHTML = `
            <div class="wa-message-bubble">
                <div class="wa-message-text"></div>
                <span class="wa-message-time">
                    ${formatTime()}
                    <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0L15.354 3.656a.5.5 0 0 0-.707-.707L14 3.596 11.071.653zm-4.207 0a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0l.994-.993a.5.5 0 0 0-.707-.707L9.793 3.596 6.864.653z"/></svg>
                </span>
            </div>`;
        const textDiv = wrapper.querySelector('.wa-message-text');
        if (textDiv) {
            textDiv.innerHTML = renderMarkdown(text);
            sidePanel.bindLinkDelegation(textDiv);
        }
        appendMessageEl(wrapper);
        if (chatList) {
            chatList.scrollTop = chatList.scrollHeight;
        }
        lastServerMsg.bubble = null;
    }

    function addClientAttachment({
        fileName,
        size,
        mime,
        previewUrl,
        isImage,
        caption
    }) {
        const displayName = fileName || 'Attachment';
        const wrapper = document.createElement('div');
        wrapper.className = 'wa-message out wa-message-attachment';
        wrapper.dataset.attachmentName = displayName;
        if (mime) {
            wrapper.dataset.attachmentMime = mime;
        }
        if (typeof size === 'number' && Number.isFinite(size)) {
            wrapper.dataset.attachmentSize = String(size);
        }
        if (previewUrl) {
            wrapper.dataset.attachmentPreviewUrl = previewUrl;
        }
        if (caption) {
            wrapper.dataset.attachmentCaption = caption;
        }
        wrapper.dataset.attachmentStatus = 'uploading';

        lastClientCommand = caption || displayName;

        const bubble = document.createElement('div');
        bubble.className = 'wa-message-bubble';

        const content = document.createElement('div');
        content.className = 'wa-attachment-message';

        const thumb = document.createElement('div');
        thumb.className = 'wa-file-preview-thumbnail';
        let thumbImage = null;
        if (isImage && previewUrl) {
            thumbImage = document.createElement('img');
            thumbImage.src = previewUrl;
            thumbImage.alt = displayName;
            thumb.appendChild(thumbImage);
        } else {
            thumb.innerHTML = getFileIcon(displayName);
        }

        const info = document.createElement('div');
        info.className = 'wa-file-preview-info';

        let nameNode = document.createElement('span');
        nameNode.className = 'wa-file-preview-name';
        nameNode.textContent = displayName;

        const sizeNode = document.createElement('div');
        sizeNode.className = 'wa-file-preview-size';
        if (typeof size === 'number' && Number.isFinite(size)) {
            const parts = [formatBytes(size)];
            if (mime) {
                parts.push(mime);
            }
            sizeNode.textContent = parts.join(' · ');
        } else if (mime) {
            sizeNode.textContent = mime;
        } else {
            sizeNode.textContent = '';
        }

        const statusNode = document.createElement('div');
        statusNode.className = 'wa-file-preview-status';
        statusNode.textContent = 'Uploading…';

        info.appendChild(nameNode);
        info.appendChild(sizeNode);
        info.appendChild(statusNode);

        content.appendChild(thumb);
        content.appendChild(info);
        bubble.appendChild(content);

        if (caption) {
            const captionNode = document.createElement('div');
            captionNode.className = 'wa-attachment-caption';
            captionNode.innerHTML = renderMarkdown(caption);
            sidePanel.bindLinkDelegation(captionNode);
            bubble.appendChild(captionNode);
        }

        const timeNode = document.createElement('span');
        timeNode.className = 'wa-message-time';
        timeNode.innerHTML = `
            ${formatTime()}
            <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0L15.354 3.656a.5.5 0 0 0-.707-.707L14 3.596 11.071.653zm-4.207 0a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0l.994-.993a.5.5 0 0 0-.707-.707L9.793 3.596 6.864.653z"/></svg>
        `;
        bubble.appendChild(timeNode);

        wrapper.appendChild(bubble);
        sidePanel.bindLinkDelegation(bubble);
        appendMessageEl(wrapper);
        if (chatList) {
            chatList.scrollTop = chatList.scrollHeight;
        }
        lastServerMsg.bubble = null;

        function ensureLinkNode(downloadUrl) {
            if (!downloadUrl) {
                return;
            }
            if (nameNode.tagName.toLowerCase() !== 'a') {
                const link = document.createElement('a');
                link.className = 'wa-file-preview-name';
                link.textContent = nameNode.textContent || displayName;
                nameNode.replaceWith(link);
                nameNode = link;
            }
            nameNode.href = downloadUrl;
            nameNode.target = '_blank';
            nameNode.rel = 'noopener noreferrer';
        }

        return {
            markUploaded({
                downloadUrl,
                size: uploadedSize,
                mime: uploadedMime,
                localPath,
                id
            }) {
                if (downloadUrl) {
                    wrapper.dataset.attachmentDownloadUrl = downloadUrl;
                }
                if (localPath) {
                    wrapper.dataset.attachmentLocalPath = localPath;
                }
                if (id) {
                    wrapper.dataset.attachmentId = id;
                }
                if (uploadedMime) {
                    wrapper.dataset.attachmentMime = uploadedMime;
                }
                wrapper.dataset.attachmentStatus = 'uploaded';
                if (typeof uploadedSize === 'number' && Number.isFinite(uploadedSize)) {
                    wrapper.dataset.attachmentSize = String(uploadedSize);
                    const parts = [formatBytes(uploadedSize)];
                    const mimeLabel = uploadedMime || mime;
                    if (mimeLabel) {
                        parts.push(mimeLabel);
                    }
                    sizeNode.textContent = parts.join(' · ');
                }
                ensureLinkNode(downloadUrl);
                statusNode.classList.remove('error');
                statusNode.textContent = '';
                if (downloadUrl) {
                    statusNode.textContent = 'Link: ';
                    const link = document.createElement('a');
                    link.className = 'wa-attachment-link';
                    link.href = downloadUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = downloadUrl;
                    statusNode.appendChild(link);
                } else {
                    statusNode.textContent = 'Uploaded';
                }
            },
            replacePreview(nextUrl) {
                if (!nextUrl) {
                    return;
                }
                if (thumbImage) {
                    thumbImage.src = nextUrl;
                }
                wrapper.dataset.attachmentPreviewUrl = nextUrl;
            },
            markFailed(message) {
                wrapper.dataset.attachmentStatus = 'error';
                statusNode.classList.add('error');
                statusNode.textContent = message || 'Upload failed';
            }
        };
    }

    function addServerMsg(text) {
        let normalized = typeof text === 'string' ? text : '';

        // Filter out raw envelope JSON to prevent it from appearing in chat
        const trimmedNormalized = normalized.trim();
        // Envelopes can start with various characters depending on how they're echoed
        if (trimmedNormalized.includes('"__webchatMessage"') &&
            trimmedNormalized.includes('"version"') &&
            trimmedNormalized.includes('"text"') &&
            trimmedNormalized.includes('"attachments"')) {
            // This looks like a raw envelope echo - skip it
            return;
        }

        if (lastClientCommand) {
            const trimmed = lastClientCommand.trim();
            if (trimmed) {
                const lines = normalized.split(/\r?\n/);
                while (lines.length && lines[0].trim() === trimmed) {
                    lines.shift();
                }
                normalized = lines.join('\n');
            }
            lastClientCommand = '';
            normalized = normalized.replace(/^\n+/, '');
        }

        if (!normalized.trim()) {
            lastServerMsg.bubble = null;
            lastServerMsg.fullText = '';
            userInputSent = false;
            return;
        }

        const previousFullText = typeof lastServerMsg.fullText === 'string' ? lastServerMsg.fullText : '';
        const appendToExisting = !userInputSent && lastServerMsg.bubble;

        if (appendToExisting) {
            const combined = previousFullText ? `${previousFullText}\n${normalized}` : normalized;
            lastServerMsg.fullText = combined;
            updateBubbleContent(lastServerMsg.bubble, combined);
            scheduleSpeech(combined);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'wa-message in';
            const bubble = document.createElement('div');
            bubble.className = 'wa-message-bubble';
            bubble.innerHTML = '<div class="wa-message-text"></div><span class="wa-message-time"></span>';
            wrapper.appendChild(bubble);

            lastServerMsg.bubble = bubble;
            lastServerMsg.fullText = normalized;
            userInputSent = false;

            updateBubbleContent(bubble, normalized);
            const timeNode = bubble.querySelector('.wa-message-time');
            if (timeNode) {
                timeNode.textContent = formatTime();
            }
            appendMessageEl(wrapper);
            scheduleSpeech(normalized);
        }

        if (chatList) {
            chatList.scrollTop = chatList.scrollHeight;
        }
    }

    return {
        addClientMsg,
        addClientAttachment,
        addServerMsg,
        showTypingIndicator,
        hideTypingIndicator,
        applyViewMoreSettingToAllBubbles,
        setViewMoreLineLimit: (limit) => {
            const next = Math.max(1, Number(limit) || 1);
            if (next === viewMoreLineLimit) {
                return;
            }
            viewMoreLineLimit = next;
            applyViewMoreSettingToAllBubbles();
        },
        markUserInputSent: () => {
            userInputSent = true;
        },
        setServerSpeechHandler: (fn) => {
            serverSpeechHandler = typeof fn === 'function' ? fn : null;
            if (!serverSpeechHandler && speechDebounceTimer) {
                clearTimeout(speechDebounceTimer);
                speechDebounceTimer = null;
            }
        }
    };
}
