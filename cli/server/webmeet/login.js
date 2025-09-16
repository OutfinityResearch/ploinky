(() => {
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const form = document.getElementById('tokenForm');
  const input = document.getElementById('tokenInput');
  const basePath = String(document.body.dataset.base || '').replace(/\/$/, '');
  const homeHref = basePath ? `${basePath}/` : '/webmeet';
  const toEndpoint = (path) => {
    const suffix = String(path || '').replace(/^\/+/, '');
    return (basePath ? basePath : '') + '/' + suffix;
  };
  async function goIfAuthed() {
    try {
      const res = await fetch(toEndpoint('whoami'), { credentials: 'include' });
      if (res.ok) {
        const info = await res.json().catch(() => null);
        if (info && info.ok) {
          window.location.href = homeHref;
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  goIfAuthed();

  function getTokenFromUrl() {
    try { const u = new URL(window.location.href); return (u.searchParams.get('token') || '').trim(); } catch(_) { return ''; }
  }

  function extractToken(raw) {
    const candidate = (raw || '').trim();
    if (!candidate) return '';
    try {
      const maybeUrl = new URL(candidate);
      const qp = maybeUrl.searchParams.get('token');
      if (qp && qp.trim()) return qp.trim();
    } catch (_) {}
    if (candidate.includes('?')) {
      try {
        const maybeUrl = new URL(candidate, window.location.origin);
        const qp = maybeUrl.searchParams.get('token');
        if (qp && qp.trim()) return qp.trim();
      } catch (_) {}
      try {
        const search = candidate.split('?')[1] || candidate;
        const params = new URLSearchParams(search);
        const qp = params.get('token');
        if (qp && qp.trim()) return qp.trim();
      } catch (_) {}
    }
    if (candidate.includes('token=')) {
      const match = candidate.match(/token=([^&\s]+)/i);
      if (match && match[1]) {
        try { return decodeURIComponent(match[1]).trim(); } catch (_) { return match[1].trim(); }
      }
    }
    return candidate;
  }

  function resolveToken() {
    const fromUrl = getTokenFromUrl();
    if (fromUrl) {
      if (input) input.value = fromUrl;
      return fromUrl;
    }
    if (!input) return '';
    const parsed = extractToken(input.value);
    if (parsed && parsed !== input.value) input.value = parsed;
    return parsed;
  }

  async function performLogin(ev) {
    if (ev) ev.preventDefault();
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    if (err) err.textContent = '';
    const token = resolveToken();
    if (!token) {
      if (err) err.textContent = 'Paste the meeting link or token to continue.';
      if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
      return;
    }
    try {
      const res = await fetch(toEndpoint('auth'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (res.ok) {
        if (btn) btn.textContent = 'Room unlocked';
        try { window.history.replaceState({}, document.title, homeHref); } catch(_) {}
        window.location.href = homeHref;
      } else {
        if (err) err.textContent = 'Token not recognised. Please confirm with the moderator.';
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
      }
    } catch (_) {
      if (err) err.textContent = 'Network error. Try again.';
      if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
    }
  }

  if (form) form.addEventListener('submit', performLogin);
  else if (btn) btn.addEventListener('click', performLogin);

  const autoToken = getTokenFromUrl();
  if (autoToken) {
    if (input) input.value = autoToken;
    performLogin();
  } else if (input) {
    input.focus();
  }
})();
