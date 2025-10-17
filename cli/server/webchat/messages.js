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
    sidePanel
}) {
    const lastServerMsg = { bubble: null, fullText: '' };
    let userInputSent = false;
    let lastClientCommand = '';
    let viewMoreLineLimit = Math.max(1, initialViewMoreLineLimit || 1);

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

    function addServerMsg(text) {
        let normalized = typeof text === 'string' ? text : '';
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

        if (!userInputSent && lastServerMsg.bubble) {
            lastServerMsg.fullText += `\n${normalized}`;
            updateBubbleContent(lastServerMsg.bubble, lastServerMsg.fullText);
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
        }

        if (chatList) {
            chatList.scrollTop = chatList.scrollHeight;
        }
    }

    return {
        addClientMsg,
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
        }
    };
}
