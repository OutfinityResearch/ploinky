(() => {
  const TAB_ID = crypto.randomUUID();
  const dlog = (...a) => console.log('[webchat]', ...a);

  // --- DOM Elements ---
  const body = document.body;
  const titleBar = document.getElementById('titleBar');
  const statusEl = document.getElementById('statusText');
  const statusDot = document.querySelector('.wa-status-dot');
  const themeToggle = document.getElementById('themeToggle');
  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');
  const chatList = document.getElementById('chatList');
  const cmdInput = document.getElementById('cmd');
  const sendBtn = document.getElementById('send');
  const chatContainer = document.getElementById('chatContainer');
  const chatArea = document.getElementById('chatArea');
  const sidePanel = document.getElementById('sidePanel');
  const sidePanelContent = document.getElementById('sidePanelContent');
  const sidePanelClose = document.getElementById('sidePanelClose');
  const sidePanelTitle = document.querySelector('.wa-side-panel-title');
  const sidePanelResizer = document.getElementById('sidePanelResizer');

  // --- State ---
  const requiresAuth = body.dataset.auth === 'true';
  let lastServerMsg = { bubble: null, fullText: '' };
  let activeSidePanelBubble = null;
  let userInputSent = false;

  // --- Basic Setup ---
  titleBar.textContent = body.dataset.title || body.dataset.agent || 'Chat';
  
  function showBanner(text, cls) {
    banner.className = 'wa-connection-banner show';
    if (cls === 'ok') banner.classList.add('success');
    else if (cls === 'err') banner.classList.add('error');
    bannerText.textContent = text;
  }

  function hideBanner() { banner.classList.remove('show'); }

  function getTheme() { return localStorage.getItem('webchat_theme') || 'light'; }
  function setTheme(t) { document.body.setAttribute('data-theme', t); localStorage.setItem('webchat_theme', t); }
  themeToggle.onclick = () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); };
  setTheme(getTheme());

  (async () => { if (requiresAuth && !(await fetch('whoami').then(r => r.ok).catch(()=>false))) location.href = '.'; })();

  // --- Side Panel Logic ---
  function getPanelWrapper() { return document.querySelector('.wa-side-panel-content'); }

  function clearPanelTitle() {
    if (!sidePanelTitle) return;
    sidePanelTitle.textContent = '';
    // Remove any children (e.g., anchors)
    try { while (sidePanelTitle.firstChild) sidePanelTitle.removeChild(sidePanelTitle.firstChild); } catch(_){}
  }

  function setPanelTitleText(text) {
    if (!sidePanelTitle) return;
    clearPanelTitle();
    sidePanelTitle.textContent = text || '';
  }

  function setPanelTitleLink(url) {
    if (!sidePanelTitle) return;
    clearPanelTitle();
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = url;
    a.title = url;
    a.style.color = 'var(--wa-accent)';
    a.style.textDecoration = 'none';
    a.style.wordBreak = 'break-all';
    a.style.overflowWrap = 'anywhere';
    a.style.fontFamily = "Menlo, Monaco, Consolas, monospace";
    a.style.fontSize = '13px';
    // Small external-link icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.style.marginLeft = '6px';
    icon.style.verticalAlign = 'text-bottom';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z');
    icon.appendChild(path);
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy link';
    copyBtn.className = 'wa-copy-btn';
    copyBtn.onclick = async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.classList.add('ok');
        copyBtn.title = 'Copied';
        setTimeout(() => { copyBtn.classList.remove('ok'); copyBtn.title = 'Copy link'; }, 1000);
      } catch(_) {}
    };
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.appendChild(a);
    wrap.appendChild(icon);
    wrap.appendChild(copyBtn);
    sidePanelTitle.appendChild(wrap);
  }

  function showTextInPanel(text) {
    const wrap = getPanelWrapper();
    if (!wrap) return;
    wrap.innerHTML = '<pre id="sidePanelContent"></pre>';
    const el = document.getElementById('sidePanelContent');
    if (el) el.textContent = text;
    setPanelTitleText('Full Message');
    sidePanel.style.display = 'flex';
    chatContainer.classList.add('side-panel-open');
  }

  function openSidePanel(bubble, fullText) {
    showTextInPanel(fullText);
    activeSidePanelBubble = bubble;
    applyPanelSizeFromStorage();
  }

  function openIframe(url) {
    try {
      const wrap = getPanelWrapper();
      if (!wrap) return;
      wrap.innerHTML = '';
      const holder = document.createElement('div');
      holder.className = 'wa-iframe-wrap';
      holder.style.position = 'relative';
      holder.style.width = '100%';
      holder.style.height = '100%';

      const frame = document.createElement('iframe');
      frame.src = url;
      frame.style.border = '0';
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.referrerPolicy = 'no-referrer';
      frame.loading = 'lazy';

      const overlay = document.createElement('div');
      overlay.className = 'wa-iframe-error';
      overlay.style.display = 'none';
      overlay.innerHTML = `
        <div class="wa-iframe-error-card">
          <div class="wa-iframe-error-title">Cannot display this site in an embedded view</div>
          <div class="wa-iframe-error-text">It may be blocked by X-Frame-Options or Content Security Policy.</div>
          <div class="wa-iframe-error-actions">
            <a class="wa-btn" href="${url}" target="_blank" rel="noopener noreferrer">Open in new tab</a>
          </div>
        </div>`;

      holder.appendChild(frame);
      holder.appendChild(overlay);
      wrap.appendChild(holder);

      let loaded = false;
      frame.addEventListener('load', () => { loaded = true; overlay.style.display = 'none'; });
      setTimeout(() => { if (!loaded) overlay.style.display = 'flex'; }, 2500);

      setPanelTitleLink(url);
      sidePanel.style.display = 'flex';
      chatContainer.classList.add('side-panel-open');
      applyPanelSizeFromStorage();
    } catch(_) {}
  }

  function closeSidePanel() {
    sidePanel.style.display = 'none';
    chatContainer.classList.remove('side-panel-open');
    activeSidePanelBubble = null;
  }

  sidePanelClose.onclick = closeSidePanel;

  // --- Resizer logic ---
  const PANEL_SIZE_KEY = 'webchat_sidepanel_pct';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function applyPanelSize(pct) {
    const p = clamp(pct, 20, 80);
    if (sidePanel) {
      sidePanel.style.flex = `0 0 ${p}%`;
      sidePanel.style.maxWidth = 'unset';
      sidePanel.style.width = `${p}%`;
    }
    if (chatArea) {
      const leftPct = 100 - p;
      chatArea.style.flex = `0 0 auto`;
      chatArea.style.width = `calc(${leftPct}% - 6px)`; // minus resizer width
    }
  }
  function applyPanelSizeFromStorage() {
    try {
      const saved = parseFloat(localStorage.getItem(PANEL_SIZE_KEY) || '40');
      applyPanelSize(Number.isFinite(saved) ? saved : 40);
    } catch(_) { applyPanelSize(40); }
  }
  (function initResizer(){
    if (!sidePanelResizer) return;
    let dragging = false;
    let startX = 0; let containerW = 0; let startPanelW = 0; let raf = 0; let nextPct = null;
    function scheduleApply(p){
      nextPct = p;
      if (raf) return;
      raf = requestAnimationFrame(()=>{ if (nextPct!=null) applyPanelSize(nextPct); raf = 0; nextPct = null; });
    }
    function onDown(e){
      try { e.preventDefault(); } catch(_){}
      dragging = true;
      chatContainer.classList.add('dragging');
      startX = e.clientX;
      try { sidePanelResizer.setPointerCapture(e.pointerId); } catch(_){}
      const rects = chatContainer.getBoundingClientRect();
      containerW = rects.width;
      startPanelW = sidePanel.getBoundingClientRect().width;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
    }
    function onMove(e){
      if (!dragging) return;
      try { e.preventDefault(); } catch(_){}
      const dx = e.clientX - startX;
      const newWidth = clamp(startPanelW - dx, containerW * 0.2, containerW * 0.8);
      const pct = (newWidth / containerW) * 100;
      scheduleApply(pct);
    }
    function onUp(e){
      if (!dragging) return;
      dragging = false;
      chatContainer.classList.remove('dragging');
      try { sidePanelResizer.releasePointerCapture(e.pointerId); } catch(_){}
      window.removeEventListener('pointermove', onMove);
      // Persist size
      try {
        const panelRect = sidePanel.getBoundingClientRect();
        const contRect = chatContainer.getBoundingClientRect();
        const pct = clamp((panelRect.width / contRect.width) * 100, 20, 80);
        localStorage.setItem(PANEL_SIZE_KEY, String(pct.toFixed(1)));
      } catch(_) {}
    }
    sidePanelResizer.addEventListener('pointerdown', onDown);
  })();

  // --- Composer & Message UI ---
  const MAX_TXT_PX = 72;
  function autoResize() {
    try {
      cmdInput.style.height = 'auto';
      const next = Math.min(MAX_TXT_PX, Math.max(22, cmdInput.scrollHeight));
      cmdInput.style.height = next + 'px';
    } catch (_) {} // Ignore errors during auto-resize
  }
  setTimeout(autoResize, 0);
  cmdInput.addEventListener('input', autoResize);

  function formatTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function addClientMsg(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'wa-message out';
    msgDiv.innerHTML = `
      <div class="wa-message-bubble">
        <div class="wa-message-text"></div>
        <span class="wa-message-time">
          ${formatTime()}
          <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0L15.354 3.656a.5.5 0 0 0-.707-.707L14 3.596 11.071.653zm-4.207 0a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0l.994-.993a.5.5 0 0 0-.707-.707L9.793 3.596 6.864.653z"/></svg>
        </span>
      </div>`;
    const textDiv = msgDiv.querySelector('.wa-message-text');
    textDiv.appendChild(linkify(text));
    chatList.appendChild(msgDiv);
    chatList.scrollTop = chatList.scrollHeight;
    lastServerMsg.bubble = null; // Reset server message grouping
  }

  function updateBubbleContent(bubble, fullText) {
    const lines = (fullText || '').split('\n');
    const preview = lines.slice(0, 6).join('\n');
    const hasMore = lines.length > 6;

    const textDiv = bubble.querySelector('.wa-message-text');
    const moreDiv = bubble.querySelector('.wa-message-more');

    // linkify preview
    textDiv.innerHTML = '';
    textDiv.appendChild(linkify(preview));

    if (hasMore && !moreDiv) {
      const more = document.createElement('div');
      more.className = 'wa-message-more';
      more.textContent = 'View more';
      more.onclick = () => openSidePanel(bubble, fullText);
      bubble.appendChild(more);
    } else if (hasMore && moreDiv) {
      moreDiv.onclick = () => openSidePanel(bubble, fullText);
    }

    if (activeSidePanelBubble === bubble) {
      const el = document.getElementById('sidePanelContent');
      if (el) el.textContent = fullText;
    }
  }

  function addServerMsg(text) {
    if (!userInputSent && lastServerMsg.bubble) {
      // Append to existing bubble
      lastServerMsg.fullText += '\n' + text;
      updateBubbleContent(lastServerMsg.bubble, lastServerMsg.fullText);
    } else {
      // Create a new bubble
      const msgDiv = document.createElement('div');
      msgDiv.className = 'wa-message in';
      const bubble = document.createElement('div');
      bubble.className = 'wa-message-bubble';
      bubble.innerHTML = '<div class="wa-message-text"></div><span class="wa-message-time"></span>';
      msgDiv.appendChild(bubble);

      lastServerMsg.bubble = bubble;
      lastServerMsg.fullText = text;
      userInputSent = false;

      updateBubbleContent(bubble, text);
      bubble.querySelector('.wa-message-time').textContent = formatTime();
      chatList.appendChild(msgDiv);
    }
    chatList.scrollTop = chatList.scrollHeight;
  }

  // --- STT (Speech-to-Text) Logic ---
  const sttBtn = document.getElementById('sttBtn');
  const sttOverlay = document.getElementById('sttOverlay');
  const sttText = document.getElementById('sttText');
  const sttSend = document.getElementById('sttSend');
  const sttCancel = document.getElementById('sttCancel');
  const sttLang = document.getElementById('sttLang');
  const sttEnable = document.getElementById('sttEnable');
  const sttStatus = document.getElementById('sttStatus');
  const sttRecord = document.getElementById('sttRecord');

  let sttRecognition = null;
  let sttRecording = false;
  let finalTranscript = '';
  let sttLangCode = localStorage.getItem('vc_stt_lang') || 'en-US';

  if (sttBtn) {
    sttBtn.onclick = () => {
      // Reset state before showing
      if (sttText) sttText.value = '';
      if (sttStatus) sttStatus.textContent = 'Ready';
      finalTranscript = '';

      if (sttOverlay) sttOverlay.style.display = 'flex';
      // Auto-start recording if enabled
      setTimeout(() => { if (sttEnable?.checked && sttRecord) sttRecord.click(); }, 100);
    };
  }

  if (sttCancel) {
    sttCancel.onclick = () => {
      if (sttRecognition) sttRecognition.stop();
      if (sttOverlay) sttOverlay.style.display = 'none';
    };
  }

  if (sttSend) {
    sttSend.onclick = () => {
      const text = sttText.value.trim();
      if (text) {
        cmdInput.value = text;
        sendCmd();
      }
      if (sttRecognition) sttRecognition.stop();
      if (sttOverlay) sttOverlay.style.display = 'none';
    };
  }

  if (sttRecord) {
    sttRecord.onclick = () => {
      if (sttRecording) {
        if (sttRecognition) sttRecognition.stop();
        return;
      }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert('Speech recognition not supported in this browser.');
        return;
      }
      if (!sttEnable?.checked) return;

      finalTranscript = sttText.value ? sttText.value + ' ' : '';
      sttRecognition = new SR();
      sttRecognition.lang = sttLang?.value || sttLangCode || 'en-US';
      sttRecognition.continuous = true;
      sttRecognition.interimResults = true;

      sttRecognition.onresult = (event) => {
        let interim_transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          } else {
            interim_transcript += event.results[i][0].transcript;
          }
        }
        sttText.value = finalTranscript + interim_transcript;
      };

      sttRecognition.onerror = (e) => { sttStatus.textContent = `Error: ${e.error}`; };
      sttRecognition.onend = () => {
        finalTranscript = sttText.value;
        sttRecording = false;
        sttRecord.textContent = 'Start Recording';
        sttStatus.textContent = 'Ready';
      };

      try {
        sttRecognition.start();
        sttRecording = true;
        sttRecord.textContent = 'Stop Recording';
        sttStatus.textContent = 'Listening...';
      } catch (e) {
        alert(`Could not start STT: ${e.message}`);
      }
    };
  }

  try {
    function fillLangs() {
      const list = (window.speechSynthesis?.getVoices?.() || []).map(v => v.lang).filter(Boolean);
      const common = ['en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR', 'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'];
      const langs = Array.from(new Set([...(list || []), ...common])).sort();
      
      if (sttLang) {
        sttLang.innerHTML = '';
        langs.forEach(code => {
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = code;
          if (code === sttLangCode) opt.selected = true;
          sttLang.appendChild(opt);
        });
      }
    }

    fillLangs();
    window.speechSynthesis?.addEventListener?.('voiceschanged', fillLangs);

    if (sttLang) {
      sttLang.addEventListener('change', (e) => {
        sttLangCode = e.target.value || 'en-US';
        localStorage.setItem('vc_stt_lang', sttLangCode);
        // If recording is active, restart it to apply the new language
        if (sttRecording && sttRecord) {
          if (sttRecognition) sttRecognition.stop(); // This will trigger onend
          // A brief timeout to allow the 'onend' event to fire properly before restarting
          setTimeout(() => sttRecord.click(), 100);
        }
      });
    }
  } catch (_) {}

  // --- Actions & Network ---
  function sendCmd() {
    const cmd = cmdInput.value.trim();
    if (!cmd) return;
    addClientMsg(cmd);
    userInputSent = true;
    cmdInput.value = '';
    autoResize();
    fetch(`input?tabId=${TAB_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: cmd + '\n'
    }).catch((e) => {
      dlog('chat error', e);
      addServerMsg('[input error]');
      showBanner('Chat error', 'err');
    });
  }

  sendBtn.onclick = sendCmd;
  cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCmd(); } });

  let es;
  let chatBuffer = '';

  function formatLinkText(rawUrl) {
    try {
      const u = new URL(rawUrl);
      // Domain without port and without leading www.
      let domain = u.hostname || '';
      if (domain.startsWith('www.')) domain = domain.slice(4);
      // Build a short, readable path summary
      const rawPath = (u.pathname || '/').replace(/\/+$/,'') || '/';
      const path = decodeURIComponent(rawPath);
      const segs = path.split('/').filter(Boolean);
      const short = (s, n) => (s.length > n ? (s.slice(0, Math.max(1, n-1)) + '…') : s);
      let shortPath = '/';
      if (segs.length === 1) {
        shortPath = '/' + short(segs[0], 18);
      } else if (segs.length === 2) {
        shortPath = '/' + short(segs[0], 12) + '/' + short(segs[1], 12);
      } else if (segs.length >= 3) {
        shortPath = '/' + short(segs[0], 10) + '/…/' + short(segs[segs.length - 1], 14);
      }

      // Prefer a meaningful query hint (id or q)
      let hint = '';
      try {
        const qp = new URLSearchParams(u.search || '');
        const id = qp.get('id');
        const q = qp.get('q');
        if (id) hint = ` ?id=${short(id, 12)}`;
        else if (q) hint = ` ?q=${short(q, 12)}`;
      } catch(_) {}

      // Optional hash hint
      if (u.hash) {
        const h = u.hash.replace(/^#/, '');
        if (h) hint += ` #${short(h, 12)}`;
      }

      const labelPath = (shortPath === '/') ? '' : shortPath;
      const sep = hint ? ' ' : '';
      return `Open ${domain}${labelPath}${sep}${hint}`;
    } catch(_) {
      return rawUrl;
    }
  }

  function linkify(text) {
    const frag = document.createDocumentFragment();
    const urlRe = /(https?:\/\/[\w\-._~:\/?#\[\]@!$&'()*+,;=%]+)/gi;
    let lastIndex = 0;
    let m;
    while ((m = urlRe.exec(text)) !== null) {
      const before = text.slice(lastIndex, m.index);
      if (before) frag.appendChild(document.createTextNode(before));
      const rawUrl = m[0];
      const a = document.createElement('a');
      a.href = rawUrl;
      a.textContent = formatLinkText(rawUrl);
      a.title = rawUrl;
      a.style.color = 'var(--wa-accent)';
      a.style.textDecoration = 'underline';
      a.addEventListener('click', (e) => { e.preventDefault(); openIframe(rawUrl); });
      frag.appendChild(a);
      lastIndex = m.index + rawUrl.length;
    }
    const rest = text.slice(lastIndex);
    if (rest) frag.appendChild(document.createTextNode(rest));
    return frag;
  }

  function stripCtrlAndAnsi(s) {
    try {
      let out = s || '';
      // Remove OSC sequences: ESC ] ... (BEL or ESC \)
      out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
      // Remove CSI/ANSI sequences
      out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      // Remove other control chars except \n, \r, \t
      out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
      return out;
    } catch (_) { return s; }
  }

  function pushSrvFromBuffer() {
    if (!chatBuffer) return;
    const parts = chatBuffer.split(/\r?\n/);
    chatBuffer = parts.pop() || '';
    const blocks = parts.map(stripCtrlAndAnsi).filter(Boolean).join('\n');
    if (blocks) addServerMsg(blocks);
  }

  function startSSE() {
    dlog('SSE connecting');
    showBanner('Connecting…');
    try { es?.close?.(); } catch (_) {}

    es = new EventSource(`stream?tabId=${TAB_ID}`);

    es.onopen = () => {
      statusEl.textContent = 'online';
      statusDot.classList.remove('offline');
      statusDot.classList.add('online');
      showBanner('Connected', 'ok');
      setTimeout(hideBanner, 800);
    };

    es.onerror = (e) => {
      statusEl.textContent = 'offline';
      statusDot.classList.remove('online');
      statusDot.classList.add('offline');
      try { es.close(); } catch (_) {}
      // Keep session cookie; auto-reconnect
      setTimeout(() => { try { startSSE(); } catch(_){} }, 1000);
    };

    es.onmessage = (ev) => {
      try {
        const text = JSON.parse(ev.data);
        chatBuffer += stripCtrlAndAnsi(text);
        pushSrvFromBuffer();
      } catch (e) { dlog('term write error', e); }
    };
  }

  startSSE();
})();
