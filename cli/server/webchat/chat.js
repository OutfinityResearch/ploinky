(() => {
  const TAB_ID = crypto.randomUUID();
  const dlog = (...a) => console.log('[webchat]', ...a);

  // --- DOM Elements ---
  const body = document.body;
  const markdown = window.webchatMarkdown;
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
    wrap.innerHTML = '<div id="sidePanelContent" class="wa-side-panel-body"></div>';
    const el = document.getElementById('sidePanelContent');
    if (el) {
      el.innerHTML = markdown ? markdown.render(text) : text;
      bindLinkDelegation(el);
    }
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
    // Reset chat area styles to allow it to expand fully
    if (chatArea) {
      chatArea.style.width = '';
      chatArea.style.flex = '';
    }
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
    textDiv.innerHTML = markdown ? markdown.render(text) : text;
    bindLinkDelegation(textDiv);
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

    textDiv.innerHTML = markdown ? markdown.render(preview) : preview;
    bindLinkDelegation(textDiv);

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
      if (el) el.innerHTML = markdown ? markdown.render(fullText) : fullText;
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
  const sttStatus = document.getElementById('sttStatus');
  const sttLang = document.getElementById('sttLang');
  const sttEnable = document.getElementById('sttEnable');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sttSupported = typeof SpeechRecognitionClass === 'function';
  const sttLangKey = 'vc_stt_lang';
  const sttEnabledKey = 'vc_stt_enabled';
  const sendTriggerRe = /\bsend\b/i;

  let sttRecognition = null;
  let sttListening = false;
  let sttActive = false;
  let sttLangCode = localStorage.getItem(sttLangKey) || 'en-GB';
  let finalSegments = [];
  let interimTranscript = '';
  let sttAppliedTranscript = '';

  function updateVoiceStatus(text) {
    if (sttStatus) sttStatus.textContent = text;
  }

  function setMicVisual(active) {
    if (!sttBtn) return;
    sttBtn.classList.toggle('active', active);
    sttBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function resetTranscriptState() {
    finalSegments = [];
    interimTranscript = '';
    sttAppliedTranscript = '';
  }

  function normalizeWhitespace(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function appendVoiceText(addition) {
    if (!addition) return;
    const current = cmdInput.value;
    let insert = addition;
    const additionHasLeadingSpace = /^\s/.test(insert);
    const additionStartsPunct = /^[.,!?;:]/.test(insert);
    if (!additionHasLeadingSpace && current && !/\s$/.test(current) && !additionStartsPunct) {
      insert = ` ${insert}`;
    }
    const selStart = cmdInput.selectionStart;
    const selEnd = cmdInput.selectionEnd;
    const hadFocus = document.activeElement === cmdInput;
    const prevScroll = cmdInput.scrollTop;
    cmdInput.value = current + insert;
    if (hadFocus) {
      if (selStart !== current.length || selEnd !== current.length) {
        cmdInput.setSelectionRange(selStart, selEnd);
      } else {
        const pos = cmdInput.value.length;
        cmdInput.setSelectionRange(pos, pos);
      }
    }
    cmdInput.scrollTop = prevScroll;
    autoResize();
  }

  function updateComposerFromVoice() {
    const combined = normalizeWhitespace(finalSegments.join(' '));
    if (!combined) return;
    if (combined === sttAppliedTranscript) return;
    const addition = combined.slice(sttAppliedTranscript.length);
    if (!addition.trim()) {
      sttAppliedTranscript = combined;
      return;
    }
    appendVoiceText(addition);
    sttAppliedTranscript = combined;
  }

  function handleVoiceSend(rawJoined) {
    const cleaned = normalizeWhitespace((rawJoined || '').replace(/\bsend\b/gi, ' '));
    cmdInput.value = cleaned;
    autoResize();
    if (cleaned) sendCmd();
    else {
      cmdInput.value = '';
      autoResize();
    }
    resetTranscriptState();
  }

  function stopRecognition() {
    if (!sttRecognition) return;
    try { sttRecognition.onresult = null; sttRecognition.onerror = null; sttRecognition.onend = null; sttRecognition.stop(); } catch (_) {}
    sttRecognition = null;
    sttListening = false;
  }

  function startRecognition() {
    if (!sttSupported) {
      updateVoiceStatus('Unsupported');
      setMicVisual(false);
      return;
    }
    if (!sttEnable?.checked) {
      updateVoiceStatus('Disabled');
      setMicVisual(false);
      return;
    }
    if (!sttActive) return;
    if (sttListening) return;

    resetTranscriptState();

    try {
      sttRecognition = new SpeechRecognitionClass();
      sttRecognition.lang = sttLang?.value || sttLangCode || 'en-GB';
      sttRecognition.continuous = true;
      sttRecognition.interimResults = true;

      sttRecognition.onresult = (event) => {
        interimTranscript = '';
        let triggered = false;
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = (res[0]?.transcript || '').trim();
          if (!transcript) continue;
          if (res.isFinal) {
            finalSegments.push(transcript);
            const joined = finalSegments.join(' ');
            if (sendTriggerRe.test(joined)) {
              triggered = true;
              handleVoiceSend(joined);
              break;
            }
          } else {
            interimTranscript = interimTranscript ? `${interimTranscript} ${transcript}` : transcript;
          }
        }
        if (!triggered) updateComposerFromVoice();
      };

      sttRecognition.onerror = (e) => {
        dlog('stt error', e);
        const err = e?.error || e?.message || 'unknown';
        const fatal = err === 'not-allowed' || err === 'service-not-allowed';
        sttListening = false;
        if (fatal) {
          sttActive = false;
          updateVoiceStatus('Permission denied');
          setMicVisual(false);
          stopRecognition();
        } else {
          updateVoiceStatus(`Error: ${err}`);
        }
      };

      sttRecognition.onend = () => {
        sttListening = false;
        if (sttActive && sttEnable?.checked) {
          setTimeout(() => { if (!sttListening && sttActive && sttEnable?.checked) startRecognition(); }, 200);
        } else {
          updateVoiceStatus(sttEnable?.checked ? 'Paused' : 'Disabled');
        }
        setMicVisual(sttActive && sttEnable?.checked);
      };

      sttRecognition.start();
      sttListening = true;
      updateVoiceStatus('Listening…');
      setMicVisual(true);
    } catch (e) {
      dlog('stt start failed', e);
      updateVoiceStatus('Mic blocked');
      setMicVisual(false);
    }
  }

  function applyEnableState(checked) {
    if (sttBtn) {
      sttBtn.setAttribute('aria-disabled', checked ? 'false' : 'true');
    }
    if (!checked) {
      sttActive = false;
      setMicVisual(false);
      stopRecognition();
      updateVoiceStatus('Disabled');
      resetTranscriptState();
    } else {
      sttActive = true;
      setMicVisual(true);
      startRecognition();
    }
  }

  if (settingsBtn && settingsPanel) {
    let settingsOpen = false;
    const toggleSettings = () => {
      settingsOpen = !settingsOpen;
      settingsPanel.classList.toggle('show', settingsOpen);
      settingsBtn.classList.toggle('active', settingsOpen);
    };
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSettings();
    });
    document.addEventListener('click', (e) => {
      if (!settingsOpen) return;
      if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsOpen = false;
        settingsPanel.classList.remove('show');
        settingsBtn.classList.remove('active');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!settingsOpen) return;
      if (e.key === 'Escape') {
        settingsOpen = false;
        settingsPanel.classList.remove('show');
        settingsBtn.classList.remove('active');
      }
    });
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
  } catch (_) {}

  if (sttLang) {
    sttLang.addEventListener('change', (e) => {
      sttLangCode = e.target.value || 'en-GB';
      localStorage.setItem(sttLangKey, sttLangCode);
      if (sttListening) {
        stopRecognition();
        setTimeout(startRecognition, 150);
      }
    });
  }

  if (sttEnable) {
    const stored = localStorage.getItem(sttEnabledKey);
    if (stored !== null) sttEnable.checked = stored === 'true';
    sttEnable.addEventListener('change', () => {
      localStorage.setItem(sttEnabledKey, sttEnable.checked ? 'true' : 'false');
      applyEnableState(sttEnable.checked);
    });
  }

  if (sttBtn) {
    sttBtn.addEventListener('click', () => {
      if (!sttSupported) {
        updateVoiceStatus('Unsupported');
        return;
      }
      if (sttEnable && !sttEnable.checked) {
        if (sttEnable) {
          sttEnable.checked = true;
          localStorage.setItem(sttEnabledKey, 'true');
        }
        applyEnableState(true);
        return;
      }
      sttActive = !sttActive;
      setMicVisual(sttActive);
      if (sttActive) {
        updateVoiceStatus('Listening…');
        startRecognition();
      } else {
        stopRecognition();
        updateVoiceStatus('Off');
        resetTranscriptState();
      }
    });
  }

  if (!sttSupported) {
    updateVoiceStatus('Unsupported');
    if (sttBtn) sttBtn.disabled = true;
  } else if (sttEnable) {
    if (sttEnable.checked) {
      sttActive = true;
      setMicVisual(true);
      startRecognition();
    } else {
      applyEnableState(false);
    }
  } else {
    sttActive = true;
    setMicVisual(true);
    startRecognition();
  }

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
    const blocks = parts.map(stripCtrlAndAnsi).join('\n');
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

  function bindLinkDelegation(container) {
    if (!container || container.dataset.linksBound === 'true') return;
    container.addEventListener('click', (evt) => {
      const link = evt.target.closest('a[data-wc-link="true"]');
      if (link) {
        evt.preventDefault();
        openIframe(link.href);
      }
    });
    container.dataset.linksBound = 'true';
  }

  bindLinkDelegation(chatList);

  startSSE();
})();
