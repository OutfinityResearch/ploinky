export class SettingsPage {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.invalidate();
  }

  async beforeRender() {}

  afterRender() {
    const back = this.element.querySelector('#back-button');
    if (back) back.addEventListener('click', () => window.webSkel.changeToDynamicPage('news-feed-page','app'));

    const btnSmall = this.element.querySelector('#text-small');
    const btnMedium = this.element.querySelector('#text-medium');
    const btnLarge = this.element.querySelector('#text-large');
    const btnXLarge = this.element.querySelector('#text-xlarge');

    const applyActive = () => {
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-scale') || '1');
      btnSmall?.classList.toggle('active', Math.abs(scale - 0.9) < 0.01);
      btnMedium?.classList.toggle('active', Math.abs(scale - 1.0) < 0.01);
      btnLarge?.classList.toggle('active', Math.abs(scale - 1.15) < 0.01);
      btnXLarge?.classList.toggle('active', Math.abs(scale - 1.3) < 0.01);
    };

    const setScale = async (value) => {
      document.documentElement.style.setProperty('--content-scale', String(value));
      await window.LocalStorage.set('contentScale', value);
      applyActive();
    };

    btnSmall?.addEventListener('click', () => setScale(0.9));
    btnMedium?.addEventListener('click', () => setScale(1.0));
    btnLarge?.addEventListener('click', () => setScale(1.15));
    btnXLarge?.addEventListener('click', () => setScale(1.3));

    applyActive();

    // Debug Logs toggle
    const debugToggle = this.element.querySelector('#debug-logs-toggle');
    try {
      if (debugToggle) {
        // initial state from global flag
        debugToggle.checked = !!window.__LOGS_ENABLED;
        debugToggle.addEventListener('change', (e) => {
          try { window.setLogsEnabled(!!e.target.checked); } catch (_) {}
        });
      }
    } catch (_) {}

    // Reset Data button
    const resetBtn = this.element.querySelector('#reset-data');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const sure = confirm('Reset all app data? This clears favorites, sources, and preferences.');
        if (!sure) return;
        try {
          // Attempt to delete IndexedDB database
          const name = window.LocalStorage?.dbName || 'MemeStudioDB';
          const delReq = indexedDB.deleteDatabase(name);
          await new Promise((resolve) => {
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => resolve();
            delReq.onblocked = () => resolve();
          });
        } catch (_) {}
        try { localStorage.clear(); } catch (_) {}
        try { window.setLogsEnabled(false); } catch (_) {}
        location.reload();
      });
    }

    // Playful fonts toggle
    const playfulToggle = this.element.querySelector('#playful-fonts-toggle');
    const applyPlayful = (on) => {
      try {
        const root = document.documentElement;
        if (on) root.classList.add('playful'); else root.classList.remove('playful');
      } catch (_) {}
    };
    try {
      const storedPlayful = await window.LocalStorage.get('playfulUI');
      const isPlayful = storedPlayful === true || storedPlayful === 'true';
      applyPlayful(isPlayful);
      if (playfulToggle) {
        playfulToggle.checked = !!isPlayful;
        playfulToggle.addEventListener('change', async (e) => {
          const on = !!e.target.checked;
          applyPlayful(on);
          await window.LocalStorage.set('playfulUI', on);
        });
      }
    } catch (_) {}
  }
}
