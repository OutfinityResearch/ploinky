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
  const sidePanel = document.getElementById('sidePanel');
  const sidePanelContent = document.getElementById('sidePanelContent');
  const sidePanelClose = document.getElementById('sidePanelClose');

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

  function getTheme() { return localStorage.getItem('webtty_theme') || 'dark'; }
  function setTheme(t) { document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); }
  themeToggle.onclick = () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); };
  setTheme(getTheme());

  (async () => { if (requiresAuth && !(await fetch('/whoami').then(r => r.ok).catch(()=>false))) location.href = '/'; })();

  // --- Side Panel Logic ---
  function openSidePanel(bubble, fullText) {
    sidePanelContent.textContent = fullText;
    sidePanel.style.display = 'flex';
    chatContainer.classList.add('side-panel-open');
    activeSidePanelBubble = bubble;
  }

  function closeSidePanel() {
    sidePanel.style.display = 'none';
    chatContainer.classList.remove('side-panel-open');
    activeSidePanelBubble = null;
  }

  sidePanelClose.onclick = closeSidePanel;

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
    msgDiv.querySelector('.wa-message-text').textContent = text;
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

    textDiv.textContent = preview;

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
      sidePanelContent.textContent = fullText;
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

  // --- Actions & Network ---
  function sendCmd() {
    const cmd = cmdInput.value.trim();
    if (!cmd) return;
    addClientMsg(cmd);
    userInputSent = true;
    cmdInput.value = '';
    autoResize();
    fetch(`/input?tabId=${TAB_ID}`, {
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

    es = new EventSource(`/stream?tabId=${TAB_ID}`);

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
