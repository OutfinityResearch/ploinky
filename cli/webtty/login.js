(() => {
  const body = document.body;
  const MODE = body.dataset.mode || 'webtty';
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const pwd = document.getElementById('pwd');

  async function goIfAuthed() {
    try {
      const res = await fetch('/whoami');
      if (res.ok) {
        // Land on root; each server serves its own page at '/'
        location.href = '/';
        return true;
      }
    } catch (_) {}
    return false;
  }

  goIfAuthed();

  async function doLogin() {
    err.textContent = '';
    try {
      const res = await fetch('/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd.value }) });
      if (res.ok) { goIfAuthed(); }
      else { err.textContent = 'Incorrect password'; }
    } catch (e) {
      err.textContent = 'Network error';
    }
  }

  btn.addEventListener('click', doLogin);
  pwd.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doLogin(); });
})();
