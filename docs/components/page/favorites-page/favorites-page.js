export class FavoritesPage {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.posts = [];
        this.invalidate();
    }

    async beforeRender() {
        try {
            const ids = await window.LocalStorage.get('favoritePostIds') || [];
            const map = await window.LocalStorage.get('favoritePostsById') || {};
            // Build list preserving ids order
            const posts = [];
            ids.forEach(id => { if (map[id]) posts.push(map[id]); });
            this.posts = posts;
        } catch (e) {
            console.error('Failed to load favorites', e);
            this.posts = [];
        }
    }

    async afterRender() {
        const list = this.element.querySelector('.favorites-list');
        const empty = this.element.querySelector('.favorites-empty');
        const back = this.element.querySelector('#fav-back-button');
        const title = this.element.querySelector('.favorites-title');
        if (!list) return;

        // Wire back button
        if (back) back.addEventListener('click', () => window.webSkel.changeToDynamicPage('news-feed-page','app'));

        // Render list
        list.innerHTML = '';
        const count = (this.posts && this.posts.length) || 0;
        if (title) title.textContent = `Favorites (${count})`;
        if (!this.posts || this.posts.length === 0) {
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;

        await customElements.whenDefined('story-card');
        this.posts.forEach((post, idx) => {
            const el = document.createElement('story-card');
            el.setAttribute('data-presenter', 'story-card');
            el.post = post;
            el.storyIndex = idx; // local index within favorites
            el.totalStories = this.posts.length;
            list.appendChild(el);
        });

        // Keep title count in sync when user unfavorites from within the list
        const observer = new MutationObserver(() => {
            const items = list.querySelectorAll('story-card');
            const num = items.length;
            if (title) title.textContent = `Favorites (${num})`;
            if (empty) empty.hidden = num !== 0;
        });
        observer.observe(list, { childList: true });
    }
}
