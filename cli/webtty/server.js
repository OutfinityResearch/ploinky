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
  const requiresAuth = password ? 'true' : 'false';
  function loadPage(name) {
    const p = path.join(__dirname, name);
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .replace(/__AGENT_NAME__/g, agentName)
      .replace(/__CONTAINER_NAME__/g, containerName)
      .replace(/__RUNTIME__/g, runtime)
      .replace(/__REQUIRES_AUTH__/g, requiresAuth)
      .replace('<body ', `<body data-title="${(title||agentName).replace(/"/g,'&quot;')}" data-mode="${MODE}" `);
  }

  const clients = new Map();
  const sessions = new Set();
  const clientSessions = new Map();
  const crypto = require('crypto');
  const COOKIE_NAME = 'webtty_auth';
  function parseCookies(hdr) { const out = {}; if (!hdr) return out; hdr.split(';').forEach(p => { const [k,v] = p.trim().split('='); out[k] = v; }); return out; }
  function authorized(req) { if (!password) return true; const c = parseCookies(req.headers['cookie']); return !!(c[COOKIE_NAME] && sessions.has(c[COOKIE_NAME])); }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

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
        try { const html = loadPage(page); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
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
          if (password && body.password === password) {
            const sid = crypto.randomBytes(32).toString('hex');
            sessions.add(sid);
            if (!clientSessions.has(sid)) clientSessions.set(sid, { tty: null, sseRes: null, hb: null, unsub: null });
            res.writeHead(200, { 'Set-Cookie': `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Strict` }); res.end('{"ok":true}');
          } else { res.statusCode = 403; res.end('Forbidden'); }
        } catch { res.statusCode = 400; res.end('Bad Request'); }
      });
    } else if (pathname === '/logout' && (req.method === 'POST' || req.method === 'GET')) {
      try {
        const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME];
        if (sid && sessions.has(sid)) {
          sessions.delete(sid);
          const sess = clientSessions.get(sid);
          if (sess) {
            try { sess.unsub?.(); } catch(_){}
            try { clearInterval(sess.hb); } catch(_){}
            try { sess.sseRes?.end?.(); } catch(_){}
            try { sess.tty?.close?.(); } catch(_){}
            clientSessions.delete(sid);
          }
        }
      } catch(_) {}
      res.writeHead(204); res.end();
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
      const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME];
      try { const prev = clientSessions.get(sid); if (prev && prev.sseRes && prev.sseRes !== res) { try { prev.sseRes.end(); } catch(_){} } } catch(_){}
      const t = setInterval(() => { try { res.write(': ping\n\n'); } catch(_){} }, 15000); clients.set(res, t);
      appendLog('sse_open', { ip });
      let sess = clientSessions.get(sid);
      if (!sess) { sess = { tty: null, sseRes: null, hb: null, unsub: null }; clientSessions.set(sid, sess); }
      if (!sess.tty) { sess.tty = ttyFactory.create(); }
      try { sess.unsub?.(); } catch(_){}
      const unsub = sess.tty.onOutput((d)=>{ try { res.write('data: ' + JSON.stringify(String(d||'')) + '\n\n'); } catch(_){} });
      sess.unsub = unsub; sess.sseRes = res; sess.hb = t;
      req.on('close', () => {
        try { clearInterval(t); clients.delete(res); } catch(_){}
        try { const s = clientSessions.get(sid); if (s) { try { s.unsub?.(); } catch(_){} s.unsub = null; s.sseRes = null; s.hb = null; } } catch(_){}
        appendLog('sse_close', { ip });
      });
    } else if (req.url.startsWith('/input') && req.method === 'POST') {
      if (MODE === 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { const data = Buffer.concat(chunks).toString('utf8'); try { const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME]; const sess = clientSessions.get(sid); sess?.tty?.write?.(data); } catch(_){} res.writeHead(204); res.end(); });
    } else if (req.url.startsWith('/resize') && req.method === 'POST') {
      if (MODE === 'dashboard') { res.statusCode = 404; return res.end('Not found'); }
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { const { cols, rows } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); try { const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME]; const sess = clientSessions.get(sid); sess?.tty?.resize?.(cols, rows); } catch(_){} } catch(_){} res.writeHead(204); res.end(); });
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
  server.listen(port, () => { console.log(`Ploinky WebTTY ready: http://localhost:${port} (agent: ${agentName})`); console.log('Close with Ctrl+C'); appendLog('server_start', { port, agentName, runtime }); });
  const onStop = (sig) => { try { appendLog('server_stop', { signal: sig||'exit' }); } catch(_) {} try { server.close(()=>{}); } catch(_) {} process.exit(0); };
  try { process.on('SIGINT', () => onStop('SIGINT')); process.on('SIGTERM', () => onStop('SIGTERM')); process.on('exit', () => onStop('exit')); } catch(_) {}
  return server;
}

module.exports = { startWebTTYServer };
