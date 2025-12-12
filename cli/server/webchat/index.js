import { initDom } from './domSetup.js';
import { createSidePanel } from './sidePanel.js';
import { createMessages } from './messages.js';
import { createComposer } from './composer.js';
import { initSpeechToText } from './speechToText.js';
import { initTextToSpeech } from './textToSpeech.js';
import { createNetwork } from './network.js';
import { createUploader } from './upload.js';

const SEND_TRIGGER_RE = /\bsend\b/i;
const PURGE_TRIGGER_RE = /\bpurge\b/i;
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'];

const dom = initDom();
const {
    TAB_ID,
    dlog,
    markdown,
    requiresAuth,
    basePath,
    toEndpoint,
    showBanner,
    hideBanner,
    getViewMoreLineLimit,
    setViewMoreChangeHandler,
    elements
} = dom;

const {
    chatList,
    typingIndicator,
    chatContainer,
    chatArea,
    sidePanel,
    sidePanelContent,
    sidePanelClose,
    sidePanelTitle,
    sidePanelResizer,
    statusEl,
    statusDot,
    cmdInput,
    sendBtn,
    sttBtn,
    sttStatus,
    sttLang,
    sttEnable,
    ttsEnable,
    ttsVoice,
    ttsRate,
    ttsRateValue,
    settingsBtn,
    settingsPanel,
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
} = elements;

const sidePanelApi = createSidePanel({
    chatContainer,
    chatArea,
    sidePanel,
    sidePanelContent,
    sidePanelClose,
    sidePanelTitle,
    sidePanelResizer
}, { markdown });

const textToSpeech = initTextToSpeech({
    ttsEnable,
    ttsVoice,
    ttsRate,
    ttsRateValue
}, { dlog, toEndpoint, provider: dom.ttsProvider });

const messages = createMessages({
    chatList,
    typingIndicator
}, {
    markdown,
    initialViewMoreLineLimit: getViewMoreLineLimit(),
    sidePanel: sidePanelApi,
    onServerOutput: textToSpeech.handleServerOutput
});

dom.setViewMoreChangeHandler((limit) => {
    messages.setViewMoreLineLimit(limit);
});

sidePanelApi.bindLinkDelegation(chatList);

dlog('Initializing network for agent:', dom.agentName);
const network = createNetwork({
    TAB_ID,
    toEndpoint,
    dlog,
    showBanner,
    hideBanner,
    statusEl,
    statusDot,
    agentName: dom.agentName
}, {
    addClientMsg: messages.addClientMsg,
    addClientAttachment: messages.addClientAttachment,
    addServerMsg: messages.addServerMsg,
    showTypingIndicator: messages.showTypingIndicator,
    hideTypingIndicator: messages.hideTypingIndicator,
    markUserInputSent: messages.markUserInputSent
});

const composer = createComposer({
    cmdInput,
    sendBtn
}, {
    purgeTriggerRe: PURGE_TRIGGER_RE
});

const uploader = createUploader({
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
}, { composer });

function refocusComposerAfterIcon(btn) {
    if (!btn) {
        return;
    }
    btn.addEventListener('click', () => {
        setTimeout(() => composer.focus(), 0);
    });
}

