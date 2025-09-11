(() => {
  const body = document.body;
  const title = body.dataset.title || body.dataset.agent || 'Console';
  const requiresAuth = body.dataset.auth === 'true';
  const titleBar = document.getElementById('titleBar');
  const statusEl = document.getElementById('status');
  const sizeEl = document.getElementById('size');
  const themeToggle = document.getElementById('themeToggle');
  const containerName = document.getElementById('containerName');
  const runtime = document.getElementById('runtime');
  containerName.textContent = body.dataset.container || '-';
  runtime.textContent = body.dataset.runtime || '-';
  titleBar.textContent = title;

  function getTheme(){ return localStorage.getItem('webtty_theme') || 'dark'; }
  function setTheme(t){ document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); try { const termBg = getComputedStyle(document.body).getPropertyValue('--term-bg').trim(); term?.setOption('theme', { background: termBg }); } catch(_){} themeToggle.textContent = (t==='dark'?'Dark':'Light'); }
  themeToggle.onclick = ()=>{ const cur = getTheme(); setTheme(cur==='dark'?'light':'dark'); };
  setTheme(getTheme());

  async function ensureAuth(){ if (!requiresAuth) return true; try { const res = await fetch('/whoami'); return res.ok; } catch(_) { return false; } }
  (async ()=>{ if (!(await ensureAuth())) location.href = '/'; })();

  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');
  function showBanner(text, cls){ banner.className = 'banner'; if (cls) banner.classList.add(cls); bannerText.textContent = text; }
  function hideBanner(){ banner.classList.add('hidden'); }

  // xterm
  let term, fitAddon;
  function initConsole(){ const termEl = document.getElementById('term'); const { Terminal } = window; const FitAddon = window.FitAddon.FitAddon; const WebLinksAddon = window.WebLinksAddon.WebLinksAddon; const termBg = getComputedStyle(document.body).getPropertyValue('--term-bg').trim() || '#111b21'; term = new Terminal({ fontFamily:'Menlo, Monaco, Consolas, monospace', fontSize: 13, theme:{ background: termBg }, cursorBlink: true, cursorStyle:'bar', allowProposedApi:true, convertEol:true, scrollback: 2000, rendererType:'canvas' }); fitAddon = new FitAddon(); const links = new WebLinksAddon(); term.loadAddon(fitAddon); term.loadAddon(links); term.open(termEl); term.focus(); try { fitAddon.fit(); } catch(_) {} sizeEl.textContent = term.rows + ' x ' + term.cols; termEl.addEventListener('mousedown', () => term.focus()); }
  function sendResize(){ try { fitAddon.fit(); } catch(_) {} const cols=term.cols; const rows=term.rows; sizeEl.textContent = rows + ' x ' + cols; fetch('/resize', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cols, rows }) }).catch(()=>{}); }
  function bindIO(){ window.addEventListener('resize', sendResize); setTimeout(sendResize, 120); term.onData(data => { fetch('/input', { method:'POST', headers:{'Content-Type':'text/plain'}, body: data }).catch(()=>{}); }); }
  let es; function startSSE(){ showBanner('Connecting…'); try { es?.close?.(); } catch(_){} es = new EventSource('/stream'); es.onopen = () => { statusEl.textContent='connected'; showBanner('Connected','ok'); setTimeout(hideBanner, 800); }; es.onerror = ()=>{ try { es.close(); } catch(_){} try { fetch('/logout', { method:'POST' }).catch(()=>{}); } catch(_){} window.location.href = '/'; }; es.onmessage = (ev) => { try { const text = JSON.parse(ev.data); term.write(text); } catch(_) {} }; }
  initConsole(); startSSE(); bindIO();
})();
