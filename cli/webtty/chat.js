(() => {
  const dlog = (...a) => console.log('[webchat]', ...a);
  const body = document.body;
  const title = body.dataset.title || body.dataset.agent || 'Chat';
  const requiresAuth = body.dataset.auth === 'true';
  const mode = body.dataset.mode || 'webtty';
  const titleBar = document.getElementById('titleBar');
  const statusEl = document.getElementById('statusText');
  const statusDot = document.querySelector('.wa-status-dot');
  const themeToggle = document.getElementById('themeToggle');
  titleBar.textContent = title;

  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');
  
  function showBanner(text, cls) { 
    banner.className = 'wa-connection-banner show'; 
    if (cls === 'ok') banner.classList.add('success');
    else if (cls === 'err') banner.classList.add('error');
    bannerText.textContent = text; 
  }
  
  function hideBanner() { 
    banner.classList.remove('show'); 
  }

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

  async function ensureAuth() { 
    if (!requiresAuth) return true; 
    try { 
      const res = await fetch('/whoami'); 
      return res.ok; 
    } catch(_) { 
      return false; 
    } 
  }
  
  (async () => { 
    if (!(await ensureAuth())) location.href = '/'; 
  })();

  const chatList = document.getElementById('chatList');
  const cmdInput = document.getElementById('cmd');
  const sendBtn = document.getElementById('send');
  
  function formatTime() { 
    const d = new Date(); 
    const h = String(d.getHours()).padStart(2, '0'); 
    const m = String(d.getMinutes()).padStart(2, '0'); 
    return `${h}:${m}`; 
  }
  
  function addMsg(text, isMe) {
    const msgDiv = document.createElement('div');
    msgDiv.className = isMe ? 'wa-message out' : 'wa-message in';
    
    const bubble = document.createElement('div');
    bubble.className = 'wa-message-bubble';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'wa-message-text';
    textDiv.textContent = text;
    bubble.appendChild(textDiv);
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'wa-message-time';
    timeSpan.innerHTML = formatTime();
    
    if (isMe) {
      timeSpan.innerHTML += ' <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M11.071.653a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0L15.354 3.656a.5.5 0 0 0-.707-.707L14 3.596 11.071.653zm-4.207 0a.5.5 0 0 0-.707.707l3.289 3.289a.5.5 0 0 0 .707 0l.994-.993a.5.5 0 0 0-.707-.707L9.793 3.596 6.864.653z"/></svg>';
    }
    
    bubble.appendChild(timeSpan);
    msgDiv.appendChild(bubble);
    chatList.appendChild(msgDiv);
    chatList.scrollTop = chatList.scrollHeight;
    return msgDiv;
  }
  
  function addServerMsg(fullText) {
    const lines = (fullText || '').split('\n');
    const preview = lines.slice(0, 6).join('\n');
    const hasMore = lines.length > 6;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'wa-message in';
    
    const bubble = document.createElement('div');
    bubble.className = 'wa-message-bubble';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'wa-message-text';
    textDiv.textContent = preview;
    bubble.appendChild(textDiv);
    
    if (hasMore) {
      const more = document.createElement('div');
      more.style.fontSize = '13px';
      more.style.color = 'var(--wa-accent)';
      more.style.cursor = 'pointer';
      more.style.marginTop = '5px';
      more.textContent = 'View more';
      more.onclick = () => {
        document.getElementById('moreContent').textContent = fullText;
        document.getElementById('moreModal').style.display = 'flex';
      };
      bubble.appendChild(more);
    }
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'wa-message-time';
    timeSpan.textContent = formatTime();
    bubble.appendChild(timeSpan);
    
    msgDiv.appendChild(bubble);
    chatList.appendChild(msgDiv);
    chatList.scrollTop = chatList.scrollHeight;
  }
  
  const moreModal = document.getElementById('moreModal');
  const moreClose = document.getElementById('moreClose');
  moreModal.onclick = (e) => { 
    if (e.target.id === 'moreModal') e.currentTarget.style.display = 'none'; 
  };
  moreClose.onclick = () => { 
    moreModal.style.display = 'none'; 
  };
  document.addEventListener('keydown', (e) => { 
    if (e.key === 'Escape') { 
      moreModal.style.display = 'none'; 
    } 
  });
  
  function sendCmd() { 
    const cmd = cmdInput.value.trim(); 
    if (!cmd) return; 
    addMsg(cmd, true);
    cmdInput.value = ''; 
    fetch('/input', { 
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
  
  cmdInput.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      sendCmd(); 
    }
  });

  let es;
  let chatBuffer = '';
  
  function stripCtrlAndAnsi(s) {
    try {
      let out = s || '';
      // Remove OSC sequences: ESC ] ... (BEL or ESC \\)
      out = out.replace(/\u001b\][^\u0007\u001b]*?(?:\u0007|\u001b\\)/g, '');
      // Remove CSI/ANSI sequences
      out = out.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      // Remove other control chars except \n, \r, \t
      out = out.replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F]/g, '');
      return out;
    } catch(_) { 
      return s; 
    }
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
    try { 
      es?.close?.(); 
    } catch(_) {}
    
    es = new EventSource('/stream'); 
    
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
      try { 
        es.close(); 
      } catch(_) {}
      try { 
        fetch('/logout', { method: 'POST' }).catch(() => {}); 
      } catch(_) {}
      window.location.href = '/'; 
    };
    
    es.onmessage = (ev) => { 
      try { 
        const text = JSON.parse(ev.data); 
        chatBuffer += stripCtrlAndAnsi(text); 
        pushSrvFromBuffer(); 
      } catch (e) { 
        dlog('term write error', e); 
      } 
    };
  }
  
  startSSE();
})();