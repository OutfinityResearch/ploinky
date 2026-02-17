import { formatBytes, getFileIcon } from './fileHelpers.js';

const ENABLE_SELECT_PAGINATION_ACTIONS = false;

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
    onServerOutput,
    onQuickCommand
}) {
    const lastServerMsg = { bubble: null, fullText: '' };
    let userInputSent = false;
    let lastClientCommand = '';
    let viewMoreLineLimit = Math.max(1, initialViewMoreLineLimit || 1);
    let serverSpeechHandler = typeof onServerOutput === 'function' ? onServerOutput : null;
    let quickCommandHandler = typeof onQuickCommand === 'function' ? onQuickCommand : null;
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

    function parseSelectPaginationState(text) {
        const safeText = typeof text === 'string' ? text : '';
        const match = safeText.match(/Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+(.+?)\(s\)\./i);
        if (!match) {
            return null;
        }

        const start = Number.parseInt(match[1], 10);
        const end = Number.parseInt(match[2], 10);
        const total = Number.parseInt(match[3], 10);
        const entity = (match[4] || '').trim().toLowerCase();
        if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total) || total <= 0) {
            return null;
        }
        return {
            start,
            end,
            total,
            entity,
            hasMore: end < total,
        };
    }

    function parseConfirmationPromptState(text) {
        const safeText = typeof text === 'string' ? text : '';
        const normalized = safeText.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return null;
        }

        const confirmPattern = /(?:^|\b)(?:reply|please reply|type)\s+(?:\*\*|["'`])?yes(?:\*\*|["'`])?\s+to\s+[^.\n]{1,120}?\s+or\s+(?:\*\*|["'`])?no(?:\*\*|["'`])?\s+to\s+[^.\n]{1,120}/i;
        if (!confirmPattern.test(normalized)) {
            return null;
        }

        return {
            yesCommand: 'yes',
            noCommand: 'no',
        };
    }

    function parseAbortPromptState(text) {
        const safeText = typeof text === 'string' ? text : '';
        const normalized = safeText.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return null;
        }

        const abortPattern = /(?:^|\b)(?:type|reply with|reply)\s+(?:\*\*|["'`])?cancel(?:\*\*|["'`])?\s+to\s+(?:abort|cancel)\b/i;
        if (!abortPattern.test(normalized)) {
            return null;
        }

        return {
            cancelCommand: 'cancel',
        };
    }

    function updatePaginationActions(bubble, fullText) {
        if (!bubble) {
            return;
        }
        const existing = bubble.querySelector('.wa-pagination-actions');
        if (!ENABLE_SELECT_PAGINATION_ACTIONS) {
            if (existing) {
                existing.remove();
            }
            return;
        }
        const pagination = parseSelectPaginationState(fullText);

        if (!pagination || !pagination.hasMore || typeof quickCommandHandler !== 'function') {
            if (existing) {
                existing.remove();
            }
            return;
        }

        const holder = existing || document.createElement('div');
        holder.className = 'wa-pagination-actions';
        holder.innerHTML = '';

        const createActionButton = ({ label, command, className }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = className;
            btn.textContent = label;
            btn.addEventListener('click', () => {
                if (btn.disabled) {
                    return;
                }
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                try {
                    const accepted = quickCommandHandler(command);
                    if (accepted !== false) {
                        holder.remove();
                    } else {
                        btn.disabled = false;
                        btn.removeAttribute('aria-busy');
                    }
                } catch (_) {
                    btn.disabled = false;
                    btn.removeAttribute('aria-busy');
                }
            });
            return btn;
        };

        const nextCommand = pagination.entity ? `next ${pagination.entity}` : 'next';
        const showAllCommand = pagination.entity ? `show all ${pagination.entity}` : 'show all';

        holder.appendChild(createActionButton({
            label: `Show more (${pagination.end}/${pagination.total})`,
            command: nextCommand,
            className: 'wa-pagination-more-btn',
        }));
        holder.appendChild(createActionButton({
            label: 'Show all',
            command: showAllCommand,
            className: 'wa-pagination-all-btn',
        }));
        const timeNode = bubble.querySelector('.wa-message-time');
        if (!existing) {
            if (timeNode) {
                bubble.insertBefore(holder, timeNode);
            } else {
                bubble.appendChild(holder);
            }
        }
    }

    function updateConfirmationActions(bubble, fullText) {
        if (!bubble) {
            return;
        }
        const existing = bubble.querySelector('.wa-confirm-actions');
        const messageNode = bubble.closest('.wa-message');
        const isIncoming = Boolean(messageNode?.classList?.contains('in'));
        const confirmation = parseConfirmationPromptState(fullText);

        if (!isIncoming || !confirmation || typeof quickCommandHandler !== 'function') {
            if (existing) {
                existing.remove();
            }
            return;
        }

        const holder = existing || document.createElement('div');
        holder.className = 'wa-confirm-actions';
        holder.innerHTML = '';

        const setButtonsEnabled = (enabled) => {
            const buttons = holder.querySelectorAll('button');
            buttons.forEach((button) => {
                button.disabled = !enabled;
                if (enabled) {
                    button.removeAttribute('aria-busy');
                }
            });
        };

        const createActionButton = ({ label, command, className }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.textContent = label;
            button.addEventListener('click', () => {
                if (button.disabled) {
                    return;
                }
                setButtonsEnabled(false);
                button.setAttribute('aria-busy', 'true');
                try {
                    const accepted = quickCommandHandler(command);
                    if (accepted !== false) {
                        holder.remove();
                    } else {
                        setButtonsEnabled(true);
                    }
                } catch (_) {
                    setButtonsEnabled(true);
                }
            });
            return button;
        };

        holder.appendChild(createActionButton({
            label: 'Yes',
            command: confirmation.yesCommand,
            className: 'wa-confirm-yes-btn',
        }));
        holder.appendChild(createActionButton({
            label: 'No',
            command: confirmation.noCommand,
            className: 'wa-confirm-no-btn',
        }));

        if (!existing) {
            const timeNode = bubble.querySelector('.wa-message-time');
            if (timeNode) {
                bubble.insertBefore(holder, timeNode);
            } else {
                bubble.appendChild(holder);
            }
        }
    }

    function updateAbortActions(bubble, fullText) {
        if (!bubble) {
            return;
        }
        const existing = bubble.querySelector('.wa-abort-actions');
        const messageNode = bubble.closest('.wa-message');
        const isIncoming = Boolean(messageNode?.classList?.contains('in'));
        const abortState = parseAbortPromptState(fullText);

        if (!isIncoming || !abortState || typeof quickCommandHandler !== 'function') {
            if (existing) {
                existing.remove();
            }
            return;
        }

        const holder = existing || document.createElement('div');
        holder.className = 'wa-abort-actions';
        holder.innerHTML = '';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wa-abort-cancel-btn';
        button.textContent = 'Cancel';
        button.addEventListener('click', () => {
            if (button.disabled) {
                return;
            }
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try {
                const accepted = quickCommandHandler(abortState.cancelCommand);
                if (accepted !== false) {
                    holder.remove();
                } else {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            } catch (_) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        });
        holder.appendChild(button);

        if (!existing) {
            const timeNode = bubble.querySelector('.wa-message-time');
            if (timeNode) {
                bubble.insertBefore(holder, timeNode);
            } else {
                bubble.appendChild(holder);
            }
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

        updatePaginationActions(bubble, safeText);
        updateConfirmationActions(bubble, safeText);
        updateAbortActions(bubble, safeText);
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
        const bubble = wrapper.querySelector('.wa-message-bubble');
        if (textDiv) {
            textDiv.innerHTML = renderMarkdown(text);
            sidePanel.bindLinkDelegation(textDiv);
        }
        if (bubble) {
            bubble.dataset.fullText = text;
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
        bubble.dataset.fullText = caption || displayName || '';

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
        },
        setQuickCommandHandler: (fn) => {
            quickCommandHandler = typeof fn === 'function' ? fn : null;
            applyViewMoreSettingToAllBubbles();
        }
    };
}
