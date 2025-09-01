/**
 * Centralized service for managing news sources
 * Ensures consistency between all components
 */
class SourcesManager {
    constructor() {
        this.sources = [];
        this.initialized = false;
    }

    /**
     * Initialize sources from default configuration and localStorage
     */
    async initialize() {
        if (this.initialized) return this.sources;

        // Load saved sources first; if present, skip fetching defaults to avoid blocking
        const savedSources = await window.LocalStorage.get('allNewsSources');
        let defaultSources = [];

        // Always fetch defaults (do not rely on cached config)
            try {
                const resp = await fetch('./default_sources.json', { cache: 'no-store' });
                if (resp.ok) {
                    const cfg = await resp.json();
                    defaultSources = cfg.sources || [];
                    await window.LocalStorage.set('defaultSourcesConfig', cfg);
                }
            } catch (error) {
                console.warn('Default sources config unavailable, using minimal fallback:', error);
                defaultSources = [
                    { id: 'smallChildren', type: 'category', url: '/sources/smallChildren/games.json', tag: 'smallChildren', removable: false, visible: true },
                    { id: 'schoolChildren', type: 'category', url: '/sources/schoolChildren/games.json', tag: 'schoolChildren', removable: false, visible: true },
                    { id: 'allAges', type: 'category', url: '/sources/allAges/games.json', tag: '@allAges', removable: false, visible: true },
                    { id: 'girls', type: 'category', url: '/sources/girls/games.json', tag: 'girls', removable: false, visible: true },
                    { id: 'boys', type: 'category', url: '/sources/boys/games.json', tag: 'boys', removable: false, visible: true },
                    { id: 'microStrategy', type: 'category', url: '/sources/microStrategy/games.json', tag: 'microStrategy', removable: false, visible: true }
                ];
            }
            if (savedSources && Array.isArray(savedSources) && savedSources.length > 0) {
                this.sources = this.mergeSourcesWithDefaults(savedSources, defaultSources);
            } else {
                this.sources = [...defaultSources];
            }

        // Load and apply visibility settings
        const visibleSourcesInCard = await window.LocalStorage.get('visibleSourcesInCard');
        if (visibleSourcesInCard && Array.isArray(visibleSourcesInCard)) {
            this.sources.forEach(source => {
                const key = source.id || source.url;
                source.visible = visibleSourcesInCard.includes(key);
            });
        } else {
            // Save initial visibility state
            await this.saveVisibility();
        }

        // Filter out non-game category sources (keep externals as-is)
        this.sources = this.sources.filter(s => {
            if (!s || !s.url) return false;
            if (s.type === 'external') return true;
            return /\/sources\/[^/]+\/games\.json$/.test(s.url);
        });

        // Add external sources
        await this.syncExternalSources();
        
        // Save the merged state
        await this.saveSources();
        
        this.initialized = true;
        return this.sources;
    }

    /**
     * Merge saved sources with defaults, ensuring all defaults are present
     */
    mergeSourcesWithDefaults(saved, defaults) {
        const merged = [...saved];
        const existingIds = new Set(saved.map(s => s.id).filter(Boolean));
        
        // Add any missing default sources
        defaults.forEach(defSource => {
            if (defSource.id && !existingIds.has(defSource.id)) {
                merged.push(defSource);
            }
        });
        
        return merged;
    }

    /**
     * Sync external sources from legacy storage
     */
    async syncExternalSources() {
        const externalSources = await window.LocalStorage.get('externalPostSources') || [];
        const existingUrls = new Set(this.sources.map(s => s.url).filter(Boolean));
        
        externalSources.forEach(ext => {
            if (ext && ext.url && !existingUrls.has(ext.url)) {
                this.sources.push({
                    id: `external-${Date.now()}-${Math.random()}`,
                    url: ext.url,
                    tag: ext.tag || this.deriveTag(ext.url),
                    type: 'external',
                    removable: true,
                    visible: false
                });
            }
        });
    }

    /**
     * Get all sources
     */
    async getAllSources() {
        if (!this.initialized) {
            await this.initialize();
        }
        return [...this.sources];
    }

    /**
     * Get only visible sources for the selection card
     */
    async getVisibleSources() {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.sources.filter(s => s.visible === true);
    }

