// Common dashboard utilities: active nav + theme toggle
(function () {
  function setActiveNav() {
    const path = window.location.pathname.split('/').pop();
    document.querySelectorAll('.nav-menu a.nav-btn').forEach((a) => {
      const href = a.getAttribute('href');
      if (href && href.endsWith(path)) a.classList.add('active');
      else a.classList.remove('active');
    });
  }

  function initTheme() {
    const saved = localStorage.getItem('ploinky-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const refreshLabel = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
    };
    refreshLabel();
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('ploinky-theme', next);
      refreshLabel();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setActiveNav();
    initTheme();
  });
})();

