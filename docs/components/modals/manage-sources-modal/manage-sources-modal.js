export class ManageSourcesModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.sources = [];
        this.defaultSources = [];
        this.hasChanges = false;
        this.invalidate();
    }

    async beforeRender() {
        // Load sources from centralized service
        this.sources = await window.SourcesManager.getAllSources();
    }

    afterRender() {
        this.renderSourcesTable();
        this.setupEventListeners();
        this.updateToggleSelectLabel();
    }

    renderSourcesTable() {
        const listContainer = this.element.querySelector('#sources-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        // Apply filters
        const filterText = (this.element.querySelector('#filter-text')?.value || '').trim().toLowerCase();
        const onlyVisible = !!this.element.querySelector('#only-visible')?.checked;

        const matches = (s) => {
            if (!filterText) return true;
            const tag = (s.tag || '').toLowerCase();
            const url = (s.url || '').toLowerCase();
            return tag.includes(filterText) || url.includes(filterText);
        };

        this.sources.forEach((source, index) => {
            if (onlyVisible && !source.visible) return;
            if (!matches(source)) return;
            const item = document.createElement('div');
            item.className = 'source-item';
            item.innerHTML = `
                <input type="checkbox" class="visibility-checkbox" 
                       data-index="${index}" 
                       ${source.visible ? 'checked' : ''}>
                <div class="source-info">
                    <div class="source-hashtag">${this.escapeHtml(source.tag || 'unnamed')}</div>
                    <div class="source-url">${this.escapeHtml(source.url || '')}</div>
                </div>
                <button class="delete-button" 
                        data-index="${index}" 
                        ${!source.removable ? 'disabled' : ''}>
                    Delete
                </button>
            `;
            listContainer.appendChild(item);
        });

        // Add event listeners for checkboxes only (no inline editing)
        listContainer.querySelectorAll('.visibility-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.sources[index].visible = e.target.checked;
                this.hasChanges = true;
                this.updateToggleSelectLabel();
            });
        });

        // Add event listeners for delete buttons
        listContainer.querySelectorAll('.delete-button').forEach(button => {
            if (!button.disabled) {
                button.addEventListener('click', async (e) => {
                    const index = parseInt(e.target.dataset.index);
                    const src = this.sources[index];
                    if (!src) return;
                    if (confirm(`Delete source "${src.tag}"?`)) {
                        try {
                            await window.SourcesManager.removeSource(src.id || src.url);
                            this.sources = await window.SourcesManager.getAllSources();
                            this.renderSourcesTable();
                            this.updateToggleSelectLabel();
                        } catch (_) {
                            alert('Could not delete source.');
                        }
                    }
                });
            }
        });

        // Update the toggle button state after rendering
        this.updateToggleSelectLabel();
    }

    setupEventListeners() {
        const closeButton = this.element.querySelector('.close-button');
        const cancelButton = this.element.querySelector('#cancel-button');
        const saveButton = this.element.querySelector('#save-button');
        const addButton = this.element.querySelector('#add-source-button');
        const filterInput = this.element.querySelector('#filter-text');
        const onlyVisibleToggle = this.element.querySelector('#only-visible');
        const toggleSelectButton = this.element.querySelector('#toggle-select-button');

        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.close(false);
            });
        }

        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                this.close(false);
            });
        }

        if (saveButton) {
            saveButton.addEventListener('click', async () => {
                await this.saveChanges();
                this.close(true);
            });
        }

        if (addButton) {
            addButton.addEventListener('click', () => {
                this.addNewSource();
            });
        }
        // Auto-fill tag on URL blur if tag empty
        const urlInput = this.element.querySelector('#new-source-url');
        const tagInput = this.element.querySelector('#new-source-tag');
        if (urlInput && tagInput) {
            urlInput.addEventListener('blur', () => {
                if (!tagInput.value.trim() && urlInput.value.trim()) {
                    const auto = this.deriveTag(urlInput.value.trim());
                    tagInput.value = this.normalizeTag(auto || 'external');
                }
            });
        }
        if (filterInput) {
            filterInput.addEventListener('input', () => { this.renderSourcesTable(); this.updateToggleSelectLabel(); });
        }
        if (onlyVisibleToggle) {
            onlyVisibleToggle.addEventListener('change', () => { this.renderSourcesTable(); this.updateToggleSelectLabel(); });
        }
        if (toggleSelectButton) {
            toggleSelectButton.addEventListener('click', () => {
                const boxes = Array.from(this.element.querySelectorAll('.visibility-checkbox'));
                const total = boxes.length;
                const checked = boxes.filter(cb => cb.checked).length;
                const shouldSelect = !(total > 0 && checked === total);
                boxes.forEach(cb => {
                    cb.checked = shouldSelect;
                    const index = parseInt(cb.dataset.index);
                    if (this.sources[index]) {
                        this.sources[index].visible = shouldSelect;
                    }
                });
                this.hasChanges = true;
                this.updateToggleSelectLabel();
            });
        }
    }

    async addNewSource() {
        const tagInput = this.element.querySelector('#new-source-tag');
        const urlInput = this.element.querySelector('#new-source-url');

        let tag = this.normalizeTag(tagInput.value);
        const url = urlInput.value.trim();

        if (!url) {
            alert('Please provide a URL for the source');
            return;
        }

        // Auto-derive tag if empty
        if (!tag) {
            tag = this.deriveTag(url) || 'external';
        }

        // Check if URL already exists
        if (this.sources.find(s => s.url === url)) {
            alert('A source with this URL already exists');
            return;
        }

        // Validate URL format
        if (!this.isValidUrl(url)) {
            alert('Please enter a valid URL (absolute or relative path)');
            return;
        }

        // Add through service for consistency
        const newSource = {
            url: url,
            tag: tag,
            type: 'external',
            removable: true,
            visible: true
        };
        
        // Persist immediately via service and refresh list
        try {
            await window.SourcesManager.addSource(newSource);
            this.sources = await window.SourcesManager.getAllSources();
        } catch (_) {
            alert('Could not add source.');
            return;
        }

        // Clear inputs
        tagInput.value = '';
        urlInput.value = '';

        this.hasChanges = true;
        this.renderSourcesTable();
        this.updateToggleSelectLabel();
    }

    async saveChanges() {
        // Update visibility in sources
        this.sources.forEach(source => {
            // Ensure visibility is boolean
            source.visible = !!source.visible;
        });
        
        // Save through centralized service
        await window.SourcesManager.updateAllSources(this.sources);
    }

    close(saved) {
        const modal = this.element.closest("dialog");
        if (modal) {
            // Set data for the close event
            modal.savedData = {
                saved: saved,
                sources: saved ? this.sources : null
            };
            
            // Dispatch close event with data
            const event = new CustomEvent('close', {
                bubbles: true,
                detail: modal.savedData
            });
            event.data = modal.savedData;
            
            modal.dispatchEvent(event);
            modal.close();
            modal.remove();
        }
    }

    updateToggleSelectLabel() {
        try {
            const btn = this.element.querySelector('#toggle-select-button');
            if (!btn) return;
            const boxes = Array.from(this.element.querySelectorAll('.visibility-checkbox'));
            const total = boxes.length;
            const checked = boxes.filter(cb => cb.checked).length;
            btn.textContent = (total > 0 && checked === total) ? 'Deselect All' : 'Select All';
        } catch (_) {}
    }

    isValidUrl(url) {
        // Check if it's a relative path
        if (url.startsWith('/')) {
            return true;
        }
        
        // Check if it's an absolute URL
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    deriveTag(url) {
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


    normalizeTag(s) {
        return window.SourcesManager.normalizeTag(s);
    }

    escapeHtml(str) {
        return String(str || '').replace(/[&<>"]/g, c => ({ 
            '&': '&amp;', 
            '<': '&lt;', 
            '>': '&gt;', 
            '"': '&quot;' 
        }[c]));
    }
}
