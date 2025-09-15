const http = require('http');
const fs = require('fs');
const path = require('path');

function startWebTTYServer({ agentName, runtime, containerName, port, ttyFactory, password, workdir, entry, title, mode }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty]', ...args); };
  const LOG_DIR = path.resolve('.ploinky/logs');
  const LOG_PATH = path.join(LOG_DIR, 'webtty.log');
  function ts() {
    const d = new Date();
    const pad = (n)=> String(n).padStart(2,'0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  function rotateIfNeeded() {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      if (fs.existsSync(LOG_PATH)) {
        const st = fs.statSync(LOG_PATH);
        if (st.size > 1_000_000) {
          const base = path.basename(LOG_PATH, '.log');
          const rotated = path.join(LOG_DIR, `${base}-${ts()}.log`);
          fs.renameSync(LOG_PATH, rotated);
        }
      }
    } catch (e) { if (DEBUG) log('rotate error', e?.message||e); }
  }
  function appendLog(type, data) {
    try { rotateIfNeeded(); const rec = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n'; fs.appendFileSync(LOG_PATH, rec); }
    catch (e) { if (DEBUG) log('file log error', e?.message||e); }
  }
  let MODE = (mode || process.env.WEBTTY_MODE || 'console').toLowerCase();
  if (MODE === 'webtty' || MODE === 'webconsole') MODE = 'console';
  if (MODE === 'webchat') MODE = 'chat';
  // Always require auth (now via tokenized URL)
  const requiresAuth = 'true';
  function resolveAppName() {
    try {
      const env = require('../services/secretVars');
      const v = env.resolveVarValue('APP_NAME');
      if (v && String(v).trim()) return String(v).trim();
    } catch(_) {}
    try { if (process.env.APP_NAME && String(process.env.APP_NAME).trim()) return String(process.env.APP_NAME).trim(); } catch(_) {}
    try { return path.basename(workdir || process.cwd()); } catch(_) { return 'App'; }
  }

  function computeTitleForMode(m) {
    const app = resolveAppName();
    const label = (m === 'dashboard') ? 'Dashboard' : (m === 'chat' ? 'Chat' : 'Console');
    return `${label} #${app}`;
  }

  function ensureTokenFor(modeName) {
    try {
      const env = require('../services/secretVars');
      const varName = getTokenVarName(modeName);
      let tok = env.resolveVarValue(varName);
      if (!tok || !String(tok).trim()) {
        tok = crypto.randomBytes(32).toString('hex');
        try { env.setEnvVar(varName, tok); } catch(_) {}
      }
      return String(tok).trim();
    } catch(_) { return loginToken; }
  }

  function loadPage(name, overrideTitle) {
    const p = path.join(__dirname, name);
    const raw = fs.readFileSync(p, 'utf8');
    const pageTitle = overrideTitle || computeTitleForMode(MODE);
    const tokConsole = ensureTokenFor('console');
    const tokChat = ensureTokenFor('chat');
    const tokDash = ensureTokenFor('dashboard');
    // Inject ports as data attributes too
    const ensurePortFor = (m) => {
      try {
        const env = require('../services/secretVars');
        const name = (m === 'dashboard') ? 'WEBDASHBOARD_PORT' : (m === 'chat' ? 'WEBCHAT_PORT' : 'WEBTTY_PORT');
        const raw = String(env.resolveVarValue(name) || '').trim();
        const v = parseInt(raw, 10);
        if (!Number.isNaN(v) && v > 0) return String(v);
      } catch(_) {}
      return (m === 'dashboard') ? '9000' : (m === 'chat' ? '8080' : '9001');
    };
    const portConsole = ensurePortFor('console');
    const portChat = ensurePortFor('chat');
    const portDash = ensurePortFor('dashboard');
    return raw
      .replace(/__AGENT_NAME__/g, agentName)
      .replace(/__CONTAINER_NAME__/g, containerName)
      .replace(/__RUNTIME__/g, runtime)
      .replace(/__REQUIRES_AUTH__/g, requiresAuth)
      .replace('<body ', `<body data-title="${(pageTitle||agentName).replace(/"/g,'&quot;')}" data-mode="${MODE}" data-tty-token="${tokConsole}" data-chat-token="${tokChat}" data-dash-token="${tokDash}" data-tty-port="${portConsole}" data-chat-port="${portChat}" data-dash-port="${portDash}" `);
  }

  const clients = new Map();
  const sessions = new Set();
  const clientSessions = new Map();
  const crypto = require('crypto');
  
  function getTokenVarName(m) {
    return (m === 'dashboard') ? 'WEBDASHBOARD_TOKEN' : (m === 'chat' ? 'WEBCHAT_TOKEN' : 'WEBTTY_TOKEN');
  }
  
  function resolveLoginToken() {
    try {
      const env = require('../services/secretVars');
      const varName = getTokenVarName(MODE);
      let tok = env.resolveVarValue(varName);
      if (!tok || !String(tok).trim()) {
        tok = crypto.randomBytes(32).toString('hex');
        try { env.setEnvVar(varName, tok); } catch(_) {}
      }
      return String(tok).trim();
    } catch(_) {
      return crypto.randomBytes(32).toString('hex');
    }
  }
  const loginToken = resolveLoginToken();
  function cookieNames() {
    if (MODE === 'dashboard') return { SID: 'webdash_auth', TOK: 'webdash_token' };
    if (MODE === 'chat') return { SID: 'webchat_auth', TOK: 'webchat_token' };
    return { SID: 'webtty_auth', TOK: 'webtty_token' };
  }
  const { SID: COOKIE_SID, TOK: COOKIE_TOKEN } = cookieNames();
  function parseCookies(hdr) { const out = {}; if (!hdr) return out; hdr.split(';').forEach(p => { const [k,v] = p.trim().split('='); out[k] = v; }); return out; }
  function hasValidTokenCookie(cookies) { return (cookies[COOKIE_TOKEN] && cookies[COOKIE_TOKEN] === loginToken); }
  function getSessionKey(req) {
    const cookies = parseCookies(req.headers['cookie']);
    const sid = cookies[COOKIE_SID];
    if (sid && sessions.has(sid)) return sid;
    if (hasValidTokenCookie(cookies)) return 'tok:' + loginToken;
    return null;
  }
  function authorized(req) { return !!getSessionKey(req); }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

  const INACTIVITY_MS = Number.parseInt(process.env.WEBTTY_IDLE_MS || '') || (30 * 60 * 1000);
  function sweepIdle() {
    const now = Date.now();
    try {
      for (const [sessKey, tabs] of clientSessions.entries()) {
        for (const [tabId, sess] of tabs.entries()) {
          const last = sess?.lastInputAt || sess?.createdAt || 0;
          if (last && (now - last > INACTIVITY_MS)) {
            try { sess.unsub?.(); } catch(_){}
            try { clearInterval(sess.hb); } catch(_){}
            try { sess.sseRes?.end?.(); } catch(_){}
            try { sess.tty?.close?.(); } catch(_){}
            tabs.delete(tabId);
            appendLog('session_reaped', { sessKey, tabId });
          }
        }
        if (!tabs.size) clientSessions.delete(sessKey);
      }
    } catch(_) {}
  }
  setInterval(sweepIdle, 60 * 1000);

  const server = http.createServer((req, res) => {
    const ip = req.socket?.remoteAddress;
    // --- Static assets ---
    const u = new URL(req.url, 'http://x');
    const pathname = u.pathname;
    if (pathname === '/' || pathname === '/login' || pathname === '/index.html') {
      if (!authorized(req)) {
        try { const html = loadPage('login.html'); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
        catch { res.statusCode = 500; res.end('Login load error'); }
      } else {
        const page = (MODE === 'chat') ? 'chat.html' : (MODE === 'dashboard' ? 'dashboard.html' : 'console.html');
        try { const html = loadPage(page, computeTitleForMode(MODE)); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
        catch { res.statusCode = 500; res.end('Page load error'); }
      }
    } else if (req.url === '/assets/webtty.css' && req.method === 'GET') {
      try { const css = fs.readFileSync(path.join(__dirname, 'webtty.css')); res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(css); }
      catch { res.statusCode = 500; res.end('CSS load error'); }
    } else if (pathname === '/assets/clientloader.js' && req.method === 'GET') {
      try { const js = fs.readFileSync(path.join(__dirname, 'clientloader.js')); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(js); }
      catch { res.statusCode = 500; res.end('JS load error'); }
    } else if (pathname.startsWith('/assets/') && req.method === 'GET') {
      // Serve additional assets: chat.js, console.js, dashboard.js, login.js, common.js
      const file = pathname.replace('/assets/', '');
      const safe = file.replace(/[^a-zA-Z0-9_\-.]/g, '');
      const full = path.join(__dirname, safe);
      try {
        const ext = path.extname(full).toLowerCase();
        const type = ext === '.css' ? 'text/css' : 'application/javascript';
        const data = fs.readFileSync(full);
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        res.end(data);
      } catch {
        res.statusCode = 404; res.end('Asset not found');
      }
    } else if (req.url === '/auth' && req.method === 'POST') {
      let buf = []; req.on('data', d => buf.push(d)); req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8') || '{}');
          const tok = (body.token || '').trim();
          if (tok && tok === loginToken) {
            const sid = crypto.randomBytes(32).toString('hex');
            sessions.add(sid);
            if (!clientSessions.has(sid)) clientSessions.set(sid, new Map());
            res.writeHead(200, { 'Set-Cookie': [
              `${COOKIE_SID}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
              `${COOKIE_TOKEN}=${loginToken}; Path=/; HttpOnly; SameSite=Lax`
            ] });
            res.end('{"ok":true}');
          } else { res.statusCode = 403; res.end('Forbidden'); }
        } catch { res.statusCode = 400; res.end('Bad Request'); }
      });
    } else if (pathname === '/token-login' && req.method === 'GET') {
      const tok = (u.searchParams.get('token') || '').trim();
      if (tok && tok === loginToken) {
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.add(sid);
        if (!clientSessions.has(sid)) clientSessions.set(sid, new Map());
        res.writeHead(302, { 'Set-Cookie': [
          `${COOKIE_SID}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
          `${COOKIE_TOKEN}=${loginToken}; Path=/; HttpOnly; SameSite=Lax`
        ], Location: '/' });
        res.end();
      } else { res.statusCode = 403; res.end('Forbidden'); }
    } else if (pathname === '/logout' && (req.method === 'POST' || req.method === 'GET')) {
      try {
        const cookies = parseCookies(req.headers['cookie']);
        const sid = cookies[COOKIE_SID];
        if (sid && sessions.has(sid)) {
          // Clear all TTYs for this auth session
          const tabSessions = clientSessions.get(sid);
          if (tabSessions) {
            for (const sess of tabSessions.values()) {
              try { sess.unsub?.(); } catch(_){}
              try { clearInterval(sess.hb); } catch(_){}
              try { sess.sseRes?.end?.(); } catch(_){}
              try { sess.tty?.close?.(); } catch(_){}
            }
          }
          clientSessions.delete(sid);
          sessions.delete(sid);
        }
      } catch(_) {}
      // Clear cookies on client
      res.writeHead(204, { 'Set-Cookie': [
        `${COOKIE_SID}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`,
        `${COOKIE_TOKEN}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
      ]});
      res.end();
    } else if (pathname === '/whoami' && req.method === 'GET') {
      // Small helper for client-side redirects after login
      const ok = authorized(req);
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok, mode: MODE }));
    } else if (req.url.startsWith('/stream') && req.method === 'GET') {
      if (MODE === 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const sessKey = getSessionKey(req);
      const tabId = u.searchParams.get('tabId');

      if (!sessKey || !tabId) { return deny(res); }

      let tabSessions = clientSessions.get(sessKey);
      if (!tabSessions) { tabSessions = new Map(); clientSessions.set(sessKey, tabSessions); }

      // Get or create the session for this specific tab
      let sess = tabSessions.get(tabId);
      if (!sess) {
        sess = { tty: ttyFactory.create(), sseRes: null, hb: null, unsub: null, createdAt: Date.now(), lastInputAt: Date.now() };
        tabSessions.set(tabId, sess);
      }

      // Clean up previous connection for this tab if it exists
      try { sess.sseRes?.end?.(); } catch(_){}
      try { clearInterval(sess.hb); } catch(_){}

      const t = setInterval(() => { try { res.write(': ping\n\n'); } catch(_){} }, 15000);
      appendLog('sse_open', { ip, session: sessKey, tabId });

      // Unsubscribe old output handler and subscribe new one
      try { sess.unsub?.(); } catch(_){}
      const unsub = sess.tty.onOutput((d)=>{ try { res.write('data: ' + JSON.stringify(String(d||'')) + '\n\n'); } catch(_){} });
      
      // Update session with new connection details
      sess.unsub = unsub; 
      sess.sseRes = res; 
      sess.hb = t;

      req.on('close', () => {
        try { clearInterval(t); } catch(_){}
        // When SSE closes, we don't kill the TTY, just detach.
        // The TTY process will be killed on /logout or server shutdown.
        if (sess) {
          try { sess.unsub?.(); } catch(_){}
          sess.unsub = null;
          sess.sseRes = null;
          sess.hb = null;
        }
        appendLog('sse_close', { ip, session: sessKey, tabId });
      });
    } else if (req.url.startsWith('/input') && req.method === 'POST') {
      if (MODE === 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { 
        const data = Buffer.concat(chunks).toString('utf8'); 
        try { 
          const sessKey = getSessionKey(req);
          const tabId = u.searchParams.get('tabId');
          const sess = clientSessions.get(sessKey)?.get(tabId);
          if (sess) { sess.lastInputAt = Date.now(); sess.tty?.write?.(data); }
        } catch(_){} 
        res.writeHead(204); res.end(); 
      });
    } else if (req.url.startsWith('/resize') && req.method === 'POST') {
      if (MODE === 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { 
        try { 
          const { cols, rows } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); 
          const sessKey = getSessionKey(req);
          const tabId = u.searchParams.get('tabId');
          const sess = clientSessions.get(sessKey)?.get(tabId);
          sess?.tty?.resize?.(cols, rows); 
        } catch(_){} 
        res.writeHead(204); res.end(); 
      });
    } else if (pathname.startsWith('/run')) {
      if (MODE !== 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      const handle = async (cmdLine) => {
        appendLog('run', { cmd: cmdLine });
        try {
          const { spawn } = require('child_process');
          const args = (cmdLine || '').trim().split(/\s+/).filter(Boolean);
          const proc = spawn('ploinky', args, { cwd: workdir || process.cwd() });
          let out = ''; let err = '';
          proc.stdout.on('data', d => out += d.toString('utf8'));
          proc.stderr.on('data', d => err += d.toString('utf8'));
          proc.on('close', (code) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, code, stdout: out, stderr: err }));
          });
        } catch (e) {
          res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
        }
      };
      if (req.method === 'GET') {
        const cmd = u.searchParams.get('cmd') || '';
        return handle(cmd);
      } else if (req.method === 'POST') {
        const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
          try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return handle(body.cmd || ''); }
          catch { res.statusCode = 400; res.end('Bad Request'); }
        });
      } else { res.statusCode = 405; res.end('Method Not Allowed'); }
    } else { res.statusCode = 404; res.end('Not found'); }
  });
  server.on('connection', (socket) => {
    const ip = socket.remoteAddress;
    appendLog('connection_open', { ip });
    socket.on('close', () => appendLog('connection_close', { ip }));
  });
  server.on('error', (err) => {
    try { appendLog('server_error', { message: err?.message || String(err), port }); } catch(_) {}
    try { console.error(`WebTTY failed to start on port ${port}: ${err?.message || err}`); } catch(_) {}
  });
  server.listen(port, () => { 
    const accessUrl = `http://localhost:${port}/?token=${loginToken}`;
    const label = (MODE === 'dashboard') ? 'Dashboard' : (MODE === 'chat' ? 'WebChat' : 'WebTTY');
    console.log(`Ploinky ${label} ready on http://localhost:${port} (agent: ${agentName})`);
    console.log(`Access URL (share to authenticate): ${accessUrl}`);
    appendLog('server_start', { port, agentName, runtime }); 
  });
  const onStop = (sig) => { try { appendLog('server_stop', { signal: sig||'exit' }); } catch(_) {} try { server.close(()=>{}); } catch(_) {} process.exit(0); };
  try { process.on('SIGINT', () => onStop('SIGINT')); process.on('SIGTERM', () => onStop('SIGTERM')); process.on('exit', () => onStop('exit')); } catch(_) {}
  return server;
}

module.exports = { startWebTTYServer };
