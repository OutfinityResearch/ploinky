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
const MENU_PADDING_PX = 8;

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

function initMessageContextMenu() {
    if (!chatList || !composer) {
        return;
    }

    const menu = document.createElement('div');
    menu.className = 'wa-context-menu';
    menu.innerHTML = `
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="resubmit">Resubmit</button>
        <button type="button" data-action="cancel">Cancel</button>
    `;
    document.body.appendChild(menu);

    let currentText = '';
    let allowOutsideClose = false;

    const focusComposer = () => {
        setTimeout(() => composer.focus(), 0);
    };

    const hideMenu = ({ refocus = false } = {}) => {
        menu.classList.remove('show');
        menu.style.display = 'none';
        currentText = '';
        if (refocus) {
            focusComposer();
        }
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const showMenu = (x, y, text) => {
        const rawText = typeof text === 'string' ? text : '';
        if (!rawText.trim()) {
            return;
        }
        currentText = rawText;
        menu.style.visibility = 'hidden';
        allowOutsideClose = false;
        menu.classList.add('show');
        menu.style.left = '0px';
        menu.style.top = '0px';
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width - MENU_PADDING_PX;
            const maxY = window.innerHeight - rect.height - MENU_PADDING_PX;
            const left = clamp(x, MENU_PADDING_PX, maxX);
            const top = clamp(y, MENU_PADDING_PX, maxY);
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = 'visible';
            menu.style.display = "block"
            requestAnimationFrame(() => {
                allowOutsideClose = true;
            });
        });
    };

    const getBubbleFromTarget = (target) => {
        if (!target || !(target instanceof Element)) {
            return null;
        }
        const bubble = target.closest('.wa-message-bubble');
        if (!bubble || !chatList.contains(bubble)) {
            return null;
        }
        return bubble;
    };

    const getBubbleText = (bubble) => {
        if (!bubble) {
            return '';
        }
        const fromDataset = typeof bubble.dataset.fullText === 'string' ? bubble.dataset.fullText : '';
        const fallback = bubble.textContent || '';
        return (fromDataset || fallback || '').trim();
    };

    const handleSelectionMenu = (event) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (!range) {
            return;
        }
        const container = range.commonAncestorContainer;
        const element = container instanceof Element ? container : container.parentElement;
        const bubble = getBubbleFromTarget(element);
        if (!bubble) {
            return;
        }
        const rawSelected = selection.toString() || '';
        if (!rawSelected.trim()) {
            return;
        }
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.bottom + 4;
        showMenu(x, y, rawSelected);
    };

    chatList.addEventListener('mouseup', handleSelectionMenu);
    chatList.addEventListener('touchend', handleSelectionMenu);

    menu.addEventListener('click', async (event) => {
        const btn = event.target?.closest('button[data-action]');
        if (!btn) {
            return;
        }
        const action = btn.dataset.action;
        const selectionText = (window.getSelection()?.toString() || '').trim();
        const text = (currentText || selectionText || '').trim();
        if (action === 'copy') {
            if (!text) {
                hideMenu({ refocus: true });
                return;
            }
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    throw new Error('Clipboard unavailable');
                }
            } catch (_) {
                try {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
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
            hideMenu({ refocus: true });
            return;
        }
        if (action === 'resubmit') {
            if (text) {
                composer.setValue(text);
                composer.submit();
            }
            hideMenu({ refocus: true });
            return;
        }
        if (action === 'cancel') {
            hideMenu({ refocus: true });
        }
    });

    document.addEventListener('click', (event) => {
        if (!menu.classList.contains('show')) {
            return;
        }
        if (!allowOutsideClose) {
            return;
        }
        if (menu.contains(event.target)) {
            return;
        }
        hideMenu({ refocus: true });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideMenu({ refocus: true });
        }
    });

    window.addEventListener('resize', () => hideMenu({ refocus: true }));
    chatList.addEventListener('scroll', () => hideMenu({ refocus: true }));
}

refocusComposerAfterIcon(attachmentBtn);
refocusComposerAfterIcon(settingsBtn);
refocusComposerAfterIcon(sttBtn);
initMessageContextMenu();

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
