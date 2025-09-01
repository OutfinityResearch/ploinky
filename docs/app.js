import WebSkel from './WebSkel/webskel.mjs';
import LoadingIndicator from './components/base/loading-indicator/loading-indicator.js';
import './services/ThemeManager.js';

// Global simple timestamped logger
// Shows milliseconds since app start for easier performance tracing
window.__APP_START_TS = window.__APP_START_TS || (typeof performance !== 'undefined' ? performance.now() : Date.now());
// Toggle logs globally. Persist via localStorage and allow URL override.
function getInitialLogsEnabled() {
    try {
        // URL overrides
        const q = new URLSearchParams(location.search);
        if (q.has('debug')) return q.get('debug') !== '0' && q.get('debug') !== 'false';
        if (location.hash && /(^|[#&?])debug(=1|=true)?(?!\w)/i.test(location.hash)) return true;
        // Persisted setting
        const v = localStorage.getItem('debugLogsEnabled');
        if (v === '1' || v === 'true') return true;
        if (v === '0' || v === 'false') return false;
    } catch (_) {}
    return false; // default: off to reduce noise
}
window.__LOGS_ENABLED = typeof window.__LOGS_ENABLED === 'boolean' ? window.__LOGS_ENABLED : getInitialLogsEnabled();
window.setLogsEnabled = function(enabled) {
    try {
        window.__LOGS_ENABLED = !!enabled;
        localStorage.setItem('debugLogsEnabled', window.__LOGS_ENABLED ? '1' : '0');
        // Minimal one-time notice
        const base = window.__APP_START_TS || 0;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const delta = Math.round(now - base);
        console.log(`[${delta}ms] Debug logs ${window.__LOGS_ENABLED ? 'enabled' : 'disabled'}`);
    } catch (_) {}
};
window.toggleLogs = function() { window.setLogsEnabled(!window.__LOGS_ENABLED); };
window.logTS = function(label, payload) {
    try {
        if (!window.__LOGS_ENABLED) return;
        const base = window.__APP_START_TS || 0;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const delta = Math.round(now - base);
        if (payload !== undefined) {
            console.log(`[${delta}ms] ${label}`, payload);
        } else {
            console.log(`[${delta}ms] ${label}`);
        }
    } catch (_) {
        // Fallback minimal log
        try { if (window.__LOGS_ENABLED) console.log(label); } catch (_) {}
    }
};

async function start() {
    // Temporarily mute console.log during WebSkel initialisation if logs are disabled
    let restoreLog = null;
    try {
        if (!window.__LOGS_ENABLED) {
            const originalLog = console.log;
            console.log = function() {};
            restoreLog = () => { console.log = originalLog; };
        }
    } catch (_) {}
    const webSkel = await WebSkel.initialise('webskel.json');
    try { if (restoreLog) restoreLog(); } catch (_) {}
    webSkel.setDomElementForPages(document.querySelector('#app'));
    
    // Remove initial loading spinner
    const initialSpinner = document.querySelector('.initial-spinner');
    if (initialSpinner) {
        setTimeout(() => {
            try { window.logTS('UI: initial spinner fade-out begin'); } catch (_) {}
            initialSpinner.style.opacity = '0';
            initialSpinner.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                try { window.logTS('UI: initial spinner removed'); } catch (_) {}
                initialSpinner.close();
                initialSpinner.remove();
            }, 300);
        }, 100);
    }

    // Load core services
    await import('./services/LocalStorage.js');
    await import('./services/SourcesManager.js');

    // Make LoadingIndicator globally available
    window.LoadingIndicator = LoadingIndicator;
    // Apply saved content scale (font size) early
    try {
        const savedScale = await window.LocalStorage.get('contentScale');
        const scale = typeof savedScale === 'number' ? savedScale : 1.0;
        document.documentElement.style.setProperty('--content-scale', String(scale));
    } catch (e) {
        document.documentElement.style.setProperty('--content-scale', '1');
    }

    // Store webSkel globally first
    window.webSkel = webSkel;

    // Create hamburger menu element inside mobile container to simulate phone overlay
    const hamburgerMenu = document.createElement('hamburger-menu');
    hamburgerMenu.setAttribute('data-presenter', 'hamburger-menu');
    const mobileContainer = document.querySelector('.mobile-container');
    if (mobileContainer) {
        mobileContainer.prepend(hamburgerMenu);
    } else {
        document.body.prepend(hamburgerMenu);
    }
    
    // Initialize hamburger menu functionality after a delay
    setTimeout(() => {
        const hamburgerButton = document.querySelector('#hamburger-button');
        const menu = document.querySelector('hamburger-menu');
        const refreshButton = document.querySelector('#refresh-button');
        
        if (hamburgerButton && menu) {
            hamburgerButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Simple toggle using the presenter if available
                if (menu.webSkelPresenter && menu.webSkelPresenter.toggle) {
                    menu.webSkelPresenter.toggle();
                } else {
                    // Fallback: toggle a class
                    menu.classList.toggle('open');
                }
            });
        }

        if (refreshButton) {
            refreshButton.addEventListener('click', async (e) => {
                e.preventDefault();
                // Optional visual feedback
                refreshButton.classList.add('spinning');
                try {
                    // Re-render the feed page to force a fresh fetch
                    await window.webSkel.changeToDynamicPage('news-feed-page', 'app');
                } finally {
                    refreshButton.classList.remove('spinning');
                }
            });
        }
    }, 500);

    await webSkel.changeToDynamicPage('news-feed-page', 'app');
}

start();
