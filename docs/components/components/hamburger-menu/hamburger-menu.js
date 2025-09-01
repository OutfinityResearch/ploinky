export class HamburgerMenu {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.isOpen = false;
        this.setupCloseOnClick();
        this.invalidate();
    }

    beforeRender() {
        // The class needs to be applied after render
    }

    afterRender() {
        if (this.isOpen) {
            this.element.classList.add('open');
        } else {
            this.element.classList.remove('open');
        }

        // Set up click handlers for menu items
        const links = this.element.querySelectorAll('[data-local-action]');
        links.forEach(link => {
            link.removeEventListener('click', this.handleLinkClick);
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const action = link.getAttribute('data-local-action');
                if (this[action]) {
                    this[action]();
                }
            });
        });

        // Update theme label text
        try {
            const label = this.element.querySelector('.theme-label');
            if (label && window.ThemeManager) {
                const theme = window.ThemeManager.theme;
                label.textContent = theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
            }
        } catch (_) {}
    }

    setupCloseOnClick() {
        // Close menu when clicking outside
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.toggle();
            }
        });
    }

    toggle() {
        this.isOpen = !this.isOpen;
        // Direct DOM manipulation for immediate feedback
        if (this.isOpen) {
            this.element.classList.add('open');
        } else {
            this.element.classList.remove('open');
        }
        this.invalidate();
    }

    async navigateToHome() {
        await window.webSkel.changeToDynamicPage("news-feed-page", "app");
        this.toggle();
    }

    async navigateToSettings() {
        await window.webSkel.changeToDynamicPage("settings-page", "app");
        this.toggle();
    }
    
    async navigateToFavorites() {
        await window.webSkel.changeToDynamicPage("favorites-page", "app");
        this.toggle();
    }

    toggleTheme() {
        try {
            if (window.ThemeManager) {
                window.ThemeManager.toggleTheme();
            } else if (window.ThemeManager === undefined && window.ThemeManager?.toggleTheme) {
                // no-op fallback
            }
        } catch (_) {}
        // Refresh label
        this.invalidate();
    }
}
