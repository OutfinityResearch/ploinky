export class NewsFeedPage {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.storyCards = [];
        // Virtualization state
        this.storyCardsMap = new Map(); // index -> presenter
        this.cardEls = new Map(); // index -> <story-card>
        this.windowBefore = 2;
        this.windowAfter = 2;
        this.currentStoryIndex = 0;
        this.posts = [];
        this.boundNextStory = this.nextStory.bind(this);
        this.touchStartY = 0;
        this.touchEndY = 0;
        this.touchStartX = 0;
        this.touchEndX = 0;
        this._navLock = false; // prevents double-advance on same gesture
        this.isLoadingMore = false;
        this._postsLoaded = false;
        this.invalidate();
    }

    async beforeRender() {
        if (this._postsLoaded) {
            try { window.logTS('NF: beforeRender skipped (already loaded)'); } catch (_) {}
            return;
        }
        try { if (window.__LOGS_ENABLED) { console.time('NF: full load'); console.time('NF: waiting UI'); } } catch (_) {}
        // Always start on selection card; do not jump to first item automatically
        this.startAtFirstNews = false;
        const hasVisited = await window.LocalStorage.get('hasVisitedBefore');
        if (!hasVisited) {
            const tutorialPost = this.createTutorialPost();
            const localPosts = await window.LocalStorage.get('posts') || [];
            localPosts.unshift(tutorialPost);
            await window.LocalStorage.set('posts', localPosts);
            await window.LocalStorage.set('hasVisitedBefore', true);
        }
        
        const localPosts = await window.LocalStorage.get('posts') || [];
        
        let jsonPosts = [];
        try {
            if (window.__LOGS_ENABLED) console.time('NF: beforeRender total');
            // Try to load from configured external URLs first (support tagged sources)
            const externalSources = await window.LocalStorage.get('externalPostSources') || [];
            const allExternal = Array.isArray(externalSources) ? externalSources.map(s => s.url) : (await window.LocalStorage.get('externalPostsUrls') || []);
            const selectedExternal = await window.LocalStorage.get('selectedExternalPostsUrls');
            const externalUrls = (Array.isArray(selectedExternal) ? selectedExternal : allExternal).filter(Boolean);
            if (window.__LOGS_ENABLED) window.logTS('NF: selected external URLs', { count: externalUrls.length });

            // Fetch external sources in parallel
            const externalFetches = externalUrls.map(url => (
                fetch(url, { cache: 'no-store' })
                    .then(r => r.ok ? r.json() : [])
                    .catch(err => { console.error(`Could not fetch posts from ${url}:`, err); return []; })
            ));

            // Load from selected local source categories (default to 'default')
            const selected = await window.LocalStorage.get('selectedSourceCategories') || ['default'];
            if (window.__LOGS_ENABLED) window.logTS('NF: selected categories', { count: selected.length });

            // Fetch category sources in parallel
            const filteredSelected = (selected || []).filter(cat => !!cat && cat !== 'default');
            const categoryFetches = filteredSelected.map(cat => {
                try {
                    // Map logical ids to folder names
                    const folder = (cat === 'allAges') ? 'allAges' : cat;
                    // Build default local path; now using games.json for games
                    const sourceUrl = `./sources/${folder}/games.json`;
                    const fullUrl = sourceUrl.startsWith('/') ? `.${sourceUrl}` : sourceUrl;
                    return fetch(fullUrl, { cache: 'no-store' })
                        .then(r => r.ok ? r.json() : [])
                        .catch(err => { console.warn(`Could not load source ${cat}`, err); return []; });
                } catch (e) {
                    console.warn(`Could not build URL for source ${cat}`, e);
                    return Promise.resolve([]);
                }
            });

            // Run both groups in parallel and time them individually
            const extPromise = Promise.all(externalFetches);
            const catPromise = Promise.all(categoryFetches);
            if (window.__LOGS_ENABLED) {
                console.time('NF: fetch externals');
                extPromise.then(() => console.timeEnd('NF: fetch externals'));
                console.time('NF: fetch categories');
                catPromise.then(() => console.timeEnd('NF: fetch categories'));
            }
            const [externalResults, categoryResults] = await Promise.all([extPromise, catPromise]);
            let extPosts = 0, catPosts = 0;
            for (const arr of externalResults) { if (Array.isArray(arr)) { jsonPosts = jsonPosts.concat(arr); extPosts += arr.length; } }
            // Rebuild mapping: iterate selected categories to align
            for (let i = 0; i < filteredSelected.length; i++) {
                const cat = filteredSelected[i];
                const arr = categoryResults[i];
                if (Array.isArray(arr)) {
                    const mapped = arr.map(g => ({ ...g, tag: g.tag || (cat === 'allAges' ? '@allAges' : cat), type: g.type || 'microgame' }));
                    jsonPosts = jsonPosts.concat(mapped);
                    catPosts += arr.length;
                }
            }
            if (window.__LOGS_ENABLED) window.logTS('NF: posts from sources', { external: extPosts, category: catPosts });
        } catch (error) {
            console.error("Could not fetch games.json:", error);
        }

        // Create selection post
        const selectionPost = {
            id: "selection-card",
            title: "Select Game Sources",
            essence: "Welcome to Ploynky! Pick your game categories below:",
            reactions: [],
            source: "#",
            isSelectionCard: true
        };
        
        // Ensure selection post is first
        const allPosts = [selectionPost, ...jsonPosts, ...localPosts];

        // Ensure every post has a stable id for tracking/ordering
        if (window.__LOGS_ENABLED) console.time('NF: ensure ids');
        const ensureId = (p) => {
            try {
                if (p && !p.id) {
                    const date = p.publishedAt || p.generatedAt || p.pubDate || p.date || p.createdAt || '';
                    const src = p.source || p.url || '';
                    const title = p.title || '';
                    p.id = `${src}|${title}|${date}`.slice(0, 256);
                }
            } catch (_) {}
            return p;
        };
        allPosts.forEach(ensureId);
        if (window.__LOGS_ENABLED) console.timeEnd('NF: ensure ids');

        // Filter out posts that look like HTML/code or have too-short pages
        const isLikelyHtmlOrCode = (text = '') => {
            if (!text || typeof text !== 'string') return false;
            const htmlTag = /<\/?[a-z][^>]*>/i;
            const codeFence = /```|<script|function\s|class\s|\{\s*\}|console\.|import\s|export\s|;\s*\n/mi;
            const attrs = /\s(?:class|style|id|onclick|onerror|href|src)=/i;
            return htmlTag.test(text) || codeFence.test(text) || attrs.test(text);
        };
        const wordCount = (text = '') => (text.trim().match(/\b\w+\b/g) || []).length;
        const isValidPost = (p) => {
            if (!p) return false;
            // Keep selection card, tutorial/fallback posts regardless
            if (typeof p.id === 'string' && (p.id === 'selection-card' || p.id.startsWith('tutorial-') || p.id.startsWith('fallback-'))) return true;
            // Allow microgames without strict text checks
            if (p.type === 'microgame') return true;
            const pages = [];
            if (p.essence) pages.push(p.essence);
            if (Array.isArray(p.reactions)) pages.push(...p.reactions.filter(Boolean));
            if (pages.length === 0) return false;
            // Reject if any page looks like html/code
            if (pages.some(isLikelyHtmlOrCode)) return false;
            // Require each page to have at least 15 words
            if (pages.some(txt => wordCount(txt) < 15)) return false;
            return true;
        };
        
        // De-dup fast using a Set, then validate
        if (window.__LOGS_ENABLED) console.time('NF: dedup');
        const seenIds = new Set();
        const uniquePosts = [];
        for (const p of allPosts) {
            if (!p || !p.id) continue;
            if (seenIds.has(p.id)) continue;
            seenIds.add(p.id);
            uniquePosts.push(p);
        }
        if (window.__LOGS_ENABLED) console.timeEnd('NF: dedup');
        if (window.__LOGS_ENABLED) console.time('NF: validate');
        const filteredPosts = uniquePosts.filter(isValidPost);
        if (window.__LOGS_ENABLED) console.timeEnd('NF: validate');
        if (window.__LOGS_ENABLED) window.logTS('NF: counts', { all: allPosts.length, unique: uniquePosts.length, valid: filteredPosts.length });

        // Get viewing history data: which posts have ever been centered (brought in prime plan)
        const centeredMap = await window.LocalStorage.get('postCenteredHistory') || {};
        
        // Helper to get the publication/generation date
        const getDate = (p) => {
            // Try multiple date fields
            const dateStr = p.publishedAt || p.generatedAt || p.pubDate || p.date || p.createdAt;
            if (dateStr) {
                const date = new Date(dateStr);
                return isNaN(date.getTime()) ? 0 : date.getTime();
            }
            return 0;
        };
        
        // Weight-based sorting:
        // - weight = age in hours (1..1000)
        // - if previously viewed (centered), weight = 2000
        const buildStableKey = (p) => {
            try {
                const src = (p.source || p.url || '').trim().toLowerCase();
                const date = (p.publishedAt || p.generatedAt || p.pubDate || p.date || p.createdAt || '').trim();
                return src ? `${src}|${date}` : (p.id || `${(p.title||'').trim()}|${date}`);
            } catch (_) { return p.id; }
        };
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        if (window.__LOGS_ENABLED) console.time('NF: compute weights');
        const now = Date.now();
        filteredPosts.forEach(p => {
            const ts = getDate(p);
            const ageHours = ts ? Math.floor((now - ts) / (1000 * 60 * 60)) : 1000;
            const baseWeight = clamp(ageHours, 1, 1000);
            const key = buildStableKey(p);
            const seen = !!(centeredMap[key]?.centered || centeredMap[p.id]?.centered);
            p.__weight = seen ? 2000 : baseWeight;
            p.__ts = ts || 0; // for tie-breaker
        });
        if (window.__LOGS_ENABLED) console.timeEnd('NF: compute weights');
        if (window.__LOGS_ENABLED) console.time('NF: sort');
        // Keep selection card pinned at index 0 regardless of weights
        const selection = filteredPosts.find(p => p.id === 'selection-card');
        const others = filteredPosts.filter(p => p.id !== 'selection-card');
        const sortedOthers = others.sort((a, b) => {
            if (a.__weight !== b.__weight) return a.__weight - b.__weight;
            return b.__ts - a.__ts; // prefer newer when same weight
        });
        // Ensure tutorial appears right after selection (index 1) only once per day
        const today = new Date();
        const ymd = `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`;
        const shownKey = 'shownTutorialDate';
        let shouldShowTutorial = false;
        try { const shown = await window.LocalStorage.get(shownKey); if (shown !== ymd) shouldShowTutorial = true; } catch(_) { shouldShowTutorial = true; }
        if (shouldShowTutorial) {
            const tutorialIdx = sortedOthers.findIndex(p => typeof p.id === 'string' && p.id.startsWith('tutorial-'));
            if (tutorialIdx > 0) { const [tutorial] = sortedOthers.splice(tutorialIdx, 1); sortedOthers.unshift(tutorial); }
            try { await window.LocalStorage.set(shownKey, ymd); } catch(_){}
        } else {
            const tIdx = sortedOthers.findIndex(p => typeof p.id === 'string' && p.id.startsWith('tutorial-'));
            if (tIdx >= 0) sortedOthers.splice(tIdx, 1);
        }
        this.posts = selection ? [selection, ...sortedOthers] : sortedOthers;
        if (window.__LOGS_ENABLED) console.timeEnd('NF: sort');
        if (window.__LOGS_ENABLED) console.timeEnd('NF: beforeRender total');
        if (window.__LOGS_ENABLED) window.logTS('NF: posts ready', { count: this.posts.length });

        if (this.posts.length === 0) {
            // This should now only happen if both local storage and JSON are empty
            this.posts = [this.createFallbackPost()];
        }
        this._postsLoaded = true;
    }

    afterRender() {
        if (window.__LOGS_ENABLED) console.time('NF: afterRender total');
        try { window.logTS('NF: afterRender start', { posts: this.posts?.length || 0 }); } catch (_) {}
        const container = this.element.querySelector('.news-feed-container');
        if (!container) {
            console.error("Fatal error: .news-feed-container not found.");
            return;
        }

        // Clear placeholder (loading/progress state)
        const placeholder = container.querySelector('.story-card-placeholder');
        if (placeholder) {
            placeholder.remove();
            try { window.logTS('NF: placeholder removed'); } catch (_) {}
            try { if (window.__LOGS_ENABLED) console.timeEnd('NF: waiting UI'); } catch (_) {}
        } else {
            // End the timer anyway to avoid dangling console timers
            try { if (window.__LOGS_ENABLED) console.timeEnd('NF: waiting UI'); } catch (_) {}
        }

        container.innerHTML = '';
        // Add a top spacer (invisible) to allow the first card to center when scrolled
        const topSpacer = document.createElement('div');
        topSpacer.className = 'top-spacer';
        container.appendChild(topSpacer);
        this.storyCards = [];
        this.storyCardsMap.clear();
        this.cardEls.clear();

        // Add bottom spacer to allow last post to center
        const spacer = document.createElement('div');
        spacer.className = 'bottom-spacer';
        container.appendChild(spacer);

        // WebSkel presenters: resolve asynchronously; do not block on all of them
        customElements.whenDefined('story-card').then(async () => {
            // Do not auto-advance to next post on story-finished
            this.element.removeEventListener('story-finished', this.boundNextStory);

            this.setupScrollDetection();
            this.setupTouchNavigation();

            // Pornește pe cardul de selecție (index 0) fără a sări automat la prima știre
            this.currentStoryIndex = 0;

            // Build initial virtualization window
            this.ensureVirtualWindow(this.currentStoryIndex);

            // Ensure the active presenter is ready before starting its carousel
            if (window.__LOGS_ENABLED) console.time('NF: active presenter ready');
            try {
                const el = this.cardEls.get(this.currentStoryIndex);
                await el?.presenterReadyPromise;
                const presenter = el?.webSkelPresenter;
                if (presenter) this.storyCardsMap.set(this.currentStoryIndex, presenter);
            } catch (_) { }
            if (window.__LOGS_ENABLED) console.timeEnd('NF: active presenter ready');

            // Kick off initial active logic
            this.checkActiveStory();
        });
    }

    createCardAt(index) {
        if (this.cardEls.has(index)) return;
        const container = this.element.querySelector('.news-feed-container');
        if (!container) return;
        const storyCardElement = document.createElement('story-card');
        storyCardElement.setAttribute('data-presenter', 'story-card');
        storyCardElement.setAttribute('data-index', String(index));
        storyCardElement.post = this.posts[index];
        storyCardElement.game = this.posts[index];
        storyCardElement.storyIndex = index;
        storyCardElement.totalStories = this.posts.length;
        // Mark first real post (after selection) to bypass 30% offset correction
        try {
            const post = this.posts[index];
            if (index === 1 && post && !post.isSelectionCard) {
                storyCardElement.classList.add('first-post');
            }
        } catch (_) {}
        // Insert before bottom spacer
        const bottomSpacer = container.querySelector('.bottom-spacer');
        // Find correct position among existing cards by data-index
        const siblings = Array.from(container.querySelectorAll('story-card'));
        let inserted = false;
        for (const sib of siblings) {
            const si = parseInt(sib.getAttribute('data-index'), 10);
            if (Number.isFinite(si) && si > index) {
                container.insertBefore(storyCardElement, sib);
                inserted = true;
                break;
            }
        }
        if (!inserted) container.insertBefore(storyCardElement, bottomSpacer || null);

        // Hook readiness
        const idx = index;
        storyCardElement.presenterReadyPromise
            .then(() => {
                const presenter = storyCardElement.webSkelPresenter;
                if (presenter) this.storyCardsMap.set(idx, presenter);
                if (idx < 3) try { window.logTS('NF: presenter ready', { index: idx }); } catch (_) {}
            })
            .catch(() => {});

        this.cardEls.set(index, storyCardElement);
    }

    removeCardAt(index) {
        const el = this.cardEls.get(index);
        if (!el) return;
        try {
            const presenter = this.storyCardsMap.get(index);
            if (presenter && presenter.cleanup) presenter.cleanup();
        } catch (_) {}
        if (el.parentNode) el.parentNode.removeChild(el);
        this.cardEls.delete(index);
        this.storyCardsMap.delete(index);
    }

    ensureVirtualWindow(centerIndex) {
        const before = this.windowBefore;
        const after = this.windowAfter;
        const start = Math.max(0, centerIndex - before);
        const end = Math.min(this.posts.length - 1, centerIndex + after);
        // Create needed
        for (let i = start; i <= end; i++) {
            this.createCardAt(i);
        }
        // Do not remove cards above the current window to avoid scroll position jumps.
        // Optionally prune only far-below cards to keep DOM light.
        const pruneThreshold = end + 4; // keep a small tail below
        for (const idx of Array.from(this.cardEls.keys())) {
            if (idx > pruneThreshold) this.removeCardAt(idx);
        }
    }

    setupScrollDetection() {
        const container = this.element.querySelector('.news-feed-container');
        if (!container) return;
        // Use fully native scrolling; no scroll-snap tweaks

        let isScrolling = false;
        let scrollTimeout;

        container.addEventListener('scroll', () => {
            if (!isScrolling) {
                isScrolling = true;
            }

            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                isScrolling = false;
                this.checkActiveStory();
            }, 120);
        });

        // Initial activation on first render (no auto-scroll on selection card)
        // Add a small delay to ensure selection card is properly sized
        setTimeout(async () => {
            this.checkActiveStory();
            const cards = container.querySelectorAll('story-card');
            const activeEl = this.cardEls.get(this.currentStoryIndex) || cards[0];
            if (activeEl) {
                activeEl.classList.add('active-card');
                // Ensure starting position is the selection card on all viewports
                // Always align to start for first two cards as well
                activeEl.scrollIntoView({ behavior: 'auto', block: 'start' });
                this.storyCardsMap.get(this.currentStoryIndex)?.startCarousel();
                // Ensure initial active is recorded as centered
                await this.markAsCentered(this.currentStoryIndex);
                try { window.logTS('NF: active card centered and started', { index: this.currentStoryIndex }); } catch (_) {}
            }
                // Asigură-te că flag-ul de salt este mereu inactiv
                try { await window.LocalStorage.set('jumpToFirstNews', false); } catch (_) {}
            if (window.__LOGS_ENABLED) console.timeEnd('NF: afterRender total');
            if (window.__LOGS_ENABLED) console.timeEnd('NF: full load');
        }, 100); // Small delay to ensure DOM is ready
    }

    setupTouchNavigation() {
        const container = this.element.querySelector('.news-feed-container');
        if (!container) return;
        // Remove any previous vertical swipe listeners to allow native scrolling
        if (this._onTouchStart) container.removeEventListener('touchstart', this._onTouchStart);
        if (this._onTouchEnd) container.removeEventListener('touchend', this._onTouchEnd);
        this._onTouchStart = null;
        this._onTouchEnd = null;

        // Keep horizontal-driven next-post event from story-card
        const onNextReq = (e) => {
            if (this._navLock) return;
            this._navLock = true;
            setTimeout(() => { this._navLock = false; }, 350);
            this.nextStory();
        };
        if (this._onUserNextReq) container.removeEventListener('user-request-next-post', this._onUserNextReq);
        this._onUserNextReq = onNextReq;
        container.addEventListener('user-request-next-post', this._onUserNextReq);
    }

    async markAsCentered(index) {
        try {
            // Do not record the selection card as a viewed post
            if (index === 0) return;
            if (!this.posts[index]) return;
            const post = this.posts[index];
            const postId = post.id;
            const src = (post.source || post.url || '').trim().toLowerCase();
            const date = (post.publishedAt || post.generatedAt || post.pubDate || post.date || post.createdAt || '').trim();
            const sKey = src ? `${src}|${date}` : postId;
            const centeredMap = await window.LocalStorage.get('postCenteredHistory') || {};
            let changed = false;
            if (!centeredMap[postId]?.centered) {
                centeredMap[postId] = { centered: true, firstCenteredAt: new Date().toISOString() };
                changed = true;
            }
            if (!centeredMap[sKey]?.centered) {
                centeredMap[sKey] = { centered: true, firstCenteredAt: new Date().toISOString() };
                changed = true;
            }
            if (changed) await window.LocalStorage.set('postCenteredHistory', centeredMap);
        } catch (_) { /* ignore */ }
    }

    async checkActiveStory() {
        const container = this.element.querySelector('.news-feed-container');
        const cards = container.querySelectorAll('story-card');
        const containerRect = container.getBoundingClientRect();

        // Determine active card using robust geometry:
        // 1) Prefer the first card fully inside the container (top>=top+1, bottom<=bottom-1)
        // 2) If none fully inside, choose the card whose center is closest to the container center
        let newActive = this.currentStoryIndex;
        const nearTop = (container.scrollTop || 0) <= 24;
        if (nearTop && this.cardEls.has(0)) {
            newActive = 0;
        } else {
            const centerY = containerRect.top + containerRect.height / 2;
            let bestByCenter = { dist: Infinity, idx: null };
            let fullyFound = null;
            for (const card of cards) {
                const rect = card.getBoundingClientRect();
                const absIndex = parseInt(card.getAttribute('data-index'), 10);
                if (!Number.isFinite(absIndex)) continue;
                const fully = (rect.top >= containerRect.top + 1) && (rect.bottom <= containerRect.bottom - 1);
                if (fully && fullyFound === null) {
                    fullyFound = absIndex;
                    break;
                }
                const cardCenter = rect.top + rect.height / 2;
                const dist = Math.abs(cardCenter - centerY);
                if (dist < bestByCenter.dist) bestByCenter = { dist, idx: absIndex };
            }
            if (fullyFound !== null) {
                newActive = fullyFound;
            } else if (bestByCenter.idx !== null) {
                newActive = bestByCenter.idx;
            }
        }

        if (newActive !== this.currentStoryIndex) {
            try {
                const prev = this.currentStoryIndex;
                const nextPost = this.posts?.[newActive];
                window.logTS('NF: active change', { from: prev, to: newActive, id: nextPost?.id });
            } catch (_) {}
            // Stop autoplay on known presenters and clear classes
            this.storyCardsMap.forEach((presenter, pIdx) => {
                if (!presenter) return;
                presenter.stopAutoPlay();
                presenter.enableAutoPlay = false;
            });
            cards.forEach(el => el.classList.remove('active-card', 'prev-card', 'next-card'));

            // Set new active and start
            this.currentStoryIndex = newActive;
                // Keep native scrolling (no scroll-snap)
            // Ensure window includes neighbors
            this.ensureVirtualWindow(this.currentStoryIndex);
            const activePresenter = this.storyCardsMap.get(newActive);
            const activeEl = this.cardEls.get(newActive);
            if (activeEl) activeEl.classList.add('active-card');
            if (activePresenter) activePresenter.startCarousel();
            
            // Mark this post as having been centered
            await this.markAsCentered(newActive);

            // Do not force any scroll alignment here; let user control scrolling
        } else {
            // Maintain active class on current
            const activeEl = this.cardEls.get(this.currentStoryIndex);
            cards.forEach(el => el.classList.remove('active-card', 'prev-card', 'next-card'));
            if (activeEl) activeEl.classList.add('active-card');
            // Ensure current active is registered as centered
            await this.markAsCentered(this.currentStoryIndex);
            // Keep native scrolling (no scroll-snap)
        }
    }

    async loadMoreStories() {
        // Prevent multiple loads
        if (this.isLoadingMore) return;
        this.isLoadingMore = true;

        const container = this.element.querySelector('.news-feed-container');
        container.classList.add('loading');
        try { window.logTS('NF: loadMoreStories start'); } catch (_) {}

        // Duplicate existing posts for infinite scroll
        const newPosts = [...this.posts];
        
        for (const post of newPosts) {
            const storyCardElement = document.createElement('story-card');
            storyCardElement.setAttribute('data-presenter', 'story-card');
            storyCardElement.post = post;
            storyCardElement.game = post;
            const newIndex = this.posts.length; // Append semantics
            storyCardElement.storyIndex = newIndex;
            storyCardElement.setAttribute('data-index', String(newIndex));
            storyCardElement.totalStories = this.posts.length * 2; // Update total
            const bottomSpacer = container.querySelector('.bottom-spacer');
            container.insertBefore(storyCardElement, bottomSpacer || null);

            // Wait for presenter to be ready
            await customElements.whenDefined('story-card');
            await storyCardElement.presenterReadyPromise;
            if (storyCardElement.webSkelPresenter) {
                this.storyCardsMap.set(newIndex, storyCardElement.webSkelPresenter);
            }
            this.cardEls.set(newIndex, storyCardElement);
            this.posts.push(post);
        }
        try { window.logTS('NF: loadMoreStories done', { added: newPosts.length }); } catch (_) {}
        container.classList.remove('loading');
        try { window.logTS('NF: loadMoreStories end'); } catch (_) {}
        this.isLoadingMore = false;
    }

    nextStory() {
        const container = this.element.querySelector('.news-feed-container');
        if (this.currentStoryIndex < this.posts.length - 1) {
            this.currentStoryIndex++;
            try {
                const post = this.posts?.[this.currentStoryIndex];
                window.logTS('NF: nextStory', { index: this.currentStoryIndex, id: post?.id });
            } catch (_) {}
            this.ensureVirtualWindow(this.currentStoryIndex);
            const el = this.cardEls.get(this.currentStoryIndex);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    previousStory() {
        const container = this.element.querySelector('.news-feed-container');
        if (this.currentStoryIndex > 0) {
            this.currentStoryIndex--;
            try {
                const post = this.posts?.[this.currentStoryIndex];
                window.logTS('NF: previousStory', { index: this.currentStoryIndex, id: post?.id });
            } catch (_) {}
            this.ensureVirtualWindow(this.currentStoryIndex);
            const el = this.cardEls.get(this.currentStoryIndex);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    cleanup() {
        this.element.removeEventListener('story-finished', this.boundNextStory);
        const container = this.element.querySelector('.news-feed-container');
        if (container) {
            if (this._onTouchStart) container.removeEventListener('touchstart', this._onTouchStart);
            if (this._onTouchEnd) container.removeEventListener('touchend', this._onTouchEnd);
            if (this._onUserNextReq) container.removeEventListener('user-request-next-post', this._onUserNextReq);
        }
        // Cleanup presenters
        try { this.storyCardsMap.forEach(p => p?.cleanup && p.cleanup()); } catch (_) {}
    }

    createTutorialPost() {
        return {
            id: "tutorial-1",
            title: "Welcome to Ploynky!",
            essence: "Ploynky is a mobile-first games feed. Each card shows a short description and a Play button. Tap Play to open the game in a focused popup sized for phones.",
            reactions: [
                "Swipe UP or DOWN to move between games.",
                "Swipe LEFT to view more details about a game.",
                "Tap PLAY on the first slide to start the game in a popup.",
                "Use Manage Sources on the first card to pick categories."
            ],
            source: "#",
            backgroundColor: "purple"
        };
    }

    createFallbackPost() {
        return {
            id: "fallback-1",
            title: "No games available",
            essence: "It seems there are no games available right now. Please check back later or add sources using Manage Sources.",
            reactions: [],
            source: "#",
            backgroundColor: "night"
        };
    }
}
