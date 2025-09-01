export class ExternalSourcesSettingsPage {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.sources = [];
        this.invalidate();
    }

    async beforeRender() {
        // Load sources (new format) or fallback to legacy array of URLs
        const storedSources = await window.LocalStorage.get('externalPostSources');
        const legacyUrls = await window.LocalStorage.get('externalPostsUrls');
        if (Array.isArray(storedSources)) {
            this.sources = storedSources.filter(s => s && s.url).map(s => ({ url: s.url, tag: s.tag || this.deriveTag(s.url) }));
        } else if (Array.isArray(legacyUrls)) {
            this.sources = legacyUrls.map(u => ({ url: u, tag: this.deriveTag(u) }));
        } else {
            this.sources = [];
        }
        // Persist normalized structure
        await window.LocalStorage.set('externalPostSources', this.sources);
    }

    afterRender() {
        this.renderUrlList();
        this.setupEventListeners();
    }

    renderUrlList() {
        const urlList = this.element.querySelector('#url-list');
        if (!urlList) return;

        urlList.innerHTML = '';

        if (this.sources.length === 0) {
            urlList.innerHTML = '<div class="empty-state">No external sources configured yet</div>';
            return;
        }

        this.sources.forEach((src, index) => {
            const urlItem = document.createElement('div');
            urlItem.className = 'url-item';
            urlItem.innerHTML = `
                <span class="url-text">${src.url}</span>
                <input class="tag-input" data-index="${index}" type="text" value="${this.escapeHtml(src.tag)}" placeholder="#hashtag" />
                <button class="remove-button" data-index="${index}">Remove</button>
            `;
            urlList.appendChild(urlItem);
        });

        // Add remove button listeners
        urlList.querySelectorAll('.remove-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.removeSource(index);
            });
        });

        // Save tag edits on blur
        urlList.querySelectorAll('.tag-input').forEach(input => {
            input.addEventListener('blur', async (e) => {
                const idx = parseInt(e.target.dataset.index);
                const val = (e.target.value || '').trim();
                this.sources[idx].tag = this.normalizeTag(val) || this.deriveTag(this.sources[idx].url);
                await window.LocalStorage.set('externalPostSources', this.sources);
                this.renderUrlList();
            });
        });
    }

    setupEventListeners() {
        const backButton = this.element.querySelector('#back-button');
        if (backButton) {
            backButton.addEventListener('click', () => {
                window.webSkel.changeToDynamicPage('news-feed-page', 'app');
            });
        }

        const addButton = this.element.querySelector('#add-url-button');
        if (addButton) {
            addButton.addEventListener('click', async () => {
                try {
                    const res = await window.webSkel.showModal('add-external-source-modal', {}, true);
                    const data = res && res.data;
                    if (!data) return;
                    const { url, tag } = data;
                    if (!url) return;
                    if (this.sources.find(s => s.url === url)) {
                        alert('This URL is already in the list');
                        return;
                    }
                    this.sources.push({ url, tag: this.normalizeTag(tag) || this.deriveTag(url) });
                    await window.LocalStorage.set('externalPostSources', this.sources);
                    this.renderUrlList();
                } catch (e) {
                    console.error('Add external source modal error:', e);
                }
            });
        }
    }

    async addSource(url, tag) {
        url = url.trim();
        
        if (!url) {
            alert('Please enter a valid URL');
            return;
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch (e) {
            alert('Please enter a valid URL');
            return;
        }

        // Check if URL already exists
        if (this.sources.find(s => s.url === url)) {
            alert('This URL is already in the list');
            return;
        }

        const tagNorm = this.normalizeTag(tag) || this.deriveTag(url);
        this.sources.push({ url, tag: tagNorm });
        await window.LocalStorage.set('externalPostSources', this.sources);
        
        // Clear input and re-render
        const urlInput = this.element.querySelector('#new-url-input');
        if (urlInput) urlInput.value = '';
        const tagInput = this.element.querySelector('#new-tag-input');
        if (tagInput) tagInput.value = '';
        
        this.renderUrlList();
    }

    async removeSource(index) {
        this.sources.splice(index, 1);
        await window.LocalStorage.set('externalPostSources', this.sources);
        this.renderUrlList();
    }

    deriveTag(url) {
        try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean);
            const i = parts.indexOf('sources');
            if (i !== -1 && parts[i + 1]) return this.normalizeTag(parts[i + 1]);
            const host = u.hostname.replace(/^www\./, '');
            return this.normalizeTag(host.split('.')[0]);
        } catch { return 'external'; }
    }

    normalizeTag(s) {
        if (!s) return '';
        return String(s).trim().replace(/^#/, '').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24);
    }

    escapeHtml(str) {
        return String(str || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
}