function initMessageToolbar() {
    if (!chatList || !composer) {
        return;
    }

    const getBubbleText = (bubble) => {
        if (!bubble) {
            return '';
        }
        const fromDataset = typeof bubble.dataset.fullText === 'string' ? bubble.dataset.fullText : '';
        const fallback = bubble.textContent || '';
        return (fromDataset || fallback || '').trim();
    };

    const setRating = (bubble, rating) => {
        if (!bubble) {
            return;
        }
        const menu = bubble.querySelector('.wa-context-menu');
        if (!menu) {
            return;
        }
        if (rating) {
            bubble.dataset.rating = rating;
        } else {
            delete bubble.dataset.rating;
        }
        const upBtn = menu.querySelector('[data-action="thumb-up"]');
        const downBtn = menu.querySelector('[data-action="thumb-down"]');
        const mark = (btn, isActive) => {
            if (!btn) {
                return;
            }
            if (isActive) {
                btn.dataset.active = 'true';
            } else {
                delete btn.dataset.active;
            }
        };
        mark(upBtn, rating === 'up');
        mark(downBtn, rating === 'down');
    };

    const copyText = async (text) => {
        const value = (text || '').trim();
        if (!value) {
            return;
        }
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                throw new Error('Clipboard unavailable');
            }
        } catch (_) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            } catch (_) {
                // ignore copy failures
            }
        }
    };

    const handleAction = (action, bubble) => {
        const text = getBubbleText(bubble);
        if (action === 'copy') {
            copyText(text);
            return;
        }
        if (action === 'insert') {
            if (text) {
                composer.setValue(text);
                composer.focus();
            }
            return;
        }
        if (action === 'thumb-up' || action === 'thumb-down') {
            const desired = action === 'thumb-up' ? 'up' : 'down';
            const current = bubble?.dataset?.rating;
            const next = current === desired ? '' : desired;
            setRating(bubble, next);
        }
    };

    const attachMenuToBubble = (bubble) => {
        if (!bubble || bubble.querySelector('.wa-context-menu')) {
            return;
        }
        const message = bubble.closest('.wa-message');
        if (message && message.classList.contains('wa-typing')) {
            return;
        }
        const menu = document.createElement('div');
        menu.className = 'wa-context-menu';
        menu.innerHTML = `
            <button type="button" data-action="copy" title="Copy">Copy</button>
            <button type="button" data-action="insert" title="Insert into prompt">Insert</button>
            <button type="button" data-action="thumb-up" title="Thumb up">👍</button>
            <button type="button" data-action="thumb-down" title="Thumb down">👎</button>
        `;
        menu.addEventListener('click', (event) => {
            const btn = event.target?.closest('button[data-action]');
            if (!btn) {
                return;
            }
            const action = btn.dataset.action;
            handleAction(action, bubble);
        });
        bubble.appendChild(menu);
    };

    const attachToExisting = () => {
        const bubbles = chatList.querySelectorAll('.wa-message-bubble');
        bubbles.forEach((bubble) => attachMenuToBubble(bubble));
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes?.forEach((node) => {
                if (!(node instanceof Element)) {
                    return;
                }
                if (node.classList.contains('wa-message-bubble')) {
                    attachMenuToBubble(node);
                    return;
                }
                const nested = node.querySelectorAll?.('.wa-message-bubble');
                if (nested && nested.length) {
                    nested.forEach((bubble) => attachMenuToBubble(bubble));
                }
            });
        }
    });

    attachToExisting();
    observer.observe(chatList, { childList: true, subtree: true });
}

refocusComposerAfterIcon(attachmentBtn);
refocusComposerAfterIcon(settingsBtn);
refocusComposerAfterIcon(sttBtn);
initMessageToolbar();

composer.setSendHandler((cmdText) => {
    const cmd = cmdText.trim();
    const fileSelections = uploader.getSelectedFiles();

    if (fileSelections.length) {
        network.sendAttachments(fileSelections, cmd);
        uploader.clearFiles();
        return true;
    }

    if (cmd) {
        network.sendCommand(cmd);
        return true;
    }

    return false;
});

initSpeechToText({
    sttBtn,
    sttStatus,
    sttLang,
    sttEnable,
    settingsBtn,
    settingsPanel
}, {
    composer,
    purgeTriggerRe: PURGE_TRIGGER_RE,
    sendTriggerRe: SEND_TRIGGER_RE,
    dlog,
    provider: dom.sttProvider
});

const isEditableTarget = (target) => {
    if (!target) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    const tag = target.tagName;
    if (!tag) {
        return false;
    }
    return EDITABLE_TAGS.includes(tag);
};

document.addEventListener('keydown', (event) => {
    if (!composer || !cmdInput) {
        return;
    }
    if (event.defaultPrevented) {
        return;
    }
    if (document.activeElement === cmdInput) {
        return;
    }
    const activeEl = document.activeElement;
    if (isEditableTarget(activeEl) && activeEl !== cmdInput) {
        return;
    }
    if (isEditableTarget(event.target) && event.target !== cmdInput) {
        return;
    }
    const handled = typeof composer.typeFromKeyEvent === 'function'
        ? composer.typeFromKeyEvent(event)
        : false;
    if (handled) {
        event.preventDefault();
    }
});

(async () => {
    if (requiresAuth) {
        const ok = await fetch(toEndpoint('whoami')).then((res) => res.ok).catch(() => false);
        if (!ok) {
            window.location.href = basePath || '.';
            return;
        }
    }
})();

network.start();