    /**
     * Get selected sources (checked in the selection card)
     */
    async getSelectedSources() {
        // Prefer new single-selection model if present
        try {
            const current = await window.LocalStorage.get('currentSelectedSource');
            if (current && typeof current === 'object') {
                if (current.type === 'external' && current.url) {
                    return { categories: [], external: [current.url], all: [current.url] };
                }
                if (current.id) {
                    return { categories: [current.id], external: [], all: [current.id] };
                }
            }
        } catch (_) {}

        // Check if this is first time initialization (legacy multi-select)
        const hasSelectedBefore = await window.LocalStorage.get('hasSelectedSourcesBefore');
        
        let selectedCategories = await window.LocalStorage.get('selectedSourceCategories');
        let selectedExternal = await window.LocalStorage.get('selectedExternalPostsUrls');
        
        // First time - default to microgame sources
        if (!hasSelectedBefore && !selectedCategories && !selectedExternal) {
            selectedCategories = ['smallChildren', 'schoolChildren', 'allAges', 'girls', 'boys', 'microStrategy'];
            selectedExternal = [];
            
            // Save the initial selection
            await window.LocalStorage.set('selectedSourceCategories', selectedCategories);
            await window.LocalStorage.set('selectedExternalPostsUrls', selectedExternal);
            await window.LocalStorage.set('hasSelectedSourcesBefore', true);
        }
        
        // Ensure we have at least default if nothing is selected
        if (!selectedCategories) selectedCategories = ['smallChildren', 'schoolChildren', 'allAges'];
        if (!selectedExternal) selectedExternal = [];
        
        selectedCategories = (selectedCategories || []).filter(c => c && c !== 'default');

        return {
            categories: selectedCategories,
            external: selectedExternal,
            all: [...selectedCategories, ...selectedExternal]
        };
    }

    /**
     * Update source visibility
     */
    async updateVisibility(sourceId, visible) {
        const source = this.sources.find(s => (s.id === sourceId) || (s.url === sourceId));
        if (source) {
            source.visible = !!visible;
            await this.saveVisibility();
            await this.saveSources();
        }
    }

    /**
     * Update all sources (used by manage modal)
     */
    async updateAllSources(updatedSources) {
        this.sources = updatedSources;
        await this.saveSources();
        await this.saveVisibility();
        await this.syncExternalToLegacy();
    }

    /**
     * Add a new source
     */
    async addSource(source) {
        // Check for duplicates
        if (source.url && this.sources.find(s => s.url === source.url)) {
            return false;
        }
        
        // Add ID if missing
        if (!source.id) {
            source.id = `external-${Date.now()}-${Math.random()}`;
        }
        
        // Ensure required fields
        source.type = source.type || 'external';
        source.removable = source.removable !== false;
        source.visible = source.visible !== false;
        source.tag = source.tag || this.deriveTag(source.url);
        
        this.sources.push(source);
        await this.saveSources();
        await this.saveVisibility();
        await this.syncExternalToLegacy();
        
        return true;
    }

    /**
     * Remove a source
     */
    async removeSource(sourceId) {
        const index = this.sources.findIndex(s => 
            (s.id === sourceId) || (s.url === sourceId)
        );
        
        if (index !== -1 && this.sources[index].removable) {
            this.sources.splice(index, 1);
            await this.saveSources();
            await this.saveVisibility();
            await this.syncExternalToLegacy();
            return true;
        }
        
        return false;
    }

    /**
     * Save sources to localStorage
     */
    async saveSources() {
        await window.LocalStorage.set('allNewsSources', this.sources);
    }

    /**
     * Save visibility list
     */
    async saveVisibility() {
        const visibleSources = this.sources
            .filter(s => s.visible === true)
            .map(s => s.id || s.url);
        await window.LocalStorage.set('visibleSourcesInCard', visibleSources);
    }

    /**
     * Sync external sources to legacy storage format
     */
    async syncExternalToLegacy() {
        const externalSources = this.sources
            .filter(s => s.type === 'external')
            .map(s => ({ url: s.url, tag: s.tag }));
        await window.LocalStorage.set('externalPostSources', externalSources);
    }

    /**
     * Save selected sources
     */
    async saveSelectedSources(categories, external) {
        await window.LocalStorage.set('selectedSourceCategories', categories);
        await window.LocalStorage.set('selectedExternalPostsUrls', external);
        // Mark that user has made a selection
        await window.LocalStorage.set('hasSelectedSourcesBefore', true);
    }

    /**
     * Derive tag from URL
     */
    deriveTag(url) {
        if (!url) return 'external';
        
        try {
            if (url.startsWith('/')) {
                // Relative path
                const parts = url.split('/').filter(Boolean);
                const sourcesIndex = parts.indexOf('sources');
                if (sourcesIndex !== -1 && parts[sourcesIndex + 1]) {
                    return this.normalizeTag(parts[sourcesIndex + 1]);
                }
                return 'external';
            } else {
                // Absolute URL
                const u = new URL(url);
                const parts = u.pathname.split('/').filter(Boolean);
                const sourcesIndex = parts.indexOf('sources');
                if (sourcesIndex !== -1 && parts[sourcesIndex + 1]) {
                    return this.normalizeTag(parts[sourcesIndex + 1]);
                }
                const host = u.hostname.replace(/^www\./, '');
                return this.normalizeTag(host.split('.')[0]);
            }
        } catch {
            return 'external';
        }
    }

    /**
     * Normalize tag string
     */
    normalizeTag(s) {
        if (!s) return '';
        return String(s).trim().replace(/^#/, '').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24);
    }

    /**
     * Force reload sources from storage
     */
    async reload() {
        this.initialized = false;
        this.sources = [];
        return await this.initialize();
    }
}

// Export singleton instance
window.SourcesManager = new SourcesManager();
export default window.SourcesManager;
