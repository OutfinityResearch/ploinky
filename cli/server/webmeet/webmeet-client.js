(() => {
  const dlog = (...a) => console.log('[webmeet]', ...a);
  const TAB_ID = (()=>{ try { let v = sessionStorage.getItem('vc_tab'); if (!v) { v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); sessionStorage.setItem('vc_tab', v); } return v; } catch(_) { return String(Math.random()).slice(2); } })();

  // Wait for DOM and modules to be ready
  window.addEventListener('DOMContentLoaded', () => {
    // Initialize modules after DOM is ready
    if (window.webMeetPopups) window.webMeetPopups.init();
    if (window.webMeetDemo) window.webMeetDemo.init(document.getElementById('chatList'));
    if (window.webMeetAudio) window.webMeetAudio.init();
  });

  // DOM
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
  // Prepare overlay elements now managed by popups.js
  const chatContainer = document.getElementById('chatContainer');
  const chatArea = document.getElementById('chatArea');
  const sidePanel = document.getElementById('sidePanel');
  const sidePanelContent = document.getElementById('sidePanelContent');
  const sidePanelClose = document.getElementById('sidePanelClose');
  const sidePanelTitle = document.querySelector('.wa-side-panel-title');
  const sidePanelResizer = document.getElementById('sidePanelResizer');
  // Speak overlay elements now managed by popups.js
  const disconnectMask = document.getElementById('disconnectMask');

  // State
  const requiresAuth = true;
  let participants = [];
  let queue = [];
  let currentSpeaker = null;
  let lastOutgoingBubble = null;
  let lastIncomingBubble = null;
  let lastIncomingText = '';
  let joined = false;
  let connected = false;
  let esConn = null;
  let myEmail = '';
  let speakMode = 'prep'; // 'prep' or 'live'
  let pingTimer = null;
  let isDeafened = false; // State for muting incoming audio

  // Theme
  function getTheme() { return localStorage.getItem('webmeet_theme') || 'light'; }
  function setTheme(t) { document.body.setAttribute('data-theme', t); localStorage.setItem('webmeet_theme', t); }
  themeToggle.onclick = () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); };
  setTheme(getTheme());
  titleBar.textContent = 'WebMeet';
  (async () => { if (requiresAuth && !(await fetch('whoami').then(r => r.ok).catch(()=>false))) location.href = '.'; })();

  function showBanner(text, cls) { banner.className = 'wa-connection-banner show'; if (cls === 'ok') banner.classList.add('success'); else if (cls === 'err') banner.classList.add('error'); bannerText.textContent = text; }
  function hideBanner() { banner.classList.remove('show'); }
  function formatTime(){ const d=new Date(); const h=String(d.getHours()).padStart(2,'0'); const m=String(d.getMinutes()).padStart(2,'0'); return `${h}:${m}`; }

  // Side panel helpers (for view-more and participants list)
  let currentPanelMode = null; // 'participants' or 'fullmessage'
  
  function clearPanelTitle(){ if (!sidePanelTitle) return; sidePanelTitle.textContent=''; try { while (sidePanelTitle.firstChild) sidePanelTitle.removeChild(sidePanelTitle.firstChild); } catch(_){} }
  function setPanelTitleText(t){ clearPanelTitle(); sidePanelTitle.textContent = t || ''; }
  
  function showTextInPanel(text){ 
    // Hide participants panel if it's open
    if (participantsPanel) participantsPanel.classList.remove('show');
    
    const wrap = document.querySelector('.wa-side-panel-content'); 
    if (!wrap) return; 
    wrap.innerHTML = '<pre id="sidePanelContent" style="white-space: pre-wrap; word-wrap: break-word;"></pre>'; 
    const el=document.getElementById('sidePanelContent'); 
    if (el) el.textContent = text; 
    setPanelTitleText('Full Message'); 
    sidePanel.style.display='flex'; 
    chatContainer.classList.add('side-panel-open'); 
    applyPanelSizeFromStorage();
    currentPanelMode = 'fullmessage';
  }
  function openSidePanelForParticipants(){
    const wrap = document.querySelector('.wa-side-panel-content'); if (!wrap) return;
    wrap.innerHTML = '';
    const form = document.createElement('div');
    form.innerHTML = `
      <div id="vc_current_speaker" style="margin-bottom:8px; font-size:13px; color:#9aa0a6;"></div>
      <div style="display:flex; gap:8px; margin-bottom:8px">
        <input id="vc_reg_email" type="email" placeholder="Your email" />
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px">
        <button class="wa-btn" id="vc_btn_conn">Connect</button>
        <button class="wa-btn" id="vc_btn_req" style="display:none">Request to speak</button>
        <button class="wa-btn" id="vc_btn_prep" style="display:none">Prepare message</button>
        <button class="wa-btn" id="vc_btn_stop" style="display:none">Stop</button>
      </div>
      <div class="vc-hint">When it’s your turn, your mic will turn on automatically. Say “stop” to finish.</div>
      <hr style="border-color:#1f2833; opacity:0.4; margin:10px 0" />
      <div style="margin-top:8px; font-weight:600;">Participants</div>
      <ul id="vc_p_list" style="margin:0; padding-left:18px"></ul>
      <div style="margin-top:10px; font-weight:600;">Speaking requests</div>
      <ul id="vc_q_list" style="margin:0; padding-left:18px"></ul>
    `;
    wrap.appendChild(form);
    try {
      myEmail = localStorage.getItem('webmeet_last_email') || localStorage.getItem('vc_email') || '';
    } catch(_){}
    const emailEl = document.getElementById('vc_reg_email');
    if (emailEl) {
      emailEl.value = myEmail;
      emailEl.readOnly = !!joined;
      emailEl.addEventListener('keydown', async (e)=>{
        if (e.key==='Enter') {
          const val=(emailEl.value||'').trim();
          if (!/^\S+@\S+\.\S+$/.test(val)) {
            showErrorPopup('Please enter a valid email address');
            emailEl.focus();
            return;
          }
          try {
            localStorage.setItem('webmeet_last_email', val);
            localStorage.setItem('vc_email', val);
          } catch(_){}
          myEmail = val;
          await postAction({ type:'hello', email: myEmail, name: myEmail });
          joined = true;
          emailEl.readOnly = true;
          updateComposerEnabled();
          renderParticipantsList();
        }
      });
    }
    const connBtn = document.getElementById('vc_btn_conn');
    if (connBtn) connBtn.onclick = async ()=>{
      if (!connected) {
        connectSSE();
        // Auto-join if we have an email
        const emailEl = document.getElementById('vc_reg_email');
        const email = emailEl?.value?.trim() || localStorage.getItem('webmeet_last_email') || localStorage.getItem('vc_email') || '';
        if (email && /^\S+@\S+\.\S+$/.test(email)) {
          myEmail = email;
          setTimeout(async () => {
            await postAction({ type:'hello', email: myEmail, name: myEmail });
            joined = true;
            if (emailEl) emailEl.readOnly = true;
            updateComposerEnabled();
            renderParticipantsList();
          }, 500);
        }
      } else {
        // If connected, disconnect
        try { if (joined) await postAction({ type:'leave' }); } catch(_){}
        joined = false;
        disconnectSSE();
      }
      updateComposerEnabled();
      renderParticipantsList();
    };
    document.getElementById('vc_btn_req').onclick = ()=> postAction({
      from: myEmail,
      to: 'moderator',
      command: 'wantToSpeak',
      text: ''
    });
    const prepBtn = document.getElementById('vc_btn_prep');
    if (prepBtn) prepBtn.onclick = ()=>{
      if (window.webMeetPopups) {
        window.webMeetPopups.showPrepOverlay();
      }
    };
    document.getElementById('vc_btn_stop').onclick = ()=> postAction({
      from: myEmail,
      to: 'moderator',
      command: 'endSpeak',
      text: ''
    });
    renderParticipantsList();
    setPanelTitleText('Participants'); sidePanel.style.display='flex'; chatContainer.classList.add('side-panel-open'); applyPanelSizeFromStorage();
  }
  sidePanelClose.onclick = ()=>{
    sidePanel.style.display='none';
    chatContainer.classList.remove('side-panel-open');
    if (chatArea) {
      chatArea.style.width = '';
      chatArea.style.flex = '';
    }
  };

  // Resizer logic
  const PANEL_SIZE_KEY = 'webchat_sidepanel_pct';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function applyPanelSize(pct){ const p=clamp(pct,20,80); if (sidePanel){ sidePanel.style.flex=`0 0 ${p}%`; sidePanel.style.maxWidth='unset'; sidePanel.style.width=`${p}%`; } if (chatArea){ const leftPct=100-p; chatArea.style.flex='0 0 auto'; chatArea.style.width=`calc(${leftPct}% - 6px)`; } }
  function applyPanelSizeFromStorage(){ try { const saved=parseFloat(localStorage.getItem(PANEL_SIZE_KEY)||'40'); applyPanelSize(Number.isFinite(saved)?saved:40); } catch(_) { applyPanelSize(40); } }
  (function initResizer(){ if (!sidePanelResizer) return; let dragging=false; let startX=0; let containerW=0; let startPanelW=0; let raf=0; let nextPct=null; function scheduleApply(p){ nextPct=p; if (raf) return; raf=requestAnimationFrame(()=>{ if (nextPct!=null) applyPanelSize(nextPct); raf=0; nextPct=null; }); } function onDown(e){ try{e.preventDefault();}catch(_){} dragging=true; chatContainer.classList.add('dragging'); startX=e.clientX; try{ sidePanelResizer.setPointerCapture(e.pointerId);}catch(_){} const rects=chatContainer.getBoundingClientRect(); containerW=rects.width; startPanelW=sidePanel.getBoundingClientRect().width; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once:true }); window.addEventListener('pointercancel', onUp, { once:true }); } function onMove(e){ if (!dragging) return; try{e.preventDefault();}catch(_){} const dx=e.clientX-startX; const newWidth=clamp(startPanelW - dx, containerW*0.2, containerW*0.8); const pct=(newWidth/containerW)*100; scheduleApply(pct); } function onUp(e){ if (!dragging) return; dragging=false; chatContainer.classList.remove('dragging'); try{ sidePanelResizer.releasePointerCapture(e.pointerId);}catch(_){} window.removeEventListener('pointermove', onMove); try { const panelRect=sidePanel.getBoundingClientRect(); const contRect=chatContainer.getBoundingClientRect(); const pct=clamp((panelRect.width/contRect.width)*100, 20,80); localStorage.setItem(PANEL_SIZE_KEY, String(pct.toFixed(1))); } catch(_){} } sidePanelResizer.addEventListener('pointerdown', onDown); })();

  // Linkify + view more
  function openSidePanel(bubble, fullText){
    const original = bubble && bubble.dataset ? bubble.dataset.originalText : null;
    if (original && original !== fullText) {
      const combined = `Current message:\n\n${fullText}\n\nOriginal submission:\n\n${original}`;
      showTextInPanel(combined);
    } else {
      showTextInPanel(fullText);
    }
  }
  function linkify(text){ const frag = document.createDocumentFragment(); const urlRe = /(https?:\/\/[\w\-._~:\/?#\[\]@!$&'()*+,;=%]+)/gi; let last = 0; let m; while ((m = urlRe.exec(text))){ const before=text.slice(last, m.index); if (before) frag.appendChild(document.createTextNode(before)); const raw=m[0]; const a=document.createElement('a'); a.href=raw; a.textContent=raw; a.title=raw; a.style.color='var(--wa-accent)'; a.style.textDecoration='underline'; a.addEventListener('click', (e)=>{ e.preventDefault(); showTextInPanel(raw); }); frag.appendChild(a); last=m.index+raw.length; } const rest=text.slice(last); if (rest) frag.appendChild(document.createTextNode(rest)); return frag; }
  function updateBubbleContent(bubble, fullText){ const lines=(fullText||'').split('\n'); const preview=lines.slice(0,6).join('\n'); const hasMore=lines.length>6; const textDiv=bubble.querySelector('.wa-message-text'); const moreDiv=bubble.querySelector('.wa-message-more'); textDiv.innerHTML=''; textDiv.appendChild(linkify(preview)); if (hasMore && !moreDiv){ const more=document.createElement('div'); more.className='wa-message-more'; more.textContent='View more'; more.onclick=()=>openSidePanel(bubble, fullText); bubble.appendChild(more); } else if (hasMore && moreDiv) { moreDiv.onclick=()=>openSidePanel(bubble, fullText); } }

  // Chat bubble helpers
  function authorLabelForSelf(){
    try { return localStorage.getItem('vc_email') || 'You'; } catch(_) { return 'You'; }
  }
  function renderChatMessage(msg, opts = {}){
    if (!msg) return;
    // Handle new JSON format
    const isSelf = msg.from === myEmail || (msg.from && msg.from.tabId === TAB_ID);
    const role = msg.role || msg.type || 'text';
    const isModerator = role === 'moderator';
    const isCommand = msg.command ? true : false;
    const isTranscript = msg.type === 'transcript';
    const isForbidden = opts.private || msg.state === 'forbidden';
    const text = String(msg.message || msg.text || '');
    // For transcript messages, show the speaker's email in the who field
    const who = isSelf ? authorLabelForSelf() : (typeof msg.from === 'string' ? msg.from : (msg.from?.email || msg.from?.name || 'Guest'));
    const moderatedBy = msg.meta && msg.meta.moderatedBy ? msg.meta.moderatedBy : null;
    const originalText = msg.meta && msg.meta.originalText ? String(msg.meta.originalText) : null;
    const moderationCommand = msg.meta && msg.meta.moderationCommand ? msg.meta.moderationCommand : null;
    const moderatorNote = msg.meta && msg.meta.moderatorNote ? msg.meta.moderatorNote : null;
    const moderatorReason = msg.meta && msg.meta.moderatorReason ? msg.meta.moderatorReason : null;

    const msgDiv=document.createElement('div');
    msgDiv.className='wa-message ' + (isSelf ? 'out' : 'in');
    if (isModerator) msgDiv.classList.add('moderator');
    if (isCommand) msgDiv.classList.add('command');
    if (isForbidden) msgDiv.classList.add('forbidden');
    if (isTranscript) msgDiv.classList.add('transcript');

    const bubble=document.createElement('div');
    bubble.className='wa-message-bubble';
    if (isModerator) bubble.classList.add('is-moderator');
    if (isCommand) bubble.classList.add('is-command');
    if (isTranscript) bubble.classList.add('is-transcript');
    if (isForbidden) bubble.classList.add('is-forbidden');
    if (moderatedBy) bubble.classList.add('moderated');
    bubble.innerHTML='<div class="wa-message-author"></div><div class="wa-message-text"></div><span class="wa-message-time"></span>';

    if (!isSelf) {
      msgDiv.appendChild(bubble);
      if (window.webMeetAudio) {
        const ttsBtn = window.webMeetAudio.createTTSButton(text);
        msgDiv.appendChild(ttsBtn);
      }
    } else {
      msgDiv.appendChild(bubble);
    }

    bubble.querySelector('.wa-message-author').textContent = who;
    const textWrapper = bubble.querySelector('.wa-message-text');
    if (moderatedBy) {
      const note = document.createElement('div');
      note.className = 'wa-moderation-note';
      const parts = [`Moderated by ${moderatedBy}`];
      if (moderationCommand && moderationCommand !== 'allow') parts.push(`(${moderationCommand})`);
      if (originalText && originalText !== text) parts.push('• text updated');
      note.textContent = parts.join(' ');
      bubble.insertBefore(note, textWrapper);
      if (moderatorNote || moderatorReason) {
        const detail = document.createElement('div');
        detail.className = 'wa-moderation-detail';
        detail.textContent = moderatorNote || moderatorReason;
        bubble.insertBefore(detail, textWrapper);
      }
    }
    updateBubbleContent(bubble, text);
    if (originalText && originalText !== text) {
      bubble.dataset.originalText = originalText;
    }
    const ts = msg.ts ? new Date(msg.ts) : new Date();
    const hh = String(ts.getHours()).padStart(2,'0');
    const mm = String(ts.getMinutes()).padStart(2,'0');
    bubble.querySelector('.wa-message-time').textContent = `${hh}:${mm}`;

    chatList.appendChild(msgDiv);
    chatList.scrollTop=chatList.scrollHeight;

    if (isSelf) lastOutgoingBubble = bubble;
    else { lastIncomingBubble = bubble; lastIncomingText = text; }
  }

  // Composer
  function autoResize(){ try { cmdInput.style.height='auto'; cmdInput.style.height = Math.min(140, cmdInput.scrollHeight) + 'px'; } catch(_){} }
  function updateComposerEnabled(){ 
    const en = joined && connected; 
    try { 
      cmdInput.disabled = !en; 
      sendBtn.disabled = !en;
      sendBtn.style.display = en ? 'flex' : 'none';
      if (footerPrepareBtn) {
        footerPrepareBtn.disabled = !en;
        footerPrepareBtn.style.opacity = en ? '1' : '0.5';
      }
    } catch(_){} 
    try { 
      if (en) {
        cmdInput.placeholder = 'Type a message';
      } else if (connected && !joined) {
        cmdInput.placeholder = 'Enter email in Status panel and press Enter to join';
      } else {
        cmdInput.placeholder = 'Press Connect button to start';
      }
    } catch(_){} 
  }
  function updateConnectionUI(){
    try {
      disconnectMask.style.display = connected ? 'none' : 'block';
      disconnectMask.classList.toggle('show', !connected);
    } catch(_){}
  }
  // Demo functionality now managed by showdemo.js
  cmdInput.addEventListener('input', autoResize);
  function sendText(){
    if (!joined) return;
    const t = (cmdInput.value||'').trim();
    if (!t) return;
    cmdInput.value='';
    autoResize();
    // Send message in new JSON format
    const message = {
      from: myEmail,
      to: 'all',
      command: 'broadcast',
      text: t
    };
    postAction(message).catch(()=>{});
  }
  sendBtn.onclick = (e)=>{ e.preventDefault(); sendText(); };
  cmdInput.addEventListener('keydown', (e)=>{ if (!joined) { if (e.key==='Enter') e.preventDefault(); return; } if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
  // Prepare overlay functionality now managed by popups.js
  // Prepare overlay handlers now managed by popups.js

  // Helper function to show error popup
  function showErrorPopup(message) {
    const popup = document.createElement('div');
    popup.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #dc3545;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      animation: fadeIn 0.2s ease-in;
    `;
    popup.textContent = message;
    document.body.appendChild(popup);
    setTimeout(() => {
      popup.style.animation = 'fadeOut 0.2s ease-out';
      setTimeout(() => popup.remove(), 200);
    }, 3000);
  }

  // Add CSS animations if not already present
  if (!document.getElementById('webmeet-animations')) {
    const style = document.createElement('style');
    style.id = 'webmeet-animations';
    style.textContent = `
      @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -45%); } to { opacity: 1; transform: translate(-50%, -50%); } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    `;
    document.head.appendChild(style);
  }

  // Participants modal/panel
  const participantsPanel = document.getElementById('participantsPanel');
  const vcEmailInput = document.getElementById('vc_email_input');
  const vcConnectBtn = document.getElementById('vc_connect_btn');
  const vcMicBtn = document.getElementById('vc_mic_btn');
  const vcPrepareBtn = document.getElementById('vc_prepare_btn');
  const vcDeafenBtn = document.getElementById('vc_deafen_btn');
  const vcParticipantsList = document.getElementById('vc_participants_list');
  const participantsToggle = document.getElementById('participantsToggle');
  const footerPrepareBtn = document.getElementById('footerPrepareBtn');
  
  
  
  // Setup persistent panel controls if they exist
  if (vcConnectBtn) {
    vcConnectBtn.onclick = async ()=>{
      if (!connected) {
        // User wants to connect
        connectSSE();
      } else {
        // User wants to disconnect
        try { if (joined) await postAction({ type:'leave' }); } catch(_){}
        joined = false;
        disconnectSSE();
      }
    };
  }
  
  if (vcEmailInput) {
    // Load last used email from localStorage
    try {
      const savedEmail = localStorage.getItem('webmeet_last_email') || '';
      if (savedEmail) vcEmailInput.value = savedEmail;
    } catch(_){}

    vcEmailInput.addEventListener('keydown', async (e)=>{
      if (e.key==='Enter') {
        if (joined) return; // Don't re-join
        if (!connected) {
          showErrorPopup('Please press the Connect button first.');
          return;
        }
        const val=(vcEmailInput.value||'').trim();
        if (!/^\S+@\S+\.\S+$/.test(val)) {
          showErrorPopup('Please enter a valid email address');
          vcEmailInput.focus();
          return;
        }
        // Save email to localStorage for next time
        try {
          localStorage.setItem('webmeet_last_email', val);
          localStorage.setItem('vc_email', val); // Keep backward compatibility
        } catch(_){}
        myEmail = val;
        
        // Perform the join action
        const joinResult = await postAction({ type:'hello', email: myEmail, name: myEmail });
        if (joinResult && joinResult.ok !== false) {
          joined = true;
          vcEmailInput.readOnly = true;
          console.log('Manual join successful');
        } else {
          joined = false;
          console.log('Manual join failed:', joinResult);
          alert('Failed to join. Please try again.');
        }
        updateComposerEnabled();
        renderParticipantsList();
      }
    });
  }
  
  // Setup toolbar buttons
  if (vcMicBtn) vcMicBtn.onclick = ()=> {
    // Send request to speak as JSON command to moderator
    postAction({
      from: myEmail,
      to: 'moderator',
      command: 'wantToSpeak',
      text: ''
    });
  };
  if (vcPrepareBtn) vcPrepareBtn.onclick = ()=>{
    if (window.webMeetPopups) {
      window.webMeetPopups.showPrepOverlay();
    }
  };
  
  // Deafen button - mutes all incoming audio
  if (vcDeafenBtn) vcDeafenBtn.onclick = ()=>{
    isDeafened = !isDeafened;
    if (isDeafened) {
      vcDeafenBtn.classList.add('active', 'danger');
      vcDeafenBtn.title = 'Undeafen (unmute incoming audio)';
      // Mute all existing audio elements
      document.querySelectorAll('audio').forEach(audio => {
        audio.muted = true;
      });
    } else {
      vcDeafenBtn.classList.remove('active', 'danger');
      vcDeafenBtn.title = 'Deafen (mute incoming audio)';
      // Unmute all audio elements
      document.querySelectorAll('audio').forEach(audio => {
        audio.muted = false;
      });
    }
  };
  
  

  function renderParticipantsList(){
    // Update panel title based on state
    const panelTitle = document.getElementById('participantsPanelTitle');
    if (panelTitle) {
      if (joined) {
        panelTitle.textContent = 'Joined';
      } else {
        panelTitle.textContent = 'Register';
      }
    }

    // Get all UI elements that need updating
    const pList = document.getElementById('vc_participants_list');
    const qList = document.getElementById('vc_queue_list');

    // Update participant list
    if (pList) {
      pList.innerHTML='';
      participants.forEach(p => {
        const div = document.createElement('div');
        div.className = 'wa-participant-item';

        // Check if participant is in the queue and get their position
        const queuePosition = queue.indexOf(p.email || p.name || p.tabId);
        const queueNumber = queuePosition >= 0 ? `[${queuePosition + 1}] ` : '';

        const isYou = p.tabId === TAB_ID || p.email === myEmail ? ' (you)' : '';
        const isSpeaking = (typeof currentSpeaker === 'string' && p.email === currentSpeaker) ||
                          p.tabId === currentSpeaker ?
                          '<span class="wa-speaking-icon" title="Speaking">🔊</span>' : '';

        div.innerHTML = `<span class="wa-participant-name">${queueNumber}${p.name || p.email || 'Guest'}${isYou}</span><span class="wa-participant-icons">${isSpeaking}</span>`;
        pList.appendChild(div);
      });
    }
    
    // Update queue list
    if (qList) {
      qList.innerHTML='';
      if (queue.length === 0) {
        qList.innerHTML = '<div class="vc-hint" style="padding: 8px;">Nobody in queue.</div>';
      } else {
        queue.forEach((email, idx) => {
          // Find participant by email
          const p = participants.find(x => x.email === email || x.name === email);
          const div = document.createElement('div');
          div.className = 'wa-participant-item';
          const displayName = p ? (p.name || p.email) : email;
          const isYou = email === myEmail ? ' (you)' : '';
          div.innerHTML = `<span class="wa-participant-name"><span class="wa-queue-icon">✋</span> ${idx + 1}. ${displayName}${isYou}</span>`;
          qList.appendChild(div);
        });
      }
    }
    
    // Update buttons in the panel
    if (vcConnectBtn) {
      // Use same power icon for both states, only tooltip changes
      vcConnectBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.71.62-3.28 1.58-4.42L5.17 5.17A8.932 8.932 0 0 0 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.49-1.01-4.73-2.67-6.33z"/></svg>';
      if (!connected) {
        vcConnectBtn.title = 'Connect';
        vcConnectBtn.classList.remove('danger', 'active');
      } else { // We are connected
        vcConnectBtn.title = 'Disconnect';
        vcConnectBtn.classList.add('danger', 'active');
      }
    }
    
    // Update button visibility based on connection state
    if (vcMicBtn) {
      vcMicBtn.style.display = (connected && joined) ? 'flex' : 'none';
      // Disable if we're speaking or already in queue
      const inQueue = queue.includes(myEmail);
      const isSpeaking = currentSpeaker === TAB_ID || currentSpeaker === myEmail;
      vcMicBtn.disabled = !joined || !connected || isSpeaking || inQueue;

      if (inQueue) {
        vcMicBtn.classList.add('active');
        vcMicBtn.title = 'Already in queue';
      } else {
        vcMicBtn.classList.remove('active');
        vcMicBtn.title = 'Request to speak';
      }
    }
    if (vcPrepareBtn) {
      vcPrepareBtn.style.display = (connected && joined) ? 'flex' : 'none';
      vcPrepareBtn.disabled = !joined || !connected;
    }
    if (vcDeafenBtn) {
      vcDeafenBtn.style.display = (connected && joined) ? 'flex' : 'none';
    }
    if (vcEmailInput) {
      vcEmailInput.readOnly = !!joined;
    }
    
    // Check if we're actually in the participants list and fix state if needed
    const isParticipant = participants.some(p => p.tabId === TAB_ID);
    if (isParticipant && !joined) {
      console.log('Fixing joined state - found in participants');
      joined = true;
      if (vcEmailInput) vcEmailInput.readOnly = true;
      updateComposerEnabled();
    }
    
    // Update main header status
    if (!connected) {
      statusEl.textContent = 'offline';
      statusDot.className = 'wa-status-dot offline';
    } else { // is connected
      statusDot.className = 'wa-status-dot online';
      if (!joined) {
        statusEl.textContent = 'Connected - Enter email to join';
      } else if (currentSpeaker === TAB_ID || currentSpeaker === myEmail) {
        statusEl.textContent = 'online — You are speaking';
      } else if (currentSpeaker === 'none' || !currentSpeaker) {
        statusEl.textContent = 'online — Nobody is speaking';
      } else if (typeof currentSpeaker === 'string') {
        // currentSpeaker is an email
        const cur = participants.find(p => p.email === currentSpeaker);
        statusEl.textContent = `online — ${cur ? (cur.name || cur.email) : currentSpeaker} is speaking`;
      } else {
        // Legacy: currentSpeaker might be a tabId
        const cur = participants.find(p => p.tabId === currentSpeaker);
        statusEl.textContent = cur ? `online — ${cur.name || cur.email} is speaking` : 'online';
      }
    }
  }

  // SSE
  function connectSSE(){
    // Don't create multiple connections
    if (esConn && esConn.readyState !== EventSource.CLOSED) {
      console.log('[WebMeet] SSE already connected or connecting');
      return;
    }
    if (esConn) { try { esConn.close(); } catch(_){} }

    console.log('[WebMeet] Establishing SSE connection...');
    const es = new EventSource(`events?tabId=${encodeURIComponent(TAB_ID)}`);
    esConn = es;
    es.addEventListener('open', async () => {
      connected = true;
      if (window.webMeetDemo) {
        window.webMeetDemo.setConnected(true);
        window.webMeetDemo.stopDemo();
      }
      chatList.innerHTML='';
      updateConnectionUI();
      const email = vcEmailInput?.value?.trim() || localStorage.getItem('vc_email') || '';
      if (email && /^\S+@\S+\.\S+$/.test(email)) {
        myEmail = email;
        console.log('Auto-joining with email:', myEmail);
        const joinResult = await postAction({ type:'hello', email: myEmail, name: myEmail });
        if (joinResult && joinResult.ok !== false) {
          joined = true; 
          if (vcEmailInput) vcEmailInput.readOnly = true;
          console.log('Joined successfully');
        } else {
          joined = false;
          console.log('Failed to join:', joinResult);
        }
      } else {
        console.log('No email found for auto-join, user needs to enter email');
        joined = false;
      }
      updateComposerEnabled(); 
      renderParticipantsList();
      try { if (pingTimer) clearInterval(pingTimer); } catch(_){}
      // Ping every 30 seconds instead of 5 seconds
      try {
        pingTimer = setInterval(async ()=>{
          try {
            const result = await postAction({ type:'ping' });
            if (result.ok) {
              // Ping successful, ensure we're shown as online
              if (!connected) {
                connected = true;
                updateConnectionUI();
                renderParticipantsList();
              }
            }
          } catch(err) {
            // Ping failed, mark as disconnected
            console.error('[WebMeet] Ping failed:', err);
            handleDisconnect();
          }
        }, 30000); // 30 seconds
      } catch(_){}
    });
    es.addEventListener('init', (ev)=>{
      const data = JSON.parse(ev.data||'{}');
      participants = data.participants||[]; queue = data.queue||[]; currentSpeaker = data.currentSpeaker||null;
      const combined = [...(data.history||[]), ...(data.privateHistory||[])];
      combined.sort((a,b) => (a.ts||0) - (b.ts||0));
      combined.forEach(m => renderChatMessage(m, { private: m.state === 'forbidden' }));
      renderParticipantsList(); statusEl.textContent='online'; statusDot.classList.remove('offline'); statusDot.classList.add('online');
      showBanner('Connected','ok'); setTimeout(hideBanner, 700);
    });
    es.addEventListener('participant_join', (ev)=>{ const { participant } = JSON.parse(ev.data||'{}'); if (participant && !participants.find(p=>p.tabId===participant.tabId)) participants.push(participant); renderParticipantsList(); });
    es.addEventListener('participant_leave', (ev)=>{ const { tabId } = JSON.parse(ev.data||'{}'); participants = participants.filter(p=>p.tabId!==tabId); renderParticipantsList(); });
    es.addEventListener('queue', (ev)=>{ const { queue:q } = JSON.parse(ev.data||'{}'); queue = q||[]; renderParticipantsList(); });
    es.addEventListener('current_speaker', (ev)=>{
      const { tabId } = JSON.parse(ev.data||'{}');
      currentSpeaker = tabId||null;
      if (currentSpeaker !== TAB_ID) {
        if (window.webMeetWebRTC) window.webMeetWebRTC.stopMic();
        if (window.webMeetPopups) window.webMeetPopups.hideSpeakOverlay();
        speakMode='prep';
      }
      renderParticipantsList();
    });
    // Keep old start_speaking listener for backward compatibility
    es.addEventListener('start_speaking', (ev)=>{
      const { targets } = JSON.parse(ev.data||'{}');
      if (currentSpeaker === TAB_ID) {
        handleStartSpeaking(targets);
      }
    });
    es.addEventListener('chat', (ev)=>{
      const msg = JSON.parse(ev.data||'{}');
      // Check if this is a moderator command
      if (msg.from === 'moderator' && msg.command === 'speak') {
        // Update current speaker and queue from moderator message
        currentSpeaker = msg.who === myEmail ? TAB_ID : (msg.who || 'none');
        queue = msg.waiting || [];

        if (msg.who === myEmail) {
          // It's our turn to speak!
          handleStartSpeaking();
        } else if (currentSpeaker === TAB_ID && msg.who !== myEmail) {
          // We were speaking but now someone else is
          if (window.webMeetWebRTC) window.webMeetWebRTC.stopMic();
          if (window.webMeetPopups) window.webMeetPopups.hideSpeakOverlay();
          speakMode = 'prep';
        }

        renderParticipantsList();
      } else {
        renderChatMessage(msg);
      }
    });
    es.addEventListener('chat_private', (ev)=>{ const msg = JSON.parse(ev.data||'{}'); renderChatMessage(msg, { private: true }); });
    es.addEventListener('signal', (ev)=>{ const { from, payload } = JSON.parse(ev.data||'{}'); onSignal(from, payload); });
    es.onerror = (err)=>{
      console.error('[WebMeet] SSE error:', err);
      handleDisconnect();
    };

    es.onclose = ()=>{
      console.log('[WebMeet] SSE connection closed');
      handleDisconnect();
    };
    return es;
  }
  function disconnectSSE(){
    try { esConn?.close?.(); } catch(_){}
    esConn = null;
    connected = false;
    joined = false;
    try { if (pingTimer) clearInterval(pingTimer); } catch(_){}
    pingTimer = null;
    try {
      statusEl.textContent='offline';
      statusDot.classList.remove('online');
      statusDot.classList.add('offline');
    } catch(_){}
    updateConnectionUI();
    updateComposerEnabled();
    renderParticipantsList();
    if (window.webMeetDemo) {
      window.webMeetDemo.setConnected(false);
      window.webMeetDemo.startDemo();
    }
  }

  // Handle unexpected disconnection
  function handleDisconnect() {
    if (connected) {
      connected = false;
      console.log('[WebMeet] Connection lost');
      try {
        statusEl.textContent='offline - connection lost';
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
      } catch(_){}
      updateConnectionUI();
      updateComposerEnabled();
      renderParticipantsList();

      // Try to reconnect SSE if it's not already trying
      if (esConn && esConn.readyState === EventSource.CLOSED) {
        console.log('[WebMeet] Attempting to reconnect...');
        setTimeout(() => {
          if (!connected) { // Only reconnect if still disconnected
            disconnectSSE();
            connectSSE();
          }
        }, 5000); // Wait 5 seconds before reconnecting
      }
    }
  }

  async function postAction(payload){
    payload.tabId = TAB_ID;
    // Add email if it's a command-based message
    if (payload.command && !payload.from) {
      payload.from = myEmail;
    }
    // Only log non-ping messages
    if (payload.type !== 'ping') {
      console.log('[WebMeet] Sending:', payload);
    }

    try {
      const res = await fetch('action', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch(err) {
      console.error('[WebMeet] Request failed:', err);
      // If we can't reach the server, mark as disconnected
      if (payload.type !== 'ping') { // Don't disconnect on every ping fail
        handleDisconnect();
      }
      throw err; // Re-throw to let caller handle it
    }
  }

  // Handle when we get permission to speak
  function handleStartSpeaking(targets) {
    // Transfer text from prepare overlay if it's open
    let transferredText = '';
    if (window.webMeetPopups) {
      transferredText = window.webMeetPopups.getPreparedText();
      window.webMeetPopups.hidePrepOverlay();
    }

    try { showBanner("It's your turn to speak", 'ok'); setTimeout(hideBanner, 1200); } catch(_){}

    if (window.webMeetWebRTC) {
      window.webMeetWebRTC.setLiveTargets(targets||[]);
    }
    speakMode='prep';

    if (window.webMeetPopups) {
      window.webMeetPopups.showSpeakOverlay(transferredText);
    }

    // Delay STT start slightly to avoid picking up any system sounds
    setTimeout(async ()=>{
      try {
        if (window.webMeetWebRTC) await window.webMeetWebRTC.startMic();
        if (window.webMeetAudio) {
          const speakText = document.getElementById('speakText');
          window.webMeetAudio.startSTT(speakText);
        }
      } catch(e) {
        alert('Microphone access denied');
      }
    }, 500);
  }

  // Speak overlay controls now managed by popups.js

  // WebRTC functionality now managed by webrtc-room.js
  // Footer prepare button
  if (footerPrepareBtn) {
    footerPrepareBtn.onclick = ()=>{
      if (joined && connected && window.webMeetPopups) {
        window.webMeetPopups.showPrepOverlay();
      }
    };
  }
  // STT functionality now managed by audio.js

  // Start disconnected; user must press Connect
  updateConnectionUI();
  if (window.webMeetDemo) {
    window.webMeetDemo.startDemo();
  }
  try { if (!myEmail) { myEmail = localStorage.getItem('vc_email')||''; } } catch(_) {}

  // Export client instance for modules to use
  window.webMeetClient = {
    TAB_ID,
    joined,
    connected,
    isDeafened,
    myEmail,
    speakMode,
    postAction
  };

  updateComposerEnabled();

  // Update client object when state changes
  const originalUpdateComposerEnabled = updateComposerEnabled;
  updateComposerEnabled = function() {
    originalUpdateComposerEnabled();
    if (window.webMeetClient) {
      window.webMeetClient.joined = joined;
      window.webMeetClient.connected = connected;
    }
  };
  // Show participants panel by default on desktop; ensure Full Message panel is hidden
  if (participantsPanel && window.innerWidth > 768) {
    participantsPanel.classList.add('show');
    if (sidePanel) {
      sidePanel.style.display = 'none';
      chatContainer.classList.remove('side-panel-open');
    }
  }
  // Refresh participants/queue view periodically
  setInterval(()=>{ try { renderParticipantsList(); } catch(_){} }, 1000);

  
  // Toggle participants panel
  if (participantsToggle) {
    participantsToggle.onclick = () => {
      if (participantsPanel) {
        // Hide side panel if it's open
        if (sidePanel && currentPanelMode === 'fullmessage') {
          sidePanel.style.display = 'none';
          chatContainer.classList.remove('side-panel-open');
        }
        participantsPanel.classList.toggle('show');
      }
    };
  }
  
  // Close panel when clicking outside on mobile
  if (window.innerWidth <= 768) {
    document.addEventListener('click', (e) => {
      if (participantsPanel && participantsPanel.classList.contains('show')) {
        if (!participantsPanel.contains(e.target) && e.target !== participantsToggle) {
          participantsPanel.classList.remove('show');
        }
      }
    });
  }
})();
