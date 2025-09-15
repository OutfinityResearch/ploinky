// Moved from cli/lib/webtty/clientloader.js; path references remain the same (assets route)
"use strict";
(function(){
  const TAB_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  const dlog = (...args) => { console.log('[webtty]', ...args); };
  const BOOT = {
    agentName: document.body.dataset.agent,
    containerName: document.body.dataset.container,
    runtime: document.body.dataset.runtime,
    requiresAuth: document.body.dataset.auth === 'true',
    title: document.body.dataset.title || document.body.dataset.agent
  };
  document.getElementById('titleBar').textContent = BOOT.title || BOOT.agentName;
  document.getElementById('containerName').textContent = BOOT.containerName;
  document.getElementById('runtime').textContent = BOOT.runtime;
  const tabs = { console: document.getElementById('console'), chat: document.getElementById('chat') };
  const tabConsole = document.getElementById('tabConsole');
  const tabChat = document.getElementById('tabChat');
  function setTab(name) { tabConsole.classList.toggle('active', name==='console'); tabChat.classList.toggle('active', name==='chat'); tabs.console.classList.toggle('active', name==='console'); tabs.chat.classList.toggle('active', name==='chat'); }
  tabConsole.onclick = () => setTab('console'); tabChat.onclick = () => setTab('chat'); setTab('chat');
  const statusEl = document.getElementById('status');
  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');
  function showBanner(text, cls){ banner.classList.remove('hidden','ok','err'); if (cls) banner.classList.add(cls); bannerText.textContent = text; }
  function hideBanner(){ banner.classList.add('hidden'); }
  const sizeEl = document.getElementById('size');
  let term, fitAddon;
  function initConsole() { const termEl = document.getElementById('term'); const { Terminal } = window; const FitAddon = window.FitAddon.FitAddon; const WebLinksAddon = window.WebLinksAddon.WebLinksAddon; const termBg = getComputedStyle(document.body).getPropertyValue('--term-bg').trim() || '#111b21'; term = new Terminal({ fontFamily: 'Menlo, Monaco, Consolas, monospace', fontSize: 13, theme: { background: termBg }, cursorBlink: true, cursorStyle: 'bar', allowProposedApi: true, convertEol: true, scrollback: 2000, rendererType: 'canvas' }); fitAddon = new FitAddon(); const links = new WebLinksAddon(); term.loadAddon(fitAddon); term.loadAddon(links); term.open(termEl); /* don't steal focus on load */ try { fitAddon.fit(); } catch (e) { dlog('fit error', e); } sizeEl.textContent = term.rows + ' x ' + term.cols; termEl.addEventListener('mousedown', () => term.focus()); if (window.ResizeObserver) { const ro = new ResizeObserver(()=>{ try { fitAddon.fit(); } catch(_){} try { sendResize(); } catch(_){} }); ro.observe(termEl); } dlog('console initialized'); }
  let es; let chatBuffer = '';
  function stripCtrlAndAnsi(s){
    try {
      let out = s || '';
      out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
      out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
      return out;
    } catch(_) { return s; }
  }
  function pushSrvFromBuffer(){ if (!chatBuffer) return; const parts = chatBuffer.split(/\r?\n/); chatBuffer = parts.pop() || ''; const blocks = parts.map(stripCtrlAndAnsi).filter(Boolean).join('\n'); if (blocks) addServerMsg(blocks); }
  function startSSE(){ dlog('SSE connecting'); showBanner('Connecting…'); try { es?.close?.(); } catch(_){} es = new EventSource(`/stream?tabId=${TAB_ID}`); es.onopen = () => { statusEl.textContent = 'connected'; dlog('SSE open'); showBanner('Connected', 'ok'); setTimeout(hideBanner, 1000); }; es.onerror = (e) => { try { es.close(); } catch(_){} setTimeout(()=>{ try { startSSE(); } catch(_){} }, 1000); }; es.onmessage = (ev) => { try { const text = JSON.parse(ev.data); dlog('SSE message', { bytes: (text || '').length }); term.write(text); chatBuffer += stripAnsi(text); pushSrvFromBuffer(); } catch (e) { dlog('term write error', e); } }; es.addEventListener('meta', (ev) => { try { const meta = JSON.parse(ev.data || '{}'); if (typeof meta.clients === 'number') { statusEl.textContent = `connected (${meta.clients})`; dlog('meta', meta); } } catch (e) { dlog('meta parse error', e); } }); }
  let userInputBuf = ''; function bindConsoleIO(){ window.addEventListener('resize', sendResize); setTimeout(sendResize, 120); term.onData(data => { dlog('send input', { bytes: (data||'').length }); fetch(`/input?tabId=${TAB_ID}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: data }).catch((e)=>{ dlog('input error', e); showBanner('Input error', 'err'); }); try { const s = data || ''; for (let i=0;i<s.length;i++){ const ch = s[i]; if (ch==='\n'||ch==='\r'){ const msg = userInputBuf.trim(); if (msg) addMsg(msg, 'me'); userInputBuf=''; } else { userInputBuf+=ch; } } } catch(_){} }); }
  function sendResize(){ try { fitAddon.fit(); } catch (e) { dlog('fit error', e); } const cols = term.cols; const rows = term.rows; sizeEl.textContent = rows + ' x ' + cols; dlog('send resize', { cols, rows }); fetch(`/resize?tabId=${TAB_ID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols, rows }) }).catch((e)=>{ dlog('resize error', e); showBanner('Resize error', 'err'); }); }
  const chatList = document.getElementById('chatList'); const cmdInput = document.getElementById('cmd'); const sendBtn = document.getElementById('send'); const enterSendToggle = document.getElementById('enterSendToggle');
  function addMsg(text, cls) { const div = document.createElement('div'); div.className = 'msg ' + cls; const pre = document.createElement('pre'); pre.style.margin = 0; pre.textContent = text; div.appendChild(pre); chatList.appendChild(div); chatList.scrollTop = chatList.scrollHeight; return div; }
  function addServerMsg(fullText) { const lines = (fullText||'').split('\n'); const preview = lines.slice(0, 2).join('\n'); const hasMore = lines.length > 2; const div = document.createElement('div'); div.className = 'msg srv'; const pre = document.createElement('pre'); pre.textContent = preview; pre.style.margin = 0; div.appendChild(pre); if (hasMore) { const more = document.createElement('div'); more.className = 'more'; more.textContent = 'View more'; more.onclick = () => { document.getElementById('moreContent').textContent = fullText; document.getElementById('moreModal').style.display = 'flex'; }; div.appendChild(more); } chatList.appendChild(div); chatList.scrollTop = chatList.scrollHeight; }
  document.getElementById('moreModal').onclick = (e) => { if (e.target.id === 'moreModal') e.currentTarget.style.display = 'none'; };
  function autoresize(){
    const maxPx = 72; // keep it small like WhatsApp
    cmdInput.style.height = 'auto';
    cmdInput.style.height = Math.min(maxPx, Math.max(36, cmdInput.scrollHeight)) + 'px';
    try { sendResize(); } catch(_){}
    try {
      const chatList = document.getElementById('chatList');
      const composer = cmdInput.closest('.composer');
      if (chatList && composer) chatList.style.paddingBottom = (composer.offsetHeight + 8) + 'px';
    } catch(_){}
  }
  cmdInput.addEventListener('input', autoresize); setTimeout(autoresize, 0);
  function sendCmd(){ const cmd = cmdInput.value.trim(); if (!cmd) return; addMsg(cmd, 'me'); cmdInput.value=''; autoresize(); fetch('/input', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cmd + '\n' }).catch((e)=>{ dlog('chat error', e); addServerMsg('[input error]'); showBanner('Chat error', 'err'); }); }
  sendBtn.onclick=sendCmd; cmdInput.addEventListener('keydown', (e)=>{ const enterSends = enterSendToggle.checked; if (enterSends) { if (e.key==='Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); sendCmd(); } } else { if (e.key==='Enter' && e.ctrlKey) { e.preventDefault(); sendCmd(); } } });
  function getCookie(name){ const v = document.cookie.split('; ').find(row => row.startsWith(name + '=')); return v ? v.split('=')[1] : null; }
  async function ensureAuth(){ if (!BOOT.requiresAuth) return true; const cover = document.getElementById('authCover'); const btn = document.getElementById('authBtn'); const pwd = document.getElementById('authPwd'); const err = document.getElementById('authErr'); async function tryAuth(pass){ const res = await fetch('/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) }); dlog('auth response', { ok: res.ok, status: res.status }); return !!res.ok; } if (getCookie('webtty_auth')) return true; cover.style.display='flex'; pwd.addEventListener('keydown', async (e) => { if (e.key==='Enter') { btn.click(); } }); return new Promise((resolve)=>{ btn.onclick=async ()=>{ const ok = await tryAuth(pwd.value); if (ok) { err.textContent=''; cover.style.display='none'; resolve(true); } else { err.textContent='Incorrect password'; } }; }); }
  const themeToggle = document.getElementById('themeToggle'); function getTheme(){ return localStorage.getItem('webtty_theme') || 'dark'; } function setTheme(t){ document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); try { const termBg = getComputedStyle(document.body).getPropertyValue('--term-bg').trim(); term?.setOption('theme', { background: termBg }); } catch(_){} themeToggle.textContent = (t==='dark'?'Dark':'Light'); }
  themeToggle.onclick = () => { const cur=getTheme(); setTheme(cur==='dark'?'light':'dark'); };
  (async function boot(){ dlog('boot', { agent: BOOT.agentName, container: BOOT.containerName, runtime: BOOT.runtime, auth: BOOT.requiresAuth }); await ensureAuth(); setTheme(getTheme()); initConsole(); startSSE(); bindConsoleIO(); })();
})();
