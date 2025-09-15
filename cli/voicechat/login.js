(() => {
  const tok = document.getElementById('tok');
  const go = document.getElementById('go');
  if (go) go.addEventListener('click', async () => {
    const t = (tok.value || '').trim();
    if (!t) return;
    try {
      const res = await fetch('/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      if (res.ok) window.location.href = '/';
      else alert('Invalid token');
    } catch (e) { alert('Login failed'); }
  });
})();

