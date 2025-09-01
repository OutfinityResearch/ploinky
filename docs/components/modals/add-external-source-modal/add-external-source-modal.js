export class AddExternalSourceModal {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    const form = this.element.querySelector('form');
    const urlInput = this.element.querySelector('#ext-url');
    const tagInput = this.element.querySelector('#ext-tag');
    const cancelBtn = this.element.querySelector('[data-local-action="cancel"]');
    const testBtn = this.element.querySelector('#test-url');

    const showError = (name, msg) => {
      const el = this.element.querySelector(`.error[data-for="${name}"]`);
      if (el) el.textContent = msg || '';
    };

    const normalizeTag = (s) => {
      if (!s) return '';
      return String(s).trim().replace(/^#/, '').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24);
    };

    const deriveTag = (url) => {
      try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        const i = parts.indexOf('sources');
        if (i !== -1 && parts[i + 1]) return normalizeTag(parts[i + 1]);
        const host = u.hostname.replace(/^www\./, '');
        return normalizeTag(host.split('.')[0]);
      } catch { return 'external'; }
    };

    const validate = () => {
      let ok = true;
      showError('url', ''); showError('tag', '');
      const url = (urlInput.value || '').trim();
      const tagRaw = (tagInput.value || '').trim();
      if (!url) { showError('url', 'URL is required'); ok = false; }
      try { const u = new URL(url); if (!(u.protocol === 'http:' || u.protocol === 'https:')) { showError('url', 'Use http(s) URL'); ok = false; } } catch { showError('url', 'Invalid URL'); ok = false; }
      const tag = normalizeTag(tagRaw || deriveTag(url));
      if (!tag) { showError('tag', 'Hashtag is required (one word)'); ok = false; }
      return { ok, url, tag: normalizeTag(tagRaw || deriveTag(url)) };
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = validate();
      if (!res.ok) return;
      const dialog = this.element.closest('dialog');
      if (window.webSkel && typeof window.webSkel.closeModal === 'function') {
        window.webSkel.closeModal(this.element, { url: res.url, tag: res.tag });
      } else if (dialog) {
        dialog.close(); dialog.remove();
      }
    });

    cancelBtn?.addEventListener('click', () => {
      if (window.webSkel && typeof window.webSkel.closeModal === 'function') {
        window.webSkel.closeModal(this.element);
      } else {
        const dialog = this.element.closest('dialog');
        if (dialog) { dialog.close(); dialog.remove(); }
      }
    });

    // Test URL fetch and JSON validity
    testBtn?.addEventListener('click', async () => {
      showError('url', '');
      const url = (urlInput.value || '').trim();
      try { new URL(url); } catch { showError('url', 'Invalid URL'); return; }
      testBtn.classList.add('testing');
      testBtn.textContent = 'Testing…';
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 8000);
        const resp = await fetch(url, { cache: 'no-store', signal: ac.signal });
        clearTimeout(t);
        if (!resp.ok) {
          showError('url', `HTTP ${resp.status} ${resp.statusText}`);
          return;
        }
        const data = await resp.json();
        if (!Array.isArray(data)) {
          showError('url', 'Not a JSON array');
          return;
        }
        const count = data.length;
        showError('url', `OK: ${count} item(s)`, true);
        // Visual success hint
        const el = this.element.querySelector('.error[data-for="url"]');
        if (el) { el.classList.add('success'); setTimeout(() => el.classList.remove('success'), 2000); }
      } catch (e) {
        showError('url', e.name === 'AbortError' ? 'Timeout' : (e.message || 'Fetch error'));
      } finally {
        testBtn.classList.remove('testing');
        testBtn.textContent = 'Test';
      }
    });
  }
}
