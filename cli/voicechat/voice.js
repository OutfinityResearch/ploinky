(() => {
  const dlog = (...a) => console.log('[voice]', ...a);
  const TAB_ID = (()=>{ try { let v = sessionStorage.getItem('vc_tab'); if (!v) { v = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); sessionStorage.setItem('vc_tab', v); } return v; } catch(_) { return String(Math.random()).slice(2); } })();

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
  const prepOverlay = document.getElementById('prepOverlay');
  const prepText = document.getElementById('prepText');
  const prepSend = document.getElementById('prepSend');
  const prepCancel = document.getElementById('prepCancel');
  const chatContainer = document.getElementById('chatContainer');
  const chatArea = document.getElementById('chatArea');
  const sidePanel = document.getElementById('sidePanel');
  const sidePanelContent = document.getElementById('sidePanelContent');
  const sidePanelClose = document.getElementById('sidePanelClose');
  const sidePanelTitle = document.querySelector('.wa-side-panel-title');
  const sidePanelResizer = document.getElementById('sidePanelResizer');
  const speakOverlay = document.getElementById('speakOverlay');
  const speakText = document.getElementById('speakText');
  const speakLang = document.getElementById('speakLang');
  const speakSend = document.getElementById('speakSend');
  const speakLive = document.getElementById('speakLive');
  const speakStop = document.getElementById('speakStop');
  const speakCancel = document.getElementById('speakCancel');
  const speakTitle = document.getElementById('speakTitle');
  const speakRequestBtn = document.getElementById('speakRequestBtn');
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
  let liveTargets = [];
  let sttLang = localStorage.getItem('vc_stt_lang') || 'en-US';
  let pingTimer = null;
  let isDeafened = false; // State for muting incoming audio

  // Theme
  function getTheme() { return localStorage.getItem('webtty_theme') || 'dark'; }
  function setTheme(t) { document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); }
  themeToggle.onclick = () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); };
  setTheme(getTheme());
  titleBar.textContent = 'VoiceChat';
  (async () => { if (requiresAuth && !(await fetch('/whoami').then(r => r.ok).catch(()=>false))) location.href = '/'; })();

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
    try { myEmail = localStorage.getItem('vc_email')||''; } catch(_){}
    const emailEl = document.getElementById('vc_reg_email');
    if (emailEl) {
      emailEl.value = myEmail;
      emailEl.readOnly = !!joined;
      emailEl.addEventListener('keydown', async (e)=>{
        if (e.key==='Enter') {
          const val=(emailEl.value||'').trim();
          if (!/^\S+@\S+\.\S+$/.test(val)) { alert('Please enter a valid email'); return; }
          try { localStorage.setItem('vc_email', val); } catch(_){}
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
        const email = emailEl?.value?.trim() || localStorage.getItem('vc_email') || '';
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
    document.getElementById('vc_btn_req').onclick = ()=> postAction({ type:'request_speak' });
    const prepBtn = document.getElementById('vc_btn_prep'); if (prepBtn) prepBtn.onclick = ()=>{ try { prepText.value = ''; } catch(_){} try { prepOverlay.style.display='block'; } catch(_){} };
    document.getElementById('vc_btn_stop').onclick = ()=> postAction({ type:'stop_speaking' });
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
  function openSidePanel(bubble, fullText){ showTextInPanel(fullText); }
  function linkify(text){ const frag = document.createDocumentFragment(); const urlRe = /(https?:\/\/[\w\-._~:\/?#\[\]@!$&'()*+,;=%]+)/gi; let last = 0; let m; while ((m = urlRe.exec(text))){ const before=text.slice(last, m.index); if (before) frag.appendChild(document.createTextNode(before)); const raw=m[0]; const a=document.createElement('a'); a.href=raw; a.textContent=raw; a.title=raw; a.style.color='var(--wa-accent)'; a.style.textDecoration='underline'; a.addEventListener('click', (e)=>{ e.preventDefault(); showTextInPanel(raw); }); frag.appendChild(a); last=m.index+raw.length; } const rest=text.slice(last); if (rest) frag.appendChild(document.createTextNode(rest)); return frag; }
  function updateBubbleContent(bubble, fullText){ const lines=(fullText||'').split('\n'); const preview=lines.slice(0,6).join('\n'); const hasMore=lines.length>6; const textDiv=bubble.querySelector('.wa-message-text'); const moreDiv=bubble.querySelector('.wa-message-more'); textDiv.innerHTML=''; textDiv.appendChild(linkify(preview)); if (hasMore && !moreDiv){ const more=document.createElement('div'); more.className='wa-message-more'; more.textContent='View more'; more.onclick=()=>openSidePanel(bubble, fullText); bubble.appendChild(more); } else if (hasMore && moreDiv) { moreDiv.onclick=()=>openSidePanel(bubble, fullText); } }

  // Chat bubble helpers
  function authorLabelForSelf(){
    try { return localStorage.getItem('vc_email') || 'You'; } catch(_) { return 'You'; }
  }
  function addOutgoing(text){
    const msgDiv=document.createElement('div'); msgDiv.className='wa-message out';
    const bubble=document.createElement('div'); bubble.className='wa-message-bubble';
    bubble.innerHTML='<div class="wa-message-author"></div><div class="wa-message-text"></div><span class="wa-message-time"></span>';
    msgDiv.appendChild(bubble);
    bubble.querySelector('.wa-message-author').textContent = authorLabelForSelf();
    updateBubbleContent(bubble, text);
    bubble.querySelector('.wa-message-time').textContent = formatTime();
    chatList.appendChild(msgDiv);
    chatList.scrollTop=chatList.scrollHeight;
    lastOutgoingBubble = bubble;
  }
  function addIncoming(text, who){
    const msgDiv=document.createElement('div');
    msgDiv.className='wa-message in';

    const bubble=document.createElement('div');
    bubble.className='wa-message-bubble';
    bubble.innerHTML='<div class="wa-message-author"></div><div class="wa-message-text"></div><span class="wa-message-time"></span>';

    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'wa-tts-btn';
    ttsBtn.title = 'Read aloud';
    ttsBtn.innerHTML = '🔈';
    ttsBtn.onclick = ()=>{ 
      try { 
        const u=new SpeechSynthesisUtterance(text); 
        // Use the currently selected language
        const currentLang = document.getElementById('speakLang')?.value || 
                           document.getElementById('prepLang')?.value || 
                           sttLang || 'en-US';
        u.lang = currentLang; 
        speechSynthesis.speak(u);
      } catch(_){} 
    };

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(ttsBtn);

    bubble.querySelector('.wa-message-author').textContent = who || 'Guest';
    updateBubbleContent(bubble, text);
    bubble.querySelector('.wa-message-time').textContent = formatTime();
    
    chatList.appendChild(msgDiv);
    chatList.scrollTop=chatList.scrollHeight;
    lastIncomingBubble = bubble; lastIncomingText = text;
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
  function updateConnectionUI(){ try { disconnectMask.style.display = connected ? 'none' : 'block'; disconnectMask.classList.toggle('show', !connected); } catch(_){} }
  let demoTimer = null; let demoIndex = 0; let demoScript = [];
  async function startDemo(){
    try {
      if (connected || demoTimer) return;
      const r = await fetch('/demo').then(r=>r.json()).catch(()=>null);
      demoScript = (r && r.script) ? r.script : [];
      chatList.innerHTML = '';
      demoIndex = 0;
      const playOne = () => {
        if (connected) { stopDemo(); return; }
        const item = demoScript[demoIndex % (demoScript.length||1)] || { who:'User', text:'...' };
        const who = item?.who || 'User'; const text = item?.text || '';
        const msgDiv=document.createElement('div'); msgDiv.className='wa-message in vc-demo';
        const bubble=document.createElement('div'); bubble.className='wa-message-bubble';
        bubble.innerHTML='<div class="wa-message-author"></div><div class="wa-message-text"></div><span class="wa-message-time"></span>';
        msgDiv.appendChild(bubble);
        bubble.querySelector('.wa-message-author').textContent = who;
        bubble.querySelector('.wa-message-text').textContent = text;
        bubble.querySelector('.wa-message-time').textContent = formatTime();
        chatList.appendChild(msgDiv);
        chatList.scrollTop = chatList.scrollHeight;
        demoIndex++;
        const delay = Math.max(600, Math.min(3000, item?.delayMs || 1200));
        demoTimer = setTimeout(playOne, delay);
      };
      demoTimer = setTimeout(playOne, 400);
    } catch(_){}
  }
  function stopDemo(){ try { clearTimeout(demoTimer); } catch(_){} demoTimer=null; }
  cmdInput.addEventListener('input', autoResize);
  function sendText(){ if (!joined) return; const t = (cmdInput.value||'').trim(); if (!t) return; cmdInput.value=''; autoResize(); postAction({ type:'chat', text: t }).catch(()=>{}); }
  sendBtn.onclick = (e)=>{ e.preventDefault(); sendText(); };
  cmdInput.addEventListener('keydown', (e)=>{ if (!joined) { if (e.key==='Enter') e.preventDefault(); return; } if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
  // Prepare overlay is opened from Participants button (vc_btn_prep)
  const prepEnableSTT = document.getElementById('prepEnableSTT');
  const prepRecord = document.getElementById('prepRecord');
  const prepStatus = document.getElementById('prepStatus');
  let prepRecognition = null;
  let prepRecording = false;
  let finalTranscript = '';
  let prepFinalTranscript = ''; // Separate transcript for prepare overlay
  
  if (prepRecord) prepRecord.onclick = ()=>{
    if (!prepRecording) {
      // Start recording
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { alert('Speech recognition not supported'); return; }
      if (!prepEnableSTT?.checked) return;

      prepFinalTranscript = ''; // Always start fresh
      prepRecognition = new SR();
      // Always get the current selected language from the dropdown
      const currentPrepLang = document.getElementById('prepLang')?.value || sttLang || 'en-US';
      prepRecognition.lang = currentPrepLang;
      prepRecognition.continuous = true;
      prepRecognition.interimResults = true;
      prepRecognition.onresult = (event) => {
        let interim_transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            prepFinalTranscript += event.results[i][0].transcript + ' ';
          } else {
            interim_transcript += event.results[i][0].transcript;
          }
        }
        prepText.value = prepFinalTranscript + interim_transcript;
      };
      prepRecognition.onerror = (e)=>{ prepStatus.textContent = `Error: ${e.error}`; };
      prepRecognition.onend = ()=>{
        // Don't save old transcript
        prepRecording = false;
        prepRecord.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>';
        prepRecord.title = 'Start Recording';
        prepRecord.classList.remove('active', 'danger');
        prepStatus.textContent = 'Ready';
      };
      
      try {
        prepRecognition.start();
        prepRecording = true;
        prepRecord.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>';
        prepRecord.title = 'Stop Recording';
        prepRecord.classList.add('active', 'danger');
        prepStatus.textContent = 'Listening...';
      } catch(e){ alert(`Could not start STT: ${e.message}`); }
    } else {
      // Stop recording
      try { prepRecognition?.stop?.(); } catch(_){}
      // onend will handle the rest of the state change
    }
  };
  
  if (prepCancel) prepCancel.onclick = ()=>{ 
    try { prepRecognition?.stop?.(); } catch(_){}
    prepRecording = false;
    try { prepOverlay.style.display='none'; } catch(_){} 
  };
  if (prepSend) prepSend.onclick = async ()=>{ 
    try { prepRecognition?.stop?.(); } catch(_){}
    prepRecording = false;
    const t=(prepText?.value||'').trim(); 
    if (t && joined) { await postAction({ type:'chat', text: t }); } 
    try { 
      prepOverlay.style.display='none'; 
      prepText.value = ''; // Clear the text
      prepFinalTranscript = ''; // Reset prep transcript
    } catch(_){} 
  };

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
    try { vcEmailInput.value = localStorage.getItem('vc_email')||''; } catch(_){}
    vcEmailInput.addEventListener('keydown', async (e)=>{
      if (e.key==='Enter') {
        if (joined) return; // Don't re-join
        if (!connected) {
          alert('Please press the Connect button first.');
          return;
        }
        const val=(vcEmailInput.value||'').trim();
        if (!/^\S+@\S+\.\S+$/.test(val)) { alert('Please enter a valid email'); return; }
        try { localStorage.setItem('vc_email', val); } catch(_){}
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
    if (!queue.includes(TAB_ID)) {
      queue.push(TAB_ID);
      renderParticipantsList();
    }
    postAction({ type:'request_speak' });
  };
  if (vcPrepareBtn) vcPrepareBtn.onclick = ()=>{ 
    try { prepText.value = ''; } catch(_){} 
    try { prepOverlay.style.display='block'; } catch(_){} 
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
    // Get all UI elements that need updating
    const pList = document.getElementById('vc_participants_list');
    const qList = document.getElementById('vc_queue_list');
    
    // Update participant list
    if (pList) {
      pList.innerHTML=''; 
      participants.forEach(p => {
        const div = document.createElement('div');
        div.className = 'wa-participant-item';
        const isYou = p.tabId === TAB_ID ? ' (you)' : '';
        const isSpeaking = p.tabId === currentSpeaker ? '<span class="wa-speaking-icon" title="Speaking">🔊</span>' : '';
        div.innerHTML = `<span class="wa-participant-name">${p.name}${isYou}</span><span class="wa-participant-icons">${isSpeaking}</span>`;
        pList.appendChild(div);
      });
    }
    
    // Update queue list
    if (qList) {
      qList.innerHTML='';
      if (queue.length === 0) {
        qList.innerHTML = '<div class="vc-hint" style="padding: 8px;">Nobody in queue.</div>';
      } else {
        queue.forEach((id, idx) => {
          const p = participants.find(x => x.tabId === id);
          const div = document.createElement('div');
          div.className = 'wa-participant-item';
          div.innerHTML = `<span class="wa-participant-name"><span class="wa-queue-icon">✋</span> ${idx + 1}. ${p ? p.name : 'Unknown'}</span>`;
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
      vcMicBtn.disabled = !joined || !connected || (currentSpeaker === TAB_ID) || queue.includes(TAB_ID);
      if (queue.includes(TAB_ID)) {
        vcMicBtn.classList.add('active');
      } else {
        vcMicBtn.classList.remove('active');
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
    const cur = participants.find(p => p.tabId === currentSpeaker);
    if (!connected) {
      statusEl.textContent = 'offline';
      statusDot.className = 'wa-status-dot offline';
    } else { // is connected
      statusDot.className = 'wa-status-dot online';
      if (!joined) {
        statusEl.textContent = 'Connected - Enter email to join';
      } else if (currentSpeaker === TAB_ID) {
        statusEl.textContent = 'online — You are speaking';
      } else if (cur) {
        statusEl.textContent = `online — ${cur.name} is speaking`;
      } else {
        statusEl.textContent = 'online';
      }
    }
  }

  // SSE
  function connectSSE(){
    if (esConn) { try { esConn.close(); } catch(_){} }
    const es = new EventSource(`/events?tabId=${encodeURIComponent(TAB_ID)}`);
    esConn = es;
    es.addEventListener('open', async () => {
      connected = true; stopDemo(); chatList.innerHTML=''; updateConnectionUI();
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
      try { pingTimer = setInterval(()=>{ postAction({ type:'ping' }).catch(()=>{}); }, 5000); } catch(_){}
    });
    es.addEventListener('init', (ev)=>{
      const data = JSON.parse(ev.data||'{}');
      participants = data.participants||[]; queue = data.queue||[]; currentSpeaker = data.currentSpeaker||null;
      (data.history||[]).forEach(m => { const who = (m.from?.email || m.from?.name || 'Guest'); if (m.from && m.from.tabId === TAB_ID) addOutgoing(m.text||''); else addIncoming(m.text||'', who); });
      renderParticipantsList(); statusEl.textContent='online'; statusDot.classList.remove('offline'); statusDot.classList.add('online');
      showBanner('Connected','ok'); setTimeout(hideBanner, 700);
    });
    es.addEventListener('participant_join', (ev)=>{ const { participant } = JSON.parse(ev.data||'{}'); if (participant && !participants.find(p=>p.tabId===participant.tabId)) participants.push(participant); renderParticipantsList(); });
    es.addEventListener('participant_leave', (ev)=>{ const { tabId } = JSON.parse(ev.data||'{}'); participants = participants.filter(p=>p.tabId!==tabId); renderParticipantsList(); });
    es.addEventListener('queue', (ev)=>{ const { queue:q } = JSON.parse(ev.data||'{}'); queue = q||[]; renderParticipantsList(); });
    es.addEventListener('current_speaker', (ev)=>{ const { tabId } = JSON.parse(ev.data||'{}'); currentSpeaker = tabId||null; if (currentSpeaker !== TAB_ID) { stopMic(); try { speakOverlay.style.display='none'; } catch(_){} speakMode='prep'; } renderParticipantsList(); });
    es.addEventListener('start_speaking', (ev)=>{ 
      const { targets } = JSON.parse(ev.data||'{}'); 
      if (currentSpeaker === TAB_ID) { 
        // Transfer text from prepare overlay if it's open
        let transferredText = '';
        if (prepOverlay && prepOverlay.style.display === 'block') {
          transferredText = prepText?.value || '';
          try { prepOverlay.style.display = 'none'; } catch(_){}
          try { prepRecognition?.stop?.(); } catch(_){}
          prepRecording = false;
        }
        
        try { showBanner("It's your turn to speak", 'ok'); setTimeout(hideBanner, 1200); } catch(_){}
        // Removed audio announcement to prevent it from being picked up by STT
        liveTargets = targets||[]; 
        speakMode='prep'; 
        try { 
          speakText.value = transferredText; // Transfer the prepared text
          speakOverlay.style.display='block'; 
        } catch(_){}
        // Delay STT start slightly to avoid picking up any system sounds
        setTimeout(async ()=>{ 
          try { await startMic(); } catch(e) { alert('Microphone access denied'); return; } 
          startSTT(); 
        }, 500); 
      } 
    });
    es.addEventListener('chat', (ev)=>{ const msg = JSON.parse(ev.data||'{}'); const who = (msg?.from?.email || msg?.from?.name || 'Guest'); if (msg && msg.from && msg.from.tabId === TAB_ID) { addOutgoing(msg.text||''); } else { addIncoming(msg.text||'', who); } });
    es.addEventListener('signal', (ev)=>{ const { from, payload } = JSON.parse(ev.data||'{}'); onSignal(from, payload); });
    es.onerror = ()=>{ statusEl.textContent='offline'; statusDot.classList.remove('online'); statusDot.classList.add('offline'); };
    return es;
  }
  function disconnectSSE(){ try { esConn?.close?.(); } catch(_){} esConn = null; connected = false; joined = false; try { if (pingTimer) clearInterval(pingTimer); } catch(_){} pingTimer = null; try { statusEl.textContent='offline'; statusDot.classList.remove('online'); statusDot.classList.add('offline'); } catch(_){} updateConnectionUI(); updateComposerEnabled(); renderParticipantsList(); startDemo(); }

  async function postAction(payload){ payload.tabId = TAB_ID; const res = await fetch('/action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); return res.json().catch(()=>({ok:false})); }

  // Speak overlay controls
  if (speakSend) speakSend.onclick = async ()=>{
    const text = (speakText?.value || '').trim();
    if (text) await postAction({ type:'chat', text });
    try { 
      speakText.value = ''; 
      // Reset the transcript so old text doesn't come back
      finalTranscript = '';
    } catch(_){}
    // Don't close overlay or stop speaking - let user decide
  };
  if (speakLive) speakLive.onclick = async ()=>{
    // Start streaming audio to peers (WebRTC)
    speakMode = 'live';
    // Update UI to show we're live
    try { 
      speakTitle.textContent = 'Speak Now - LIVE 🔴';
      speakLive.style.display = 'none';
      speakStop.style.display = 'flex';
    } catch(_){}
    
    // Make sure microphone is started before connecting
    try {
      if (!micStream) {
        await startMic();
      }
      
      // Connect to all other participants
      console.log('Going live, connecting to targets:', liveTargets);
      for (const t of (liveTargets||[])) { 
        console.log('Connecting to peer:', t);
        await connectToPeer(t); 
      }
      
      // If no targets, at least inform user
      if (!liveTargets || liveTargets.length === 0) {
        console.log('No other participants to broadcast to');
      }
    } catch(e) {
      console.error('Error going live:', e);
      alert('Could not start live mode: ' + e.message);
      // Reset UI on error
      try { 
        speakTitle.textContent = 'Speak Now';
        speakLive.style.display = 'flex';
        speakStop.style.display = 'none';
      } catch(_){}
    }
  };
  if (speakStop) speakStop.onclick = async ()=>{
    // Stop live mode but stay in overlay
    speakMode = 'prep';
    stopMic();
    // Reset UI
    try { 
      speakTitle.textContent = 'Speak Now';
      speakLive.style.display = 'flex';
      speakStop.style.display = 'none';
    } catch(_){}
    // Restart STT for prep mode
    (async ()=>{ 
      try { await startMic(); } catch(e) { alert('Microphone access denied'); return; } 
      startSTT(); 
    })();
  };
  if (speakCancel) speakCancel.onclick = async ()=>{
    // Cancel exits from speaker mode completely
    try { speakOverlay.style.display='none'; } catch(_){}
    await postAction({ type:'stop_speaking' });
    stopMic(); speakMode='prep';
    // Reset UI
    try { 
      speakTitle.textContent = 'Speak Now';
      speakLive.style.display = 'flex';
      speakStop.style.display = 'none';
    } catch(_){}
  };
  if (speakRequestBtn) speakRequestBtn.onclick = ()=>{
    postAction({ type:'request_speak' });
    try { speakRequestBtn.classList.add('active'); } catch(_){}
  };

  // WebRTC + STT
  const peers = new Map(); let micStream = null; let recognition = null;
  async function startMic(){ if (micStream) return micStream; micStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false }); return micStream; }
  function stopMic(){ try{ recognition?.stop?.(); }catch(_){} recognition=null; if (micStream) { micStream.getTracks().forEach(t=>{ try{t.stop();}catch(_){} }); micStream=null; } for (const pc of peers.values()) { try{pc.close();}catch(_){} } peers.clear(); }
  async function startMicAndConnect(targets){ try { await startMic(); } catch (e) { alert('Microphone access denied'); return; } for (const t of targets) await connectToPeer(t); startSTT(); }
  async function connectToPeer(id){ 
    if (peers.has(id)) {
      console.log('Already connected to peer:', id);
      return peers.get(id); 
    }
    console.log('Creating new connection to peer:', id);
    const pc=new RTCPeerConnection({ iceServers: [{ urls:'stun:stun.l.google.com:19302' }] }); 
    peers.set(id, pc); 
    
    // Add microphone tracks to the connection
    if (micStream) {
      console.log('Adding mic tracks to peer connection');
      micStream.getTracks().forEach(tr=>pc.addTrack(tr, micStream)); 
    } else {
      console.warn('No microphone stream available for peer connection');
    }
    
    pc.onicecandidate=(e)=>{ 
      if (e.candidate) {
        console.log('Sending ICE candidate to:', id);
        postAction({ type:'signal', target:id, payload:{ type:'ice', candidate:e.candidate } }); 
      }
    }; 
    pc.ontrack=(e)=>{ 
      console.log('Received remote track from:', id);
      attachRemoteAudio(id, e.streams[0]); 
    }; 
    
    const offer=await pc.createOffer(); 
    await pc.setLocalDescription(offer); 
    console.log('Sending offer to:', id);
    await postAction({ type:'signal', target:id, payload:{ type:'offer', sdp: pc.localDescription } }); 
    return pc;
  }
  async function onSignal(from, payload){ 
    console.log('Received signal from:', from, 'type:', payload.type);
    let pc = peers.get(from); 
    if (!pc){ 
      console.log('Creating new peer connection for incoming signal from:', from);
      pc=new RTCPeerConnection({ iceServers: [{ urls:'stun:stun.l.google.com:19302' }] }); 
      peers.set(from, pc); 
      pc.onicecandidate=(e)=>{ 
        if (e.candidate) {
          console.log('Sending ICE candidate back to:', from);
          postAction({ type:'signal', target: from, payload: { type:'ice', candidate:e.candidate } }); 
        }
      }; 
      pc.ontrack=(e)=>{ 
        console.log('Received remote audio track from:', from);
        attachRemoteAudio(from, e.streams[0]); 
      }; 
      if (micStream) {
        console.log('Adding mic tracks for incoming connection');
        micStream.getTracks().forEach(tr=>pc.addTrack(tr, micStream)); 
      }
    } 
    
    if (payload.type==='offer'){ 
      console.log('Processing offer from:', from);
      await pc.setRemoteDescription(payload.sdp); 
      const answer=await pc.createAnswer(); 
      await pc.setLocalDescription(answer); 
      console.log('Sending answer to:', from);
      await postAction({ type:'signal', target: from, payload:{ type:'answer', sdp: pc.localDescription } }); 
    } else if (payload.type==='answer'){ 
      console.log('Processing answer from:', from);
      await pc.setRemoteDescription(payload.sdp); 
    } else if (payload.type==='ice'){ 
      try { 
        console.log('Adding ICE candidate from:', from);
        await pc.addIceCandidate(payload.candidate); 
      } catch(e) {
        console.error('Error adding ICE candidate:', e);
      } 
    } 
  }
  function attachRemoteAudio(id, stream){ 
    let el=document.getElementById('audio_'+id); 
    if (!el){ 
      el=document.createElement('audio'); 
      el.id='audio_'+id; 
      el.autoplay=true; 
      el.playsInline=true; 
      el.muted = isDeafened; // Apply deafen state to new audio elements
      document.body.appendChild(el); 
    } 
    el.srcObject = stream; 
  }
  // Footer prepare button
  if (footerPrepareBtn) {
    footerPrepareBtn.onclick = ()=>{ 
      if (joined && connected) {
        try { prepText.value = ''; } catch(_){} 
        try { prepOverlay.style.display='block'; } catch(_){}
      }
    };
  }
  
  function startSTT(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      try { speakText.value = 'Speech Recognition API not supported in this browser.'; } catch(_){}
      return;
    }
    
    // Always start fresh with current text, don't append old transcript
    finalTranscript = '';
    recognition = new SR();
    // Always get the current selected language from the dropdown
    const currentSpeakLang = speakLang?.value || sttLang || 'en-US';
    recognition.lang = currentSpeakLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim_transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcriptPart;
          // Check for "stop" command
          if (/stop/i.test(transcriptPart.trim())) {
            try { speakStop.click(); } catch(_){}
          }
        } else {
          interim_transcript += transcriptPart;
        }
      }
      speakText.value = finalTranscript + interim_transcript;
    };
    recognition.onend = () => {
      // Don't persist old transcript
    };
    recognition.onerror = (e) => {
      try { speakText.value += `\n\n[STT Error: ${e.error}]`; } catch(_){}
    };
    
    try {
      recognition.start();
    } catch(e) {
      alert(`Could not start STT: ${e.message}`);
    }
  }

  // Start disconnected; user must press Connect
  updateConnectionUI(); startDemo();
  // Populate language selector from TTS voices (approximate supported langs)
  try {
    function fillLangs() {
      const list = (window.speechSynthesis?.getVoices?.() || []).map(v => v.lang).filter(Boolean);
      // Put English first, then other languages
      const common = ['en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR', 'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'];
      const allLangs = Array.from(new Set([...(list || []), ...common]));
      // Sort but keep English variants first
      const langs = allLangs.sort((a, b) => {
        if (a.startsWith('en-') && !b.startsWith('en-')) return -1;
        if (!a.startsWith('en-') && b.startsWith('en-')) return 1;
        return a.localeCompare(b);
      });
      
      const prepLang = document.getElementById('prepLang');
      
      // Clear existing options
      if (speakLang) speakLang.innerHTML = '';
      if (prepLang) prepLang.innerHTML = '';

      langs.forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        if (code === sttLang) opt.selected = true;
        
        if (speakLang) speakLang.appendChild(opt.cloneNode(true));
        if (prepLang) prepLang.appendChild(opt);
      });
    }

    fillLangs();
    window.speechSynthesis?.addEventListener?.('voiceschanged', fillLangs);

    const langChangeHandler = (e) => {
      sttLang = e.target.value || 'en-US';
      localStorage.setItem('vc_stt_lang', sttLang);
      // Reselect in the other dropdown to keep them in sync
      const otherSelect = e.target.id === 'speakLang' ? document.getElementById('prepLang') : speakLang;
      if (otherSelect) otherSelect.value = sttLang;
    };

    if (speakLang) speakLang.addEventListener('change', langChangeHandler);
    const prepLang = document.getElementById('prepLang');
    if (prepLang) prepLang.addEventListener('change', langChangeHandler);
  } catch (_) {}
  try { if (!myEmail) { myEmail = localStorage.getItem('vc_email')||''; } } catch(_) {}
  updateComposerEnabled();
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
