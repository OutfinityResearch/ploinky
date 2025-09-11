(() => {
  const body = document.body;
  const MODE = body.dataset.mode || 'webtty';
  const err = document.getElementById('err');
  const btn = document.getElementById('btn');
  const pwd = document.getElementById('pwd');
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

  async function doLogin() {
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    
    try {
      const res = await fetch('/auth', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ password: pwd.value }) 
      });
      
      if (res.ok) { 
        btn.textContent = 'Success!';
        goIfAuthed(); 
      } else { 
        err.textContent = 'Incorrect password';
        btn.textContent = 'Sign In';
        btn.disabled = false;
        pwd.focus();
        pwd.select();
      }
    } catch (e) {
      err.textContent = 'Network error';
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', doLogin);
  pwd.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter') doLogin(); 
  });
  
  // Focus password field on load
  pwd.focus();
})();