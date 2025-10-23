const VIEW_MORE_LINES_KEY = 'wa_view_more_lines';
const LEGACY_VIEW_MORE_KEY = 'wa_view_more_enabled';

function readInitialViewMoreLimit() {
    let limit = 1000;
    try {
        const storedLimit = localStorage.getItem(VIEW_MORE_LINES_KEY);
        if (storedLimit !== null) {
            const parsed = parseInt(storedLimit, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
                limit = parsed;
            }
        } else {
            const legacy = localStorage.getItem(LEGACY_VIEW_MORE_KEY);
            if (legacy === 'true') {
                limit = 6;
            } else if (legacy === 'false') {
                limit = 1000;
            }
        }
    } catch (_) {
        limit = 1000;
    }
    try {
        localStorage.removeItem(LEGACY_VIEW_MORE_KEY);
        localStorage.setItem(VIEW_MORE_LINES_KEY, String(limit));
    } catch (_) {
        // Ignore storage issues
    }
    return limit;
}

export function initDom() {
    const TAB_ID = crypto.randomUUID();
    const dlog = (...args) => console.log('[webchat]', ...args);

    const body = document.body;
    const markdown = window.webchatMarkdown;

    const titleBar = document.getElementById('titleBar');
    const avatarInitial = document.getElementById('avatarInitial');
    const statusEl = document.getElementById('statusText');
    const statusDot = document.querySelector('.wa-status-dot');
    const themeToggle = document.getElementById('themeToggle');
    const banner = document.getElementById('connBanner');
    const bannerText = document.getElementById('bannerText');
    const chatList = document.getElementById('chatList');
    const typingIndicator = document.getElementById('typingIndicator');
    const cmdInput = document.getElementById('cmd');
    const sendBtn = document.getElementById('send');
    const chatContainer = document.getElementById('chatContainer');
    const chatArea = document.getElementById('chatArea');
    const sidePanel = document.getElementById('sidePanel');
    const sidePanelContent = document.getElementById('sidePanelContent');
    const sidePanelClose = document.getElementById('sidePanelClose');
    const sidePanelTitle = document.querySelector('.wa-side-panel-title');
    const sidePanelResizer = document.getElementById('sidePanelResizer');
    const sttBtn = document.getElementById('sttBtn');
    const sttStatus = document.getElementById('sttStatus');
    const sttLang = document.getElementById('sttLang');
    const sttEnable = document.getElementById('sttEnable');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const viewMoreLinesInput = document.getElementById('viewMoreLines');
    const ttsEnable = document.getElementById('ttsEnable');
    const ttsVoice = document.getElementById('ttsVoice');
    const ttsRate = document.getElementById('ttsRate');
    const ttsRateValue = document.getElementById('ttsRateValue');

    const attachmentBtn = document.getElementById('attachmentBtn');
    const attachmentMenu = document.getElementById('attachmentMenu');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    const cameraActionBtn = document.getElementById('cameraActionBtn');
    const attachmentContainer = document.querySelector('.wa-attachment-container');
    const fileUploadInput = document.getElementById('fileUploadInput');
    const filePreviewContainer = document.getElementById('filePreviewContainer');

    const requiresAuth = body.dataset.auth === 'true';
    const agentName = (body.dataset.agent || '').trim();
    const displayName = (body.dataset.title || '').trim();
    const basePath = (body.dataset.base || '').replace(/\/$/, '') || '';
    const ttsProvider = (body.dataset.ttsProvider || '').trim().toLowerCase();
    const sttProvider = (body.dataset.sttProvider || '').trim().toLowerCase();

    const appTitle = displayName || agentName || 'WebChat';
    if (titleBar) {
        titleBar.textContent = appTitle;
    }
    document.title = `${appTitle} · WebChat`;
    if (avatarInitial) {
        const initial = appTitle.trim().charAt(0) || 'P';
        avatarInitial.textContent = initial.toUpperCase();
    }

    function showBanner(text, cls) {
        if (!banner || !bannerText) {
            return;
        }
        banner.className = 'wa-connection-banner show';
        if (cls === 'ok') {
            banner.classList.add('success');
        } else if (cls === 'err') {
            banner.classList.add('error');
        }
        bannerText.textContent = text;
    }

    function hideBanner() {
        if (!banner) {
            return;
        }
        banner.classList.remove('show');
    }

    function getTheme() {
        try {
            return localStorage.getItem('webchat_theme') || 'light';
        } catch (_) {
            return 'light';
        }
    }

    function setTheme(theme) {
        try {
            document.body.setAttribute('data-theme', theme);
            localStorage.setItem('webchat_theme', theme);
        } catch (_) {
            document.body.setAttribute('data-theme', theme);
        }
    }

    if (themeToggle) {
        themeToggle.onclick = () => {
            const next = getTheme() === 'dark' ? 'light' : 'dark';
            setTheme(next);
        };
    }
    setTheme(getTheme());

    let viewMoreLineLimit = readInitialViewMoreLimit();
    let viewMoreChangeHandler = null;

    function emitViewMoreChange() {
        if (typeof viewMoreChangeHandler === 'function') {
            viewMoreChangeHandler(viewMoreLineLimit);
        }
    }

    if (viewMoreLinesInput) {
        const normalizeLineLimit = () => {
            const parsed = parseInt(viewMoreLinesInput.value, 10);
            viewMoreLineLimit = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
            viewMoreLinesInput.value = String(viewMoreLineLimit);
            try {
                localStorage.setItem(VIEW_MORE_LINES_KEY, String(viewMoreLineLimit));
            } catch (_) {
                // Ignore storage failures
            }
            emitViewMoreChange();
        };
        viewMoreLinesInput.value = String(viewMoreLineLimit);
        viewMoreLinesInput.addEventListener('change', normalizeLineLimit);
        viewMoreLinesInput.addEventListener('blur', normalizeLineLimit);
    }

    function setViewMoreChangeHandler(handler) {
        viewMoreChangeHandler = typeof handler === 'function' ? handler : null;
        emitViewMoreChange();
    }

    const toEndpoint = (path) => {
        const suffix = String(path || '').replace(/^\/+/, '');
        return basePath ? `${basePath}/${suffix}` : `/${suffix}`;
    };

    return {
        TAB_ID,
        dlog,
        markdown,
        requiresAuth,
        basePath,
        agentName,
        displayName: appTitle,
        ttsProvider,
        sttProvider,
        toEndpoint,
        showBanner,
        hideBanner,
        getViewMoreLineLimit: () => viewMoreLineLimit,
        setViewMoreChangeHandler,
        elements: {
            body,
            titleBar,
            avatarInitial,
            statusEl,
            statusDot,
            themeToggle,
            banner,
            bannerText,
            chatList,
            typingIndicator,
            cmdInput,
            sendBtn,
            chatContainer,
            chatArea,
            sidePanel,
            sidePanelContent,
            sidePanelClose,
            sidePanelTitle,
            sidePanelResizer,
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
            viewMoreLinesInput,
            attachmentBtn,
            attachmentMenu,
            uploadFileBtn,
            cameraActionBtn,
            fileUploadInput,
            filePreviewContainer,
            attachmentContainer
        }
    };
}
