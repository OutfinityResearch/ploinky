(() => {
  const body = document.body;
  const MODE = body.dataset.mode || 'webtty';
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const themeToggle = document.getElementById('themeToggle');

  // Theme management
  function getTheme() { 
    return localStorage.getItem('webtty_theme') || 'dark'; 
  }
  
  function setTheme(t) { 
    document.body.setAttribute('data-theme', t); 
    localStorage.setItem('webtty_theme', t); 
  }
  
  themeToggle.onclick = () => { 
    const cur = getTheme(); 
    setTheme(cur === 'dark' ? 'light' : 'dark'); 
  };
  
  setTheme(getTheme());

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

  function getTokenFromUrl() {
    try { const u = new URL(location.href); return (u.searchParams.get('token') || '').trim(); } catch(_) { return ''; }
  }

  async function doLogin() {
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    if (err) err.textContent = '';
    const token = getTokenFromUrl();
    if (!token) {
      err.textContent = 'Missing access token. Open the link from your terminal.';
      btn.textContent = 'Use Access Link';
      btn.disabled = false;
      return;
    }
    
    try {
      const res = await fetch('/auth', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ token }) 
      });
      
      if (res.ok) { if (btn) btn.textContent = 'Success!'; goIfAuthed(); }
      else { if (err) err.textContent = 'Invalid or expired access link'; if (btn) { btn.textContent = 'Use Access Link'; btn.disabled = false; } }
    } catch (e) {
      if (err) err.textContent = 'Network error';
      if (btn) { btn.textContent = 'Use Access Link'; btn.disabled = false; }
    }
  }

  if (btn) btn.addEventListener('click', doLogin);
  // Auto-login if token present
  if (getTokenFromUrl()) doLogin();
})();
