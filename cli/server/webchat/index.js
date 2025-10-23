import { initDom } from './domSetup.js';
import { createSidePanel } from './sidePanel.js';
import { createMessages } from './messages.js';
import { createComposer } from './composer.js';
import { initSpeechToText } from './speechToText.js';
import { createNetwork } from './network.js';
import { createUploader } from './upload.js';

const SEND_TRIGGER_RE = /\bsend\b/i;
const PURGE_TRIGGER_RE = /\bpurge\b/i;

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

const messages = createMessages({
    chatList,
    typingIndicator
}, {
    markdown,
    initialViewMoreLineLimit: getViewMoreLineLimit(),
    sidePanel: sidePanelApi
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

composer.setSendHandler((cmdText) => {
    const cmd = cmdText.trim();
    const fileSelection = uploader.getSelectedFile();
    const file = fileSelection?.file;

    if (file) {
        network.uploadFile(fileSelection, cmd);
        uploader.clearFile();
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
    dlog
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
