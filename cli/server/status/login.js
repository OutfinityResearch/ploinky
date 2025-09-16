(() => {
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const form = document.getElementById('tokenForm');
  const input = document.getElementById('tokenInput');

  async function goIfAuthed() {
    try {
      const res = await fetch('whoami', { credentials: 'include' });
      if (res.ok) {
        window.location.href = '.';
        return true;
      }
    } catch (_) {}
    return false;
  }

  goIfAuthed();

  function getTokenFromUrl() {
    try {
      const u = new URL(window.location.href);
      return (u.searchParams.get('token') || '').trim();
    } catch (_) {
      return '';
    }
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
        try { return decodeURIComponent(match[1]).trim(); }
        catch (_) { return match[1].trim(); }
      }
    }
    return candidate;
  }

  function resolveToken() {
    const fromUrl = getTokenFromUrl();
    if (fromUrl) {
      input.value = fromUrl;
      return fromUrl;
    }
    const parsed = extractToken(input.value);
    if (parsed && parsed !== input.value) input.value = parsed;
    return parsed;
  }

  async function doLogin(ev) {
    if (ev) ev.preventDefault();
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in...';
    }
    if (err) err.textContent = '';

    const token = resolveToken();
    if (!token) {
      if (err) err.textContent = 'Enter the invitation link or token to continue.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
      return;
    }

    try {
      const res = await fetch('auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        if (btn) btn.textContent = 'Welcome!';
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
        goIfAuthed();
      } else {
        if (err) err.textContent = 'Token not recognised. Double-check and try again.';
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Continue';
        }
      }
    } catch (_) {
      if (err) err.textContent = 'Network error. Please retry.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
    }
  }

  if (form) form.addEventListener('submit', doLogin);
  else if (btn) btn.addEventListener('click', doLogin);

  const auto = getTokenFromUrl();
  if (auto) {
    doLogin();
  } else if (input) {
    input.focus();
  }
})();
