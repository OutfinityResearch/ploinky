(() => {
  const dlog = (...a) => console.log('[webchat]', ...a);
  const body = document.body;
  const title = body.dataset.title || body.dataset.agent || 'Chat';
  const requiresAuth = body.dataset.auth === 'true';
  const mode = body.dataset.mode || 'webtty';
  const titleBar = document.getElementById('titleBar');
  const statusEl = document.getElementById('status');
  const themeToggle = document.getElementById('themeToggle');
  titleBar.textContent = title;

  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');
  function showBanner(text, cls){ banner.className = 'banner'; if (cls) banner.classList.add(cls); bannerText.textContent = text; }
  function hideBanner(){ banner.classList.add('hidden'); }

  function getTheme(){ return localStorage.getItem('webtty_theme') || 'dark'; }
  function setTheme(t){ document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); themeToggle.textContent = (t==='dark'?'Dark':'Light'); }
  themeToggle.onclick = ()=>{ const cur = getTheme(); setTheme(cur==='dark'?'light':'dark'); };
  setTheme(getTheme());

  async function ensureAuth(){ if (!requiresAuth) return true; try { const res = await fetch('/whoami'); return res.ok; } catch(_) { return false; } }
  (async ()=>{ if (!(await ensureAuth())) location.href = '/'; })();

  const chatList = document.getElementById('chatList');
  const cmdInput = document.getElementById('cmd');
  const sendBtn = document.getElementById('send');
  const enterSendToggle = document.getElementById('enterSendToggle');
  function ts(){ const d=new Date(); const h=String(d.getHours()).padStart(2,'0'); const m=String(d.getMinutes()).padStart(2,'0'); return `${h}:${m}`; }
  function addMsg(text, cls) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    const pre = document.createElement('pre'); pre.style.margin = 0; pre.textContent = text; div.appendChild(pre);
    const meta = document.createElement('span'); meta.className='meta-ts'; meta.textContent=ts(); div.appendChild(meta);
    chatList.appendChild(div); chatList.scrollTop = chatList.scrollHeight; return div;
  }
  function addServerMsg(fullText) {
    const lines = (fullText||'').split('\n'); const preview = lines.slice(0, 6).join('\n'); const hasMore = lines.length > 6;
    const div = document.createElement('div'); div.className = 'msg srv';
    const pre = document.createElement('pre'); pre.textContent = preview; pre.style.margin = 0; div.appendChild(pre);
    if (hasMore) { const more = document.createElement('div'); more.className = 'more'; more.textContent = 'View more'; more.onclick = () => { document.getElementById('moreContent').textContent = fullText; document.getElementById('moreModal').style.display = 'flex'; }; div.appendChild(more); }
    const meta = document.createElement('span'); meta.className='meta-ts'; meta.textContent=ts(); div.appendChild(meta);
    chatList.appendChild(div); chatList.scrollTop = chatList.scrollHeight;
  }
  const moreModal = document.getElementById('moreModal');
  const moreClose = document.getElementById('moreClose');
  moreModal.onclick = (e) => { if (e.target.id === 'moreModal') e.currentTarget.style.display = 'none'; };
  moreClose.onclick = () => { moreModal.style.display = 'none'; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { moreModal.style.display = 'none'; } });
  function autoresize(){ cmdInput.style.height = 'auto'; cmdInput.style.height = Math.min(200, Math.max(44, cmdInput.scrollHeight)) + 'px'; }
  cmdInput.addEventListener('input', autoresize); setTimeout(autoresize, 0);
  function sendCmd(){ const cmd = cmdInput.value.trim(); if (!cmd) return; addMsg(cmd, 'me'); cmdInput.value=''; autoresize(); fetch('/input', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cmd + '\n' }).catch((e)=>{ dlog('chat error', e); addServerMsg('[input error]'); showBanner('Chat error', 'err'); }); }
  sendBtn.onclick = sendCmd;
  cmdInput.addEventListener('keydown', (e)=>{ const enterSends = enterSendToggle.checked; if (enterSends) { if (e.key==='Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); sendCmd(); } } else { if (e.key==='Enter' && e.ctrlKey) { e.preventDefault(); sendCmd(); } } });

  let es; let chatBuffer='';
  function stripCtrlAndAnsi(s){
    try {
      let out = s || '';
      // Remove OSC sequences: ESC ] ... (BEL or ESC \\)
      out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
      // Remove CSI/ANSI sequences
      out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      // Remove other control chars except \n, \r, \t
      out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
      return out;
    } catch(_) { return s; }
  }
  function pushSrvFromBuffer(){ if (!chatBuffer) return; const parts = chatBuffer.split(/\r?\n/); chatBuffer = parts.pop() || ''; const blocks = parts.map(stripCtrlAndAnsi).filter(Boolean).join('\n'); if (blocks) addServerMsg(blocks); }
  function startSSE(){ dlog('SSE connecting'); showBanner('Connecting…'); try { es?.close?.(); } catch(_){} es = new EventSource('/stream'); es.onopen = () => { statusEl.textContent = 'connected'; showBanner('Connected','ok'); setTimeout(hideBanner, 800); }; es.onerror = (e) => { try { es.close(); } catch(_){} try { fetch('/logout', { method:'POST' }).catch(()=>{}); } catch(_){} window.location.href = '/'; }; es.onmessage = (ev) => { try { const text = JSON.parse(ev.data); chatBuffer += stripCtrlAndAnsi(text); pushSrvFromBuffer(); } catch (e) { dlog('term write error', e); } }; }
  startSSE();
})();
