export class StoryCard {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.currentSlide = 0;
        this.slides = [];
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.touchStartTarget = null;
        this.autoPlayTimeout = null;
        this.autoPlayDuration = 5000;
        this.autoplayEnabled = false; // Only enable after user swipe-left on essence
        this.invalidate();
    }

    beforeRender() {
        // Support new 'game' prop, with fallback to legacy 'post'
        this.post = this.element.game || this.element.post;
        this.storyIndex = this.element.storyIndex || 0;
        this.totalStories = this.element.totalStories || 1;
    }

    afterRender() {
        if (!this.post) return;

        this.applyDynamicGradient();
        this.populateContent();
        // Selection card: ensure selector is rendered before sizing
        if (this.post?.isSelectionCard) {
            // Mark as selection early so CSS can hide header/essence immediately
            try {
                const root = this.element.querySelector('.story-card');
                if (root) root.classList.add('selection-mode');
            } catch (_) {}
            this.element.classList.add('selection-card');
            // Render sources selector first, then size to fit
            try {
                Promise.resolve()
                    .then(() => this.setupDataSourcesSelector())
                    .then(() => new Promise(requestAnimationFrame))
                    .then(() => this.adjustSelectionCardHeight())
                    .catch(() => this.adjustSelectionCardHeight());
            } catch (_) { this.adjustSelectionCardHeight(); }
            if (!this._onResizeSel) {
                this._onResizeSel = () => this.adjustSelectionCardHeight();
                window.addEventListener('resize', this._onResizeSel);
            }
        }
        
        const isMicro = this.post?.type === 'microgame';
        // Build text slides: only essence on first slide + reactions from config
        // Do not auto-split essence or add extra 'About' slide
        this.createReactionSlides();
        // Inline play button in header
        if (isMicro) {
            try {
                const playBtn = this.element.querySelector('.play-inline-btn');
                if (playBtn) {
                    playBtn.style.display = 'inline-flex';
                    playBtn.onclick = () => this.openGameModal();
                }
            } catch (_) {}
        }
        this.linkTitlesToSource();
        this.initializeSlides();
        this.setupSwipeGestures();
        this.setupIndicators();
        this.setupProgressBars();
        this.applyStoredViewProgress();
        // Do not start carousel here; the page will start it when the card becomes active

        // Setup favorite toggle (skip for selection card)
        try {
            if (!this.post.isSelectionCard && !(typeof this.post.id === 'string' && this.post.id.startsWith('tutorial-'))) {
                this.setupFavoriteToggle();
            }
        } catch (_) {}

        // Recompute height on resize when active
        this._onResize = () => { this.computeAndSetMaxHeight(); };
        window.addEventListener('resize', this._onResize);
        // Precompute stable height for all non-selection cards to prevent flicker
        if (!this.post?.isSelectionCard) { this.computeAndSetMaxHeight(); }

        try {
            window.logTS('SC: rendered', {
                index: this.storyIndex,
                id: this.post?.id,
                title: (this.post?.title || '').slice(0, 80),
                slides: this.slides?.length || 0
            });
        } catch (_) { /* ignore */ }
    }

    async setupFavoriteToggle() {
        const btn = this.element.querySelector('.favorite-btn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        const id = this.post?.id;
        if (!id) return;
        try {
            const favIds = await window.LocalStorage.get('favoritePostIds') || [];
            const isFav = favIds.includes(id);
            this.applyFavoriteUi(btn, icon, isFav);
        } catch (_) {}

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                let favIds = await window.LocalStorage.get('favoritePostIds') || [];
                let favMap = await window.LocalStorage.get('favoritePostsById') || {};
                const idx = favIds.indexOf(id);
                let isFav;
                if (idx >= 0) {
                    // remove
                    favIds.splice(idx, 1);
                    if (favMap && favMap[id]) delete favMap[id];
                    isFav = false;
                } else {
                    // add to front
                    favIds.unshift(id);
                    favMap[id] = this.post;
                    isFav = true;
                }
                await window.LocalStorage.set('favoritePostIds', favIds);
                await window.LocalStorage.set('favoritePostsById', favMap);
                this.applyFavoriteUi(btn, icon, isFav);
                // If we are inside the Favorites page and unfavorite, remove the card from view
                if (!isFav) {
                    const favList = this.element.closest('.favorites-list');
                    if (favList) {
                        // Remove host <story-card>
                        const host = this.element.closest('story-card');
                        if (host && host.parentNode) host.parentNode.removeChild(host);
                        // Show empty message if list becomes empty
                        const remaining = favList.querySelector('story-card');
                        if (!remaining) {
                            const empty = document.querySelector('.favorites-empty');
                            if (empty) empty.hidden = false;
                        }
                    }
                }
            } catch (err) {
                console.error('Favorite toggle failed', err);
            }
        });
    }

    applyFavoriteUi(btn, icon, isFav) {
        try {
            if (!btn || !icon) return;
            if (isFav) {
                btn.classList.add('favorited');
                icon.classList.remove('far');
                icon.classList.add('fas');
            } else {
                btn.classList.remove('favorited');
                icon.classList.remove('fas');
                icon.classList.add('far');
            }
        } catch (_) {}
    }

    adjustSelectionCardHeight() {
        try {
            const host = this.element; // <story-card>
            const root = this.element.querySelector('.story-card');
            const content = this.element.querySelector('.card-slide[data-id="main"] .card-content');
            if (!host || !root || !content) return;
            // Selection card should size naturally like a normal card
            // Remove any forced sizing from previous runs
            host.style.aspectRatio = 'auto';
            host.style.removeProperty('height');
            // Ensure inner root uses natural height
            root.classList.add('selection-mode');
            root.style.height = 'auto';
            const body = this.element.querySelector('.card-slide[data-id="main"] .card-body');
            if (body) {
                body.style.overflowY = 'visible';
                body.style.maxHeight = 'unset';
                body.style.minHeight = 'auto';
            }
        } catch (_) { }
    }

    computeSelectionExtraSpace() {
        try {
            const list = this.element.querySelector('.sources-list');
            if (!list) return 0;
            const items = list.querySelectorAll('.source-item');
            const total = items.length;
            if (total === 0) return 0;
            const cols = 2;
            const rows = Math.max(1, Math.ceil(total / cols));
            const first = list.querySelector('.source-item');
            const itemH = first ? Math.max(22, Math.round(first.getBoundingClientRect().height)) : 28;
            // Provide generous extra space scaling with number of rows
            const perRow = Math.round(itemH * 0.9) + 12; // ~90% item height + 12px
            const base = 24; // minimal footer space
            const extra = base + rows * perRow;
            return Math.min(extra, 600); // cap to avoid extreme oversizing
        } catch (_) {
            return 120;
        }
    }

    getFooterReserve() {
        try {
            const resume = this.element.querySelector('.resume-progress');
            const sponsor = this.element.querySelector('.sponsor-inline');
            const indicators = this.element.querySelector('.slide-indicators');
            const rh = resume ? resume.offsetHeight : 0;
            const sh = sponsor ? sponsor.offsetHeight : 0;
            const ih = indicators ? indicators.offsetHeight : 0;
            // base spacing + measured controls — keep this minimal
            const margin = 8; // small breathing room
            const reserve = rh + sh + ih + margin;
            // minimal reserve to avoid clipping overlays
            return Math.max(12, reserve);
        } catch (_) {
            return 16;
        }
    }

    applyDynamicGradient() {
        const totalGradients = 30;
        const id = (this.post && this.post.id) ? String(this.post.id) : String(this.storyIndex);

        // Target the inner visual root for styling
        const root = this.element.querySelector('.story-card');
        if (!root) return;

        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) - hash) + id.charCodeAt(i);
        }

        // Get the last used gradients from global storage (avoid adjacent duplicates)
        window.lastUsedGradients = window.lastUsedGradients || [];

        // Calculate base gradient number from hash
        let gradientNumber = (Math.abs(hash) % totalGradients) + 1;

        // Ensure this gradient is different from the last few used
        const recentGradients = window.lastUsedGradients.slice(-3); // Check last 3 gradients
        let attempts = 0;
        const maxAttempts = 10;

        while (recentGradients.includes(gradientNumber) && attempts < maxAttempts) {
            // Try a different gradient
            gradientNumber = ((gradientNumber + Math.floor(Math.random() * 5) + 1) % totalGradients) + 1;
            attempts++;
        }

        // Store this gradient in history (cap size to keep memory tiny)
        window.lastUsedGradients.push(gradientNumber);
        if (window.lastUsedGradients.length > 5) {
            window.lastUsedGradients.shift();
        }

        // Apply attributes on the inner root so CSS matches
        root.setAttribute('data-bg', `gradient-${gradientNumber}`);

        // Additionally: choose a solid color variant and avoid adjacent repeats
        const totalColors = 12;
        window.lastUsedColors = window.lastUsedColors || [];
        let colorNumber = (Math.abs(hash >> 2) % totalColors) + 1;
        const recentColors = window.lastUsedColors.slice(-3);
        let colorAttempts = 0;
        while (recentColors.includes(colorNumber) && colorAttempts < 10) {
            colorNumber = ((colorNumber + Math.floor(Math.random() * 4) + 1) % totalColors) + 1;
            colorAttempts++;
        }
        window.lastUsedColors.push(colorNumber);
        if (window.lastUsedColors.length > 5) window.lastUsedColors.shift();
        root.setAttribute('data-color', `color-${colorNumber}`);

        // Subtle pattern variety
        // Visual flair: choose between texture (dots/lines) or gloss
        const variant = Math.abs(hash) % 3; // 0: gloss, 1: dots, 2: lines
        root.removeAttribute('data-pattern');
        if (variant === 0) {
            root.setAttribute('data-effect', 'gloss');
        } else {
            root.setAttribute('data-effect', 'texture');
            root.setAttribute('data-pattern', variant === 1 ? 'dots' : 'lines');
        }
    }

    populateContent() {
        // Populate logo, title, and subtitle (sanitized)
        const cleanTitle = this.sanitizeTitle(this.post.title);
        const logo = this.getGameLogo();
        try {
            const logoEl = this.element.querySelector('.game-logo');
            if (logoEl) {
                if (this.post?.type === 'microgame' && logo) {
                    logoEl.textContent = logo;
                    logoEl.style.visibility = 'visible';
                } else {
                    logoEl.textContent = '';
                    logoEl.style.visibility = 'hidden';
                }
            }
        } catch (_) {}
        const titleElements = this.element.querySelectorAll('.card-title');
        titleElements.forEach(el => {
            if (!el) return;
            // Title no longer includes emoji; emoji is shown separately as logo
            el.textContent = cleanTitle;
        });

        // For first card, show welcome message instead of essence
        const essenceElement = this.element.querySelector('.card-essence');
        if (this.post?.isSelectionCard) {
            if (essenceElement) {
                essenceElement.textContent = 'Welcome to Ploynky! Pick your microgame categories below:';
            }
            // Update the title for first card
            const titleElements = this.element.querySelectorAll('.card-title');
            titleElements.forEach(el => {
                if (el) el.textContent = 'Select Microgame Sources';
            });
            // Hide badge and time on the main slide for the first card
            const mainHeader = this.element.querySelector('.card-slide[data-id="main"] .card-header');
            if (mainHeader) {
                const badge = mainHeader.querySelector('.card-badge');
                const time = mainHeader.querySelector('.card-time');
                if (badge) badge.style.display = 'none';
                if (time) time.style.display = 'none';
            }
        } else {
            // Populate main slide essence for other cards (no reactions mirrored here)
            if (essenceElement) essenceElement.textContent = this.post.essence;
        }

        // Compute and set subtitle (hashtag [+ time])
        if (!this.post?.isSelectionCard) {
            let tag = this.post?.tag || null;
            if (tag) {
                if (!(tag.startsWith('#') || tag.startsWith('@'))) tag = `#${tag}`;
            }
            const hash = tag || (this.extractDomain(this.post.source) || 'Ploynky');
            const timeText = (this.post?.type !== 'microgame') ? this.formatTimeAgo(this.post.publishedAt || this.post.generatedAt) : '';
            const subtitle = this.element.querySelector('.card-slide[data-id="main"] .card-subtitle');
            if (subtitle) subtitle.textContent = timeText ? `${hash} · ${timeText}` : `${hash}`;
        }

        // Populate source slide
        const sourceLink = this.element.querySelector('.source-link');
        if (sourceLink) sourceLink.href = this.post.source;

        // Populate sponsor if exists
        if (this.post.promoBanner) {
            const sponsorSection = this.element.querySelector('.sponsor-section');
            if (sponsorSection) {
                sponsorSection.innerHTML = '';
                sponsorSection.style.display = 'none';
            }
            // Also show a compact inline sponsor note above the resume bar (visible on all slides)
            const sponsorInline = this.element.querySelector('.sponsor-inline');
            if (sponsorInline) {
                sponsorInline.innerHTML = `
                    <a href="${this.post.promoBanner.url}" target="_blank" rel="noopener noreferrer">
                        <i class="fas fa-ad"></i>
                        <span>${this.post.promoBanner.text}</span>
                    </a>
                `;
            }
        } else {
            // Hide inline sponsor if none
            const sponsorInline = this.element.querySelector('.sponsor-inline');
            if (sponsorInline) sponsorInline.style.display = 'none';
        }
    }

    getGameLogo() {
        try {
            if (!this.post || this.post.isSelectionCard) return '';
            if (this.post.logo && typeof this.post.logo === 'string') return this.post.logo;
            const tag = (this.post.tag || '').toLowerCase();
            const title = (this.post.title || '').toLowerCase();
            const map = {
                smallchildren: '🎈',
                schoolchildren: '🧠',
                allages: '🕹️',
                anybody: '🕹️',
                girls: '🌸',
                boys: '🚀',
                microstrategy: '♟️',
                learnenglish: '🗣️',
                learnspanish: '🗣️',
                learnitalian: '🗣️'
            };
            if (map[tag]) return map[tag];
            // Fallback heuristics by title
            if (/balloon|tap|pop/.test(title)) return '🎈';
            if (/color|dress|palette/.test(title)) return '🎨';
            if (/math|sprint|quiz/.test(title)) return '➕';
            if (/memory|match/.test(title)) return '🧠';
            if (/reaction|timer/.test(title)) return '⏱️';
            if (/flappy|dot|fly|rocket/.test(title)) return '🚀';
            if (/goal|kick|soccer/.test(title)) return '⚽';
            if (/lights out|tic|toe|strategy|puzzle/.test(title)) return '♟️';
            return '🎮';
        } catch (_) { return ''; }
    }

    linkTitlesToSource() {
        try {
            if (this.post?.isSelectionCard) return; // selection card has no external source link
            if (this.post?.type === 'microgame') return; // play inside card, don't link title
            const url = this.post?.source;
            if (!url) return;
            const cleanTitle = this.sanitizeTitle(this.post.title);
            const titles = this.element.querySelectorAll('.card-title');
            titles.forEach(h => {
                if (!h) return;
                const existing = h.querySelector('a');
                if (existing) {
                    existing.href = url;
                    existing.textContent = cleanTitle;
                    existing.target = '_blank';
                    existing.rel = 'noopener noreferrer';
                } else {
                    h.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer">${cleanTitle}</a>`;
                }
            });
        } catch (_) { /* ignore */ }
    }

    createReactionSlides() {
        if (!this.post.reactions || !Array.isArray(this.post.reactions)) return;

        const container = this.element.querySelector('.card-container');
        const sourceSlide = this.element.querySelector('[data-id="source"]');
        
        const cleanTitle = this.sanitizeTitle(this.post.title);
        this.post.reactions.forEach((reaction, index) => {
            // Extract heading from first up to 5 words if a colon appears
            let heading = 'Detail';
            let bodyText = reaction;
            try {
                const match = reaction.match(/^((?:\S+\s+){0,4}\S+)\s*:\s*(.*)$/);
                if (match && match[1]) {
                    heading = match[1].trim();
                    bodyText = match[2] !== undefined ? match[2].trim() : '';
                    // If heading still contains "Perspective" with numbers, clean it
                    if (heading.toLowerCase().includes('perspective')) {
                        heading = 'Detail';
                    }
                }
            } catch (_) {}

            const reactionSlide = document.createElement('div');
            reactionSlide.className = 'card-slide';
            reactionSlide.setAttribute('data-id', `reaction-${index}`);
            reactionSlide.innerHTML = `
                <div class="card-gradient-overlay"></div>
                <div class="card-content">
                    <div class="card-header">
                        <h2 class="card-title">${cleanTitle}</h2>
                        <div class="card-badge">${heading}</div>
                        </div>
                    <div class="card-body">
                        <p class="reaction-text">${bodyText}</p>
                    </div>
                </div>
            `;
            if (sourceSlide) {
                container.insertBefore(reactionSlide, sourceSlide);
            } else {
                container.appendChild(reactionSlide);
            }
        });
    }

    createMainContinuationSlidesIfNeeded() { /* disabled: essence stays only on the first slide */ }


    createAboutSlide() {
        try {
            const container = this.element.querySelector('.card-container');
            const mainSlide = this.element.querySelector('.card-slide[data-id="main"]');
            if (!container || !mainSlide) return;
            const cleanTitle = this.sanitizeTitle(this.post.title);
            const about = document.createElement('div');
            about.className = 'card-slide';
            about.setAttribute('data-id', 'about');
            const text = `Demonstration game provided by Ploynky. We invite creative people to invent games — with AI, ideas matter more than advanced coding, especially for useful, educational games for kids.`;
            about.innerHTML = `
                <div class="card-content">
                    <div class="card-header">
                        <h2 class="card-title">${cleanTitle}</h2>
                        <div class="card-badge">About</div>
                        <div class="header-actions"></div>
                    </div>
                    <div class="card-body">
                        <p class="reaction-text">${text}</p>
                    </div>
                </div>`;
            if (mainSlide.nextSibling) container.insertBefore(about, mainSlide.nextSibling); else container.appendChild(about);
        } catch(_){}
    }
    initializeSlides() {
        this.slides = Array.from(this.element.querySelectorAll('.card-slide'));
    }

    createPlaySlideIfNeeded() {
        try {
            if (!this.post || this.post.type !== 'microgame' || !this.post.source) return;
            const container = this.element.querySelector('.card-container');
            const mainSlide = this.element.querySelector('.card-slide[data-id="main"]');
            if (!container || !mainSlide) return;
            const cleanTitle = this.sanitizeTitle(this.post.title);
            const timeText = this.formatTimeAgo(this.post.publishedAt || this.post.generatedAt);
            const slide = document.createElement('div');
            slide.className = 'card-slide';
            slide.setAttribute('data-id', 'play');
            slide.innerHTML = `
                <div class="card-content">
                    <div class="card-header">
                        <h2 class="card-title">${cleanTitle}</h2>
                        <div class="card-badge">Play</div>
                        <div class="card-time">${timeText}</div>
                    </div>
                    <div class="card-body">
                        <button class="play-btn" type="button" aria-label="Play ${cleanTitle}">Play</button>
                    </div>
                </div>`;
            if (mainSlide.nextSibling) container.insertBefore(slide, mainSlide.nextSibling); else container.appendChild(slide);
            const btn = slide.querySelector('.play-btn');
            if (btn) btn.addEventListener('click', () => this.openGameModal());
        } catch (_) { }
    }

    injectPlayButtonIntoMain() {
        try {
            const body = this.element.querySelector('.card-slide[data-id="main"] .card-body');
            if (!body) return;
            const btn = document.createElement('button');
            btn.className = 'play-btn';
            btn.type = 'button';
            btn.textContent = 'Play';
            btn.setAttribute('aria-label', `Play ${this.sanitizeTitle(this.post?.title || 'game')}`);
            body.appendChild(btn);
            btn.addEventListener('click', () => this.openGameModal());
        } catch (_) {}
    }

    openGameModal() {
        try {
            const url = this.post?.source; if (!url) return;
            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'game-modal-overlay';
            overlay.innerHTML = `
                <div class="game-modal">
                  <button class="game-modal-close" aria-label="Close">×</button>
                  <div class="game-modal-body">
                    <iframe src="${url}" title="${this.sanitizeTitle(this.post?.title || 'Game')}" allowfullscreen></iframe>
                  </div>
                </div>`;
            document.body.appendChild(overlay);
            const close = overlay.querySelector('.game-modal-close');
            const cleanup = () => { try { document.body.removeChild(overlay); } catch (_) {} };
            close?.addEventListener('click', cleanup);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
        } catch (e) { console.error('Failed to open game modal', e); }
    }

    setupSwipeGestures() {
        const container = this.element.querySelector('.card-container');
        if (!container) return;

        // Touch events
        container.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
            this.touchStartTarget = e.target;
            this.element.classList.add('swiping');
        });

        container.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].screenX;
            this.element.classList.remove('swiping');
            this.handleSwipe();
        });

        // Mouse events for desktop
        let mouseDown = false;
        container.addEventListener('mousedown', (e) => {
            mouseDown = true;
            this.touchStartX = e.screenX;
            this.touchStartTarget = e.target;
            this.element.classList.add('swiping');
        });

        container.addEventListener('mouseup', (e) => {
            if (mouseDown) {
                mouseDown = false;
                this.touchEndX = e.screenX;
                this.element.classList.remove('swiping');
                this.handleSwipe();
            }
        });

        container.addEventListener('mouseleave', () => {
            mouseDown = false;
            this.element.classList.remove('swiping');
        });
    }

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = this.touchStartX - this.touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swipe left - next slide (autoplay disabled by design)
                this.nextSlide();
            } else {
                // Swipe right - previous slide or request next post if on first slide
                if (this.currentSlide === 0) {
                    if (this.post?.isSelectionCard) return; // ignore on selection card
                    try {
                        const evt = new CustomEvent('user-request-next-post', { bubbles: true, detail: { postId: this.post?.id } });
                        this.element.dispatchEvent(evt);
                    } catch (_) { /* ignore */ }
                } else {
                    this.previousSlide();
                }
            }
        }
    }

    isStartOnEssence() {
        try {
            if (!this.touchStartTarget) return false;
            const mainEssence = this.element.querySelector('.card-slide[data-id="main"] .card-essence');
            const mainBody = this.element.querySelector('.card-slide[data-id="main"] .card-body');
            return !!(this.touchStartTarget.closest && (
                (mainEssence && this.touchStartTarget.closest('.card-slide[data-id="main"] .card-essence')) ||
                (mainBody && this.touchStartTarget.closest('.card-slide[data-id="main"] .card-body'))
            ));
        } catch (_) {
            return false;
        }
    }

    setupIndicators() {
        if (this.post?.isSelectionCard) {
            const c0 = this.element.querySelector('.slide-indicators');
            if (c0) c0.style.display = 'none';
            return;
        }
        const indicatorContainer = this.element.querySelector('.slide-indicators');
        if (!indicatorContainer) return;

        indicatorContainer.innerHTML = '';
        this.slides.forEach((_, index) => {
            const indicator = document.createElement('div');
            indicator.className = 'slide-indicator';
            if (index === 0) indicator.classList.add('active');
            indicator.addEventListener('click', () => this.goToSlide(index));
            indicatorContainer.appendChild(indicator);
        });
    }

    setupProgressBars() {
        const bars = this.element.querySelector('.progress-bars');
        if (!bars) return;
        bars.innerHTML = '';
        bars.style.setProperty('--segments', this.slides.length);
        this.progressSegments = [];
        for (let i = 0; i < this.slides.length; i++) {
            const seg = document.createElement('div');
            seg.className = 'progress-segment';
            const fill = document.createElement('div');
            fill.className = 'progress-fill';
            seg.appendChild(fill);
            bars.appendChild(seg);
            this.progressSegments.push({ seg, fill });
        }
        this.resetProgressVisuals();
        try { window.logTS('SC: progress bars created', { index: this.storyIndex, segments: this.slides.length }); } catch (_) {}
    }

    resetProgressVisuals() {
        if (!this.progressSegments) return;
        this.progressSegments.forEach((s, i) => {
            s.fill.style.transition = 'none';
            s.fill.style.width = i < this.currentSlide ? '100%' : '0%';
        });
        // Trigger reflow to apply next transition cleanly
        void this.element.offsetWidth;
        const current = this.progressSegments[this.currentSlide];
        if (current) {
            current.fill.style.transition = `width ${this.autoPlayDuration}ms linear`;
            current.fill.style.width = '0%';
        }
        try { window.logTS('SC: progress reset', { index: this.storyIndex, slide: this.currentSlide, durationMs: this.autoPlayDuration }); } catch (_) {}
    }

    showSlide(index) {
        if (index < 0 || index >= this.slides.length) return;

        // Hide all slides
        this.slides.forEach((slide, i) => {
            slide.classList.remove('active', 'prev');
            if (i < index) {
                slide.classList.add('prev');
            }
        });

        // Show current slide
        this.slides[index].classList.add('active');
        this.currentSlide = index;

        // Update indicators
        const indicators = this.element.querySelectorAll('.slide-indicator');
        indicators.forEach((indicator, i) => {
            indicator.classList.toggle('active', i === index);
        });

        // Update autoplay duration based on slide content size
        this.autoPlayDuration = this.computeDurationForSlide(this.slides[index]);

        // Disable autoplay on game slide
        const isGameSlide = this.slides[index]?.getAttribute('data-id') === 'game';
        if (isGameSlide) {
            this.autoplayEnabled = false;
            this.stopAutoPlay();
        }

        // Update progress visuals for this slide
        this.resetProgressVisuals();
        // Start progress animation for current segment only if autoplay enabled
        if (this.autoplayEnabled && !isGameSlide) {
            const current = this.progressSegments && this.progressSegments[this.currentSlide];
            if (current) {
                current.fill.style.transition = `width ${this.autoPlayDuration}ms linear`;
                void current.fill.offsetWidth;
                current.fill.style.width = '100%';
            }
        }

        // Persist approximate viewing progress (slide-based)
        this.saveViewProgress(this.currentSlide / Math.max(1, this.slides.length));

        // Reset auto-play only if enabled
        if (this.autoplayEnabled && !isGameSlide) this.startAutoPlay();

        try { window.logTS('SC: showSlide', { index: this.storyIndex, slide: this.currentSlide, durationMs: this.autoPlayDuration, autoplay: !!this.autoplayEnabled }); } catch (_) {}
    }

    nextSlide() {
        const nextIndex = this.currentSlide + 1;
        if (nextIndex < this.slides.length) {
            this.showSlide(nextIndex);
        } else {
            // At the last slide, trigger next story
            this.triggerNextStory();
        }
    }

    previousSlide() {
        const prevIndex = this.currentSlide - 1;
        if (prevIndex >= 0) {
            this.showSlide(prevIndex);
        }
    }

    goToSlide(index) {
        this.showSlide(index);
    }

    startAutoPlay() {
        this.stopAutoPlay();
        // Auto-advance after configured duration
        try { window.logTS('SC: startAutoPlay', { index: this.storyIndex, slide: this.currentSlide, durationMs: this.autoPlayDuration }); } catch (_) {}
        this.autoPlayTimeout = setTimeout(() => {
            this.nextSlide();
        }, this.autoPlayDuration);
    }

    stopAutoPlay() {
        if (this.autoPlayTimeout) {
            clearTimeout(this.autoPlayTimeout);
            this.autoPlayTimeout = null;
            try { window.logTS('SC: stopAutoPlay', { index: this.storyIndex }); } catch (_) {}
        }
    }

    triggerNextStory() {
        // Dispatch event to parent to move to next story
        try { window.logTS('SC: finished post', { index: this.storyIndex, id: this.post?.id }); } catch (_) {}
        this.element.dispatchEvent(new CustomEvent('story-finished', {
            bubbles: true,
            detail: { storyIndex: this.storyIndex }
        }));

        // Mark as fully viewed
        this.saveViewProgress(1);
    }

    startCarousel() {
        // Called by parent when story becomes active
        this.showSlide(0);
        // Do not start autoplay yet; wait for user swipe-left on essence
        // Height already precomputed for non-selection cards to avoid flicker
    }

    cleanup() {
        this.stopAutoPlay();
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }
        if (this._onResizeSel) {
            window.removeEventListener('resize', this._onResizeSel);
            this._onResizeSel = null;
        }
    }

    extractDomain(url) {
        try {
            if (!url) return null;
            const u = new URL(url);
            return u.hostname.replace(/^www\./, '');
        } catch (_) {
            return this.post.feedName || null;
        }
    }

    formatTimeAgo(isoString) {
        try {
            if (!isoString) return '';
            const then = new Date(isoString).getTime();
            if (isNaN(then)) return '';
            const now = Date.now();
            let diff = Math.max(0, Math.floor((now - then) / 1000)); // seconds
            const units = [
                { s: 60, name: 'second' },
                { s: 60, name: 'minute' },
                { s: 24, name: 'hour' },
                { s: 30, name: 'day' },
                { s: 12, name: 'month' }
            ];
            let i = 0;
            let value = diff;
            for (; i < units.length && value >= units[i].s; i++) {
                value = Math.floor(value / units[i].s);
            }
            const names = ['second', 'minute', 'hour', 'day', 'month', 'year'];
            const name = names[i] || 'year';
            const v = Math.max(1, value);
            return `${v} ${name}${v > 1 ? 's' : ''} ago`;
        } catch (_) {
            return '';
        }
    }

    sanitizeTitle(str) {
        try {
            if (!str) return '';
            // Decode HTML entities using the browser
            const tmp = document.createElement('div');
            tmp.innerHTML = str;
            let text = tmp.textContent || tmp.innerText || '';
            // Normalize unicode punctuation to ASCII
            text = text
                .replace(/[\u2018\u2019\u2032]/g, "'")
                .replace(/[\u201C\u201D\u2033]/g, '"')
                .replace(/[\u2013\u2014]/g, '-')
                .replace(/\s+/g, ' ') // collapse whitespace
                .trim();
            // Remove leading separators/punctuation (parentheses, brackets, commas, etc.)
            text = text.replace(/^[\(\)\[\],;:\-\u2013\u2014\.]+\s*/, '').trim();
            // Remove dangling punctuation at end (common when titles are cut)
            text = text.replace(/[\-:\u2013\u2014]+$/g, '').trim();
            return text;
        } catch (_) {
            return String(str || '');
        }
    }

    computeDurationForSlide(slideEl) {
        try {
            // Base time and per-word pacing
            const baseMs = 2500; // base 2.5s
            const perWordMs = 220; // ~200–250ms per word reading pace
            const minMs = 3000;
            const maxMs = 12000; // cap at 12s per slide

            if (!slideEl) return 5000;
            const textContainer = slideEl.querySelector('.reaction-text, .card-essence, .source-text');
            const text = (textContainer?.textContent || '').trim();
            if (!text) return 4000;
            const words = text.split(/\s+/).filter(Boolean);
            const est = baseMs + (words.length * perWordMs);
            return Math.max(minMs, Math.min(maxMs, est));
        } catch (_) {
            return 5000;
        }
    }

    adjustHeightForSlide(slideEl) {
        try { return; } catch (_) { }
    }

    computeAndSetMaxHeight() {
        try {
            if (this._fixedHeight) return; // already computed and fixed
            if (this.post?.isSelectionCard) return; // selection card handled separately
            const root = this.element.querySelector('.story-card');
            if (!root || !this.slides?.length) return;
            const extras = this.getFooterReserve();
            const maxHViewport = Math.floor(window.innerHeight * 0.96);

            // Measure max content height across slides without transitions
            let maxTotal = 0;
            for (const slideEl of this.slides) {
                const content = slideEl.querySelector('.card-content');
                if (!content) continue;
                const body = slideEl.querySelector('.card-body');

                const prevContentHeight = content.style.height;
                const prevBodyOverflow = body ? body.style.overflow : null;
                const prevBodyFlex = body ? body.style.flex : null;
                const prevBodyPadding = body ? body.style.paddingBottom : null;

                content.style.height = 'auto';
                if (body) {
                    body.style.overflow = 'visible';
                    body.style.flex = 'initial';
                    body.style.paddingBottom = '0px'; // do not count artificial padding in measurement
                }

                const contentHeight = Math.ceil(content.scrollHeight);
                const total = contentHeight + extras;
                if (total > maxTotal) maxTotal = total;

                // Restore
                content.style.height = prevContentHeight;
                if (body) {
                    body.style.overflow = prevBodyOverflow;
                    body.style.flex = prevBodyFlex;
                    body.style.paddingBottom = prevBodyPadding;
                }
            }

            const finalH = Math.min(maxTotal, maxHViewport);
            // Fix both host and inner root heights and disable host aspect ratio
            const hostEl = this.element;
            if (hostEl && hostEl.style) {
                hostEl.style.aspectRatio = 'auto';
                hostEl.style.height = `${finalH}px`;
            }
            root.style.height = `${finalH}px`;
            this._fixedHeight = true;

            const capApplied = maxTotal > maxHViewport;
            const bodies = this.element.querySelectorAll('.card-body');
            bodies.forEach(b => {
                // Allow body to scroll only when needed; padding is handled via CSS uniformly
                b.style.overflowY = capApplied ? 'auto' : 'hidden';
                b.style.minHeight = '0';
            });
        } catch (_) { /* ignore */ }
    }

    async applyStoredViewProgress() {
        try {
            const root = this.element.querySelector('.story-card');
            if (!root || !this.post?.id) return;
            const map = await window.LocalStorage.get('postProgress') || {};
            const entry = map[this.post.id];
            const pct = entry && typeof entry.progress === 'number' ? Math.max(0, Math.min(1, entry.progress)) : 0;
            root.style.setProperty('--view-progress', `${Math.round(pct * 100)}%`);
        } catch (e) {
            // ignore
        }
    }

    async setupDataSourcesSelector() {
        const selector = this.element.querySelector('.data-sources-selector');
        if (!selector) return;

        // Show the selector
        selector.style.display = 'block';

        // Hide the essence paragraph
        const essenceElement = this.element.querySelector('.card-essence');
        if (essenceElement) essenceElement.style.display = 'none';

        const sourcesList = selector.querySelector('.sources-list');
        const manageSourcesBtn = selector.querySelector('.manage-sources-btn');

        // Get sources from centralized service
        const allSources = await window.SourcesManager.getAllSources();
        const visibleSourcesOnly = await window.SourcesManager.getVisibleSources();

        // Get currently selected sources from service
        const selected = await window.SourcesManager.getSelectedSources();
        const selectedSet = new Set(selected.all);

        // Populate sources list
        sourcesList.innerHTML = '';

        const onChange = async (source) => {
            let newCategories = [];
            let newExternal = [];

            if (source.type === 'external') {
                newExternal.push(source.url);
            } else {
                newCategories.push(source.id);
            }
            await window.SourcesManager.saveSelectedSources(newCategories, newExternal);
            // Refresh feed immediately
            const refreshButton = document.querySelector('#refresh-button');
            if (refreshButton) {
                refreshButton.click();
            }
        };

        // Check if there are any visible sources
        if (visibleSourcesOnly.length === 0) {
            sourcesList.innerHTML = '<div class="no-sources-message">No sources available. Click "Manage Sources" to add some.</div>';
            sourcesList.style.minHeight = '50px';
            return;
        }

        // Render visible sources
        visibleSourcesOnly.forEach(source => {
            const sourceItem = document.createElement('div');
            sourceItem.className = 'source-item';
            if (source.removable) {
                sourceItem.classList.add('removable');
            }

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'source-selection';
            radio.className = 'source-radio';

            // Set ID based on source type
            const sourceId = source.type === 'external' ?
                `source-url:${encodeURIComponent(source.url)}` :
                `source-${source.id}`;
            radio.id = sourceId;

            // Check if selected
            radio.checked = source.type === 'external' ?
                selectedSet.has(source.url) :
                selectedSet.has(source.id);

            const label = document.createElement('label');
            label.className = 'source-label';
            label.htmlFor = sourceId;

            // Display text with hashtags for all sources
            if (source.tag) {
                label.textContent = source.tag;
                label.classList.add('hashtag');
            } else if (source.type === 'external') {
                label.textContent = source.url.split('/').pop().replace('.json', '');
                label.classList.add('hashtag');
            } else {
                // For sources without tag, use name or derive from id
                label.textContent = source.name || source.id;
            }

            sourceItem.appendChild(radio);
            sourceItem.appendChild(label);

            // Add delete button for removable sources
            if (source.removable) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-source-btn';
                deleteBtn.innerHTML = '×';
                deleteBtn.title = 'Remove source';
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    // Remove from allSources
                    const updatedSources = allSources.filter(s => {
                        if (source.type === 'external') {
                            return s.url !== source.url;
                        }
                        return s.id !== source.id;
                    });

                    await window.LocalStorage.set('allNewsSources', updatedSources);

                    // Also remove from legacy storage for external sources
                    if (source.type === 'external') {
                        const extSources = await window.LocalStorage.get('externalPostSources') || [];
                        const updatedExt = extSources.filter(s => s.url !== source.url);
                        await window.LocalStorage.set('externalPostSources', updatedExt);

                        const selectedExt = await window.LocalStorage.get('selectedExternalPostsUrls') || [];
                        const updatedSelExt = selectedExt.filter(url => url !== source.url);
                        await window.LocalStorage.set('selectedExternalPostsUrls', updatedSelExt);
                    }

                    // Refresh the selector
                    this.setupDataSourcesSelector();
                });
                sourceItem.appendChild(deleteBtn);
            }

            sourcesList.appendChild(sourceItem);

            // Make the whole item clickable (except delete button)
            sourceItem.addEventListener('click', (e) => {
                if (e.target !== radio && !e.target.classList.contains('delete-source-btn')) {
                    if(!radio.checked){
                        radio.checked = true;
                        onChange(source);
                    }
                }
            });
            radio.addEventListener('change', ()=>onChange(source));
        });

        // Padding bottom managed by card height computation; keep list padding minimal
        try {
            sourcesList.style.paddingBottom = '4px';
        } catch (_) {}

        // Add handler for Manage Sources button
        if (manageSourcesBtn) {
            manageSourcesBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (window.webSkel && typeof window.webSkel.showModal === 'function') {
                        // Prefer the dedicated Manage Sources modal for visibility + add/remove
                        const res = await window.webSkel.showModal('manage-sources-modal', {}, true);
                        // If changes were saved, refresh selector and content
                        const saved = res && (res.data?.saved || res.saved);
                        if (saved) {
                            try { await window.SourcesManager.reload(); } catch (_) {}
                            await this.setupDataSourcesSelector();
                            // Also refresh feed to reflect new selection options
                            const refreshButton = document.querySelector('#refresh-button');
                            if (refreshButton) refreshButton.click();
                        }
                    } else {
                        // Fallback: navigate to the settings page
                        await window.webSkel.changeToDynamicPage('external-sources-settings-page', 'app');
                    }
                } catch (_) {
                    // As a last resort, navigate to settings page
                    try { await window.webSkel.changeToDynamicPage('external-sources-settings-page', 'app'); } catch (__) {}
                }
            });
        }
    }

    async saveViewProgress(progress) {
        try {
            if (!this.post?.id) return;
            const pct = Math.max(0, Math.min(1, progress || 0));
            const map = await window.LocalStorage.get('postProgress') || {};
            const prev = map[this.post.id]?.progress || 0;
            const next = Math.max(prev, pct); // never decrease
            map[this.post.id] = {
                progress: next,
                lastViewedAt: new Date().toISOString(),
                slideIndex: this.currentSlide || 0,
                totalSlides: this.slides?.length || 1
            };
            await window.LocalStorage.set('postProgress', map);

            // Reflect immediately in bottom resume bar
            const root = this.element.querySelector('.story-card');
            if (root) root.style.setProperty('--view-progress', `${Math.round(next * 100)}%`);
            try { window.logTS('SC: saveViewProgress', { id: this.post.id, progress: next, slide: this.currentSlide, total: this.slides?.length || 1 }); } catch (_) {}
        } catch (e) {
            // ignore
        }
    }
}
