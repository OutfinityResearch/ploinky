const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function startVoiceChatServer({ port = 8180, agentName = null, workdir = process.cwd() }) {
  const DEBUG = process.env.VOICECHAT_DEBUG === '1';
  const log = (...a) => { if (DEBUG) console.log('[voicechat]', ...a); };

  // Logging
  const LOG_DIR = path.resolve('.ploinky/logs');
  const LOG_PATH = path.join(LOG_DIR, 'voicechat.log');
  function ts() { const d = new Date(); const p = n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
  function rotateIfNeeded() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); if (fs.existsSync(LOG_PATH)) { const st = fs.statSync(LOG_PATH); if (st.size > 1_000_000) { const base = path.basename(LOG_PATH, '.log'); fs.renameSync(LOG_PATH, path.join(LOG_DIR, `${base}-${ts()}.log`)); } } } catch(_) {}
  }
  function appendLog(type, data) { try { rotateIfNeeded(); const rec = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n'; fs.appendFileSync(LOG_PATH, rec); } catch(_) {}
  }

  // Auth token management
  function ensureToken() {
    try {
      const env = require('../services/secretVars');
      let tok = env.resolveVarValue('VOICECHAT_TOKEN');
      if (!tok || !String(tok).trim()) { tok = crypto.randomBytes(32).toString('hex'); try { env.setEnvVar('VOICECHAT_TOKEN', tok); } catch(_) {} }
      return String(tok).trim();
    } catch(_) { return crypto.randomBytes(32).toString('hex'); }
  }
  const LOGIN_TOKEN = ensureToken();
  const COOKIE_SID = 'voicechat_auth';
  const COOKIE_TOKEN = 'voicechat_token';
  function parseCookies(hdr) { const out = {}; if (!hdr) return out; hdr.split(';').forEach(p => { const [k,v] = p.trim().split('='); out[k] = v; }); return out; }
  function hasValidTokenCookie(cookies) { return (cookies[COOKIE_TOKEN] && cookies[COOKIE_TOKEN] === LOGIN_TOKEN); }
  const sessions = new Set();
  function getSessionKey(req) { const c = parseCookies(req.headers['cookie']); const sid = c[COOKIE_SID]; if (sid && sessions.has(sid)) return sid; if (hasValidTokenCookie(c)) return 'tok:' + LOGIN_TOKEN; return null; }
  function authorized(req) { return !!getSessionKey(req); }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

  // In-memory state
  const tabsBySession = new Map(); // sid -> Map(tabId, tabState)
  const participants = new Map(); // tabId -> { name,email,sessionId, joinedAt, lastAt }
  const chatHistory = []; // { id, ts, from:{name,email,tabId}, text, type }
  let nextMsgId = 1;
  const queue = []; // array of tabIds awaiting to speak
  let currentSpeaker = null; // tabId
  
  // Persistent history file
  const HISTORY_FILE = path.join(workdir, '.ploinky', 'voicechat_history.jsonl');
  
  // Load chat history from disk on startup
  function loadChatHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
        lines.forEach(line => {
          try {
            const msg = JSON.parse(line);
            chatHistory.push(msg);
            if (msg.id >= nextMsgId) nextMsgId = msg.id + 1;
          } catch(_) {}
        });
        log(`Loaded ${chatHistory.length} messages from history`);
      }
    } catch(e) {
      log('Error loading chat history:', e);
    }
  }
  
  // Save a message to persistent history
  function saveMessageToDisk(msg) {
    try {
      fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
      fs.appendFileSync(HISTORY_FILE, JSON.stringify(msg) + '\n');
    } catch(e) {
      log('Error saving message to disk:', e);
    }
  }
  
  // Initialize history on startup
  loadChatHistory();

  function getRoutingPort() {
    try { const cfg = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {}; return cfg.port || 8088; } catch(_) { return 8088; }
  }

  function postToAgent(agent, payload) {
    return new Promise((resolve) => {
      if (!agent) return resolve({ ok: false, error: 'no-agent-configured' });
      const data = Buffer.from(JSON.stringify(payload||{}), 'utf8');
      const httpMod = require('http');
      const req = httpMod.request({ hostname: '127.0.0.1', port: getRoutingPort(), path: `/apis/${agent}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (r) => {
        const chunks=[]; r.on('data',d=>chunks.push(d)); r.on('end',()=>{ const body = Buffer.concat(chunks).toString('utf8'); try { resolve(JSON.parse(body)); } catch(_) { resolve({ ok: false, error: 'invalid-agent-response', raw: body }); } });
      });
      req.on('error', (e)=> resolve({ ok: false, error: String(e) }));
      req.write(data); req.end();
    });
  }

  function sseWrite(res, event, dataObj) {
    try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(dataObj||{}) + '\n\n'); } catch(_) {}
  }
  function broadcast(event, data, exceptTabId = null) {
    for (const [, tabs] of tabsBySession.entries()) {
      for (const [tabId, tab] of tabs.entries()) {
        if (exceptTabId && tabId === exceptTabId) continue;
        if (tab.sseRes) sseWrite(tab.sseRes, event, data);
      }
    }
  }

  function listParticipants() { return Array.from(participants.entries()).map(([tabId, u]) => ({ tabId, name: u.name, email: u.email })); }

  function enqueueSpeaker(tabId) {
    if (!queue.includes(tabId)) queue.push(tabId);
    appendLog('queue_update', { queue });
    maybeAdvanceSpeaker();
    broadcast('queue', { queue });
  }
  async function maybeAdvanceSpeaker() {
    if (currentSpeaker) return;
    if (!queue.length) return;
    let next = queue[0];
    if (agentName) {
      try {
        const res = await postToAgent(agentName, { command: 'decideNextSpeaker', args: { queue, participants: listParticipants(), currentSpeaker }, user: 'voicechat' });
        if (res && res.next) next = res.next;
      } catch(_) {}
    }
    // Shift queue to that speaker
    const idx = queue.indexOf(next);
    if (idx >= 0) queue.splice(idx, 1);
    currentSpeaker = next;
    appendLog('speaker_start', { tabId: currentSpeaker });
    // Inform everyone
    broadcast('current_speaker', { tabId: currentSpeaker });
    // Tell the speaker whom to connect to (targets = all other tabIds)
    const targets = listParticipants().map(p => p.tabId).filter(id => id !== currentSpeaker);
    // Send only to the speaker
    for (const [, tabs] of tabsBySession.entries()) {
      for (const [tabId, tab] of tabs.entries()) {
        if (tabId === currentSpeaker && tab.sseRes) sseWrite(tab.sseRes, 'start_speaking', { targets });
      }
    }
    // Update queue view
    broadcast('queue', { queue });
  }
  function stopSpeaking(tabId, reason = 'stop') {
    if (currentSpeaker !== tabId) return;
    appendLog('speaker_stop', { tabId, reason });
    currentSpeaker = null;
    broadcast('current_speaker', { tabId: null });
    // Advance if there is a queue
    setTimeout(() => { maybeAdvanceSpeaker().catch(()=>{}); }, 10);
  }

  function addChatMessage(fromTabId, text, type = 'text') {
    const from = participants.get(fromTabId) || { name: 'Unknown', email: '', tabId: fromTabId };
    const msg = { id: nextMsgId++, ts: Date.now(), from: { name: from.name, email: from.email, tabId: fromTabId }, type, text: String(text||'') };
    chatHistory.push(msg); if (chatHistory.length > 5000) chatHistory.splice(0, chatHistory.length - 5000);
    saveMessageToDisk(msg); // Save to persistent storage
    broadcast('chat', msg);
  }

  // Periodic cleanup of stale participants based on heartbeat
  const PRESENCE_TTL_MS = 15000; // 15s
  setInterval(() => {
    const now = Date.now();
    for (const [tabId, user] of participants.entries()) {
      const last = user.lastAt || 0;
      if (now - last > PRESENCE_TTL_MS) {
        // Remove stale participant
        participants.delete(tabId);
        broadcast('participant_leave', { tabId });
        appendLog('leave_stale', { tabId });
        // Remove from queue if present
        const idx = queue.indexOf(tabId);
        if (idx >= 0) {
          queue.splice(idx, 1);
          broadcast('queue', { queue });
        }
        // If currently speaking, stop and advance
        if (currentSpeaker === tabId) {
          stopSpeaking(tabId, 'stale');
        }
      }
    }
  }, 5000);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    // Static assets
    if (pathname === '/' || pathname === '/index.html') {
      if (!authorized(req)) {
        try { const html = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8'); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); } catch { res.statusCode = 500; return res.end('Login load error'); }
      }
      try { let html = fs.readFileSync(path.join(__dirname, 'voice.html'), 'utf8');
        // Inject token login URL and port in data attrs
        const tok = LOGIN_TOKEN;
        html = html.replace('<body ', `<body data-voice-token="${tok}" data-port="${String(port)}" `);
        // Add cache-busting query params
        const cacheBust = `?v=${Date.now()}`;
        html = html.replace('/assets/webtty.css', `/assets/webtty.css${cacheBust}`);
        html = html.replace('/assets/voice.js', `/assets/voice.js${cacheBust}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      } catch { res.statusCode = 500; return res.end('Page load error'); }
    } else if (pathname.startsWith('/assets/') && req.method === 'GET') {
      const file = pathname.replace('/assets/', '');
      const safe = file.replace(/[^a-zA-Z0-9_\-.]/g, '');
      const full = path.join(__dirname, safe);
      try {
        const ext = path.extname(full).toLowerCase();
        const type = ext === '.css' ? 'text/css' : 'application/javascript';
        const data = fs.readFileSync(full);
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(data);
      } catch { res.statusCode = 404; return res.end('Asset not found'); }
    } else if (pathname === '/token-login' && req.method === 'GET') {
      const tok = (u.searchParams.get('token') || '').trim();
      if (tok && tok === LOGIN_TOKEN) {
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.add(sid);
        res.writeHead(302, { 'Set-Cookie': [ `${COOKIE_SID}=${sid}; Path=/; HttpOnly; SameSite=Lax`, `${COOKIE_TOKEN}=${LOGIN_TOKEN}; Path=/; HttpOnly; SameSite=Lax` ], Location: '/' });
        return res.end();
      } else { res.statusCode = 403; return res.end('Forbidden'); }
    } else if (pathname === '/auth' && req.method === 'POST') {
      let buf=[]; req.on('data',d=>buf.push(d)); req.on('end',()=>{
        try { const body = JSON.parse(Buffer.concat(buf).toString('utf8')||'{}'); const tok = (body.token||'').trim();
          if (tok && tok === LOGIN_TOKEN) { const sid = crypto.randomBytes(32).toString('hex'); sessions.add(sid);
            res.writeHead(200, { 'Set-Cookie': [ `${COOKIE_SID}=${sid}; Path=/; HttpOnly; SameSite=Lax`, `${COOKIE_TOKEN}=${LOGIN_TOKEN}; Path=/; HttpOnly; SameSite=Lax` ] }); return res.end('{"ok":true}');
          } else { res.statusCode = 403; return res.end('Forbidden'); }
        } catch { res.statusCode = 400; return res.end('Bad Request'); }
      });
    } else if (pathname === '/logout' && (req.method === 'POST' || req.method === 'GET')) {
      try { const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_SID]; if (sid && sessions.has(sid)) { const tabs = tabsBySession.get(sid); if (tabs) { for (const [tabId, tab] of tabs.entries()) { try { tab.sseRes?.end?.(); } catch(_){} participants.delete(tabId); } } tabsBySession.delete(sid); sessions.delete(sid); } } catch(_) {}
      res.writeHead(204, { 'Set-Cookie': [ `${COOKIE_SID}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`, `${COOKIE_TOKEN}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax` ]});
      return res.end();
    } else if (pathname === '/whoami' && req.method === 'GET') {
      const ok = authorized(req);
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok }));
    } else if (pathname === '/demo' && req.method === 'GET') {
      try {
        let script = null;
        try {
          const demoPath = path.join(workdir || process.cwd(), 'discussion.demo');
          if (fs.existsSync(demoPath)) {
            const raw = fs.readFileSync(demoPath, 'utf8');
            script = raw.split(/\r?\n/).filter(Boolean).map(line => {
              const idx = line.indexOf(':');
              if (idx > -1) return { who: line.slice(0, idx).trim(), text: line.slice(idx+1).trim(), delayMs: 1200 };
              return { who: 'User', text: line.trim(), delayMs: 1200 };
            });
          }
        } catch(_){}
        if (!script) {
          script = [
            { who: 'Alice', text: 'Hey, have you tried Ploinky for agents?', delayMs: 1100 },
            { who: 'Bob', text: 'Not yet. What is it?', delayMs: 1400 },
            { who: 'Alice', text: "It's a lightweight runtime for console-style AI agents.", delayMs: 1300 },
            { who: 'Bob', text: 'Neat. Does it have a web chat?', delayMs: 1200 },
            { who: 'Alice', text: 'Yes — WebChat mirrors the agent TTY as a WhatsApp-like chat.', delayMs: 1200 },
            { who: 'Alice', text: "And there's a new VoiceChat: users queue to speak; audio is shared live.", delayMs: 1500 },
            { who: 'Bob', text: 'So it handles STT, TTS, and WebRTC streaming?', delayMs: 1400 },
            { who: 'Alice', text: 'Exactly. It transcribes speech, supports manual edits, and posts to chat only when you press Send.', delayMs: 1600 },
            { who: 'Bob', text: "That's perfect for structured meetings. How do I join?", delayMs: 1400 },
            { who: 'Alice', text: 'Use the secure token link, Connect, then set your email and Request to speak.', delayMs: 1500 },
          ];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, script }));
      } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false })); }
    } else if (pathname === '/events' && req.method === 'GET') {
      if (!authorized(req)) return deny(res);
      const tabId = (u.searchParams.get('tabId') || '').trim();
      if (!tabId) { res.statusCode = 400; return res.end('Missing tabId'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const sid = getSessionKey(req);
      let tabs = tabsBySession.get(sid); if (!tabs) { tabs = new Map(); tabsBySession.set(sid, tabs); }
      let tab = tabs.get(tabId);
      if (!tab) { tab = { sseRes: null, hb: null, lastAt: Date.now() }; tabs.set(tabId, tab); }
      // Close previous SSE if any
      try { tab.sseRes?.end?.(); } catch(_) {} try { clearInterval(tab.hb); } catch(_) {}
      tab.sseRes = res; tab.hb = setInterval(()=>{ try { res.write(': ping\n\n'); } catch(_) {} }, 15000);
      appendLog('sse_open', { tabId });
      // Send init state
      const recent = chatHistory.slice(-100);
      sseWrite(res, 'init', { participants: listParticipants(), queue, currentSpeaker, history: recent });
      req.on('close', () => {
        try { clearInterval(tab.hb); } catch(_) {}
        tab.hb = null; tab.sseRes = null;
        appendLog('sse_close', { tabId });
        
        // Clean up participant when connection closes
        if (participants.has(tabId)) {
          participants.delete(tabId);
          broadcast('participant_leave', { tabId });
          
          // Remove from queue if present
          const queueIdx = queue.indexOf(tabId);
          if (queueIdx >= 0) {
            queue.splice(queueIdx, 1);
            broadcast('queue', { queue });
          }
          
          // Stop speaking if they were the current speaker
          if (currentSpeaker === tabId) {
            stopSpeaking(tabId, 'disconnect');
          }
        }
      });
    } else if (pathname === '/history' && req.method === 'GET') {
      if (!authorized(req)) return deny(res);
      const before = parseInt(u.searchParams.get('before') || '0', 10) || 0;
      const limit = Math.max(1, Math.min(200, parseInt(u.searchParams.get('limit') || '50', 10) || 50));
      let idx;
      if (!before) idx = chatHistory.length; else idx = chatHistory.findIndex(m => m.id === before);
      if (idx < 0) idx = chatHistory.length;
      const start = Math.max(0, idx - limit);
      const slice = chatHistory.slice(start, idx);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, messages: slice, more: start > 0, nextBefore: (slice.length ? slice[0].id : 0) }));
    } else if (pathname === '/action' && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const sid = getSessionKey(req);
      let buf=[]; req.on('data',d=>buf.push(d)); req.on('end', async () => {
        let body={}; try { body = JSON.parse(Buffer.concat(buf).toString('utf8')||'{}'); } catch(_) {}
        const type = body.type;
        const tabId = String(body.tabId||'').trim();
        if (!tabId) { res.statusCode = 400; return res.end('{"ok":false,"error":"missing-tabId"}'); }
        if (!tabsBySession.get(sid)?.get(tabId)) { let tabs = tabsBySession.get(sid); if (!tabs) { tabs = new Map(); tabsBySession.set(sid,tabs); } tabs.set(tabId, { sseRes: null, hb: null, lastAt: Date.now() }); }
        // Update last seen for this tab and participant (if any)
        try { const tabs = tabsBySession.get(sid); const t = tabs && tabs.get(tabId); if (t) t.lastAt = Date.now(); } catch(_) {}
        try { const p = participants.get(tabId); if (p) p.lastAt = Date.now(); } catch(_) {}
        const reply = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj||{ok:true})); };
        if (type === 'ping') { return reply({ ok: true }); }
        if (type === 'hello') {
          const rawEmail = String(body.email||'').trim();
          const email = rawEmail;
          const name = String(body.name||'').trim() || email || 'Anon';
          const user = { name, email, sessionId: tabId, joinedAt: Date.now(), lastAt: Date.now() };
          participants.set(tabId, user);
          broadcast('participant_join', { participant: { tabId, name: user.name, email: user.email } });
          appendLog('join', { tabId, name: user.name });
          return reply({ ok: true });
        }
        if (type === 'leave') {
          participants.delete(tabId);
          broadcast('participant_leave', { tabId });
          appendLog('leave', { tabId });
          return reply({ ok: true });
        }
        if (type === 'chat') {
          const text = String(body.text||'').slice(0, 10000);
          addChatMessage(tabId, text, 'text');
          // forward to agent as natural message
          if (agentName) {
            const user = participants.get(tabId) || { name: 'Unknown', email: '' };
            try { await postToAgent(agentName, { command: 'message', user, args: { text } }); } catch(_) {}
          }
          return reply({ ok: true });
        }
        if (type === 'transcript') {
          const text = String(body.text||'').slice(0, 10000);
          addChatMessage(tabId, text, 'transcript');
          if (agentName) {
            const user = participants.get(tabId) || { name: 'Unknown', email: '' };
            try { await postToAgent(agentName, { command: 'message', user, args: { text, modality: 'voice' } }); } catch(_) {}
          }
          return reply({ ok: true });
        }
        if (type === 'request_speak') {
          enqueueSpeaker(tabId);
          return reply({ ok: true, queue });
        }
        if (type === 'stop_speaking') {
          stopSpeaking(tabId, 'user');
          return reply({ ok: true });
        }
        if (type === 'signal') {
          const target = String(body.target||'').trim();
          const payload = body.payload || {};
          // deliver to target tab via SSE
          for (const [, tabs] of tabsBySession.entries()) {
            const t = tabs.get(target);
            if (t && t.sseRes) sseWrite(t.sseRes, 'signal', { from: tabId, payload });
          }
          return reply({ ok: true });
        }
        if (type === 'command') {
          const cmd = body.command || null; const args = body.args || {};
          const user = participants.get(tabId) || { name: 'Unknown', email: '' };
          const payload = { command: cmd, args, user };
          if (!agentName) { addChatMessage(tabId, `command: ${cmd}`, 'command'); return reply({ ok: true, note: 'no-agent-configured' }); }
          const result = await postToAgent(agentName, payload);
          // Announce into chat minimal result
          addChatMessage(tabId, `→ ${cmd}: ${result && result.ok !== undefined ? (result.ok ? 'ok' : ('error: '+(result.error||'fail'))) : 'sent'}`, 'command');
          return reply({ ok: true, agentResult: result });
        }
        return reply({ ok: false, error: 'unknown-action' });
      });
    } else {
      res.statusCode = 404; res.end('Not found');
    }
  });

  server.on('error', (err) => {
    try { appendLog('server_error', { message: err?.message || String(err), port }); } catch(_) {}
    try { console.error(`[voicechat] Failed to start on port ${port}: ${err?.message || err}`); } catch(_) {}
  });
  server.on('connection', (socket) => { const ip = socket.remoteAddress; appendLog('connection_open', { ip }); socket.on('close', () => appendLog('connection_close', { ip })); });

  const os = require('os');
  function localIP(){ try { const ifs=os.networkInterfaces(); for (const k of Object.keys(ifs)) { for (const i of ifs[k]) { if (i.family==='IPv4' && !i.internal) return i.address; } } } catch(_){} return 'localhost'; }
  server.listen(port, () => {
    const host = localIP();
    const accessUrl = `http://${host}:${port}/?token=${LOGIN_TOKEN}`;
    console.log(`Ploinky VoiceChat ready on http://${host}:${port}${agentName ? ` (agent: ${agentName})` : ''}`);
    console.log(`Access URL (share to authenticate): ${accessUrl}`);
    appendLog('server_start', { port, agentName });
  });

  const onStop = (sig) => { try { appendLog('server_stop', { signal: sig||'exit' }); } catch(_) {} try { server.close(()=>{}); } catch(_) {} process.exit(0); };
  try { process.on('SIGINT', () => onStop('SIGINT')); process.on('SIGTERM', () => onStop('SIGTERM')); process.on('exit', () => onStop('exit')); } catch(_) {}

  return server;
}

module.exports = { startVoiceChatServer };
