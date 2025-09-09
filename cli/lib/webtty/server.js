const http = require('http');
const fs = require('fs');
const path = require('path');

function startWebTTYServer({ agentName, runtime, containerName, port, ttySession, password, workdir }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty]', ...args); };
  const LOG_PATH = path.resolve(process.cwd(), 'logs_webtty');
  function appendLog(type, data) {
    try {
      const entry = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n';
      fs.appendFileSync(LOG_PATH, entry);
    } catch (e) {
      if (DEBUG) log('file log error', e?.message||e);
    }
  }
  const templatePath = path.join(__dirname, 'index.html');
  let indexHtml = fs.readFileSync(templatePath, 'utf8');
  indexHtml = indexHtml
    .replace(/__AGENT_NAME__/g, agentName)
    .replace(/__CONTAINER_NAME__/g, containerName)
    .replace(/__RUNTIME__/g, runtime)
    .replace(/__REQUIRES_AUTH__/g, password ? 'true' : 'false');

  const clients = new Map(); // res -> heartbeat timer

  // Simple in-memory session store
  const sessions = new Set();
  const COOKIE_NAME = 'webtty_auth';
  function parseCookies(hdr) {
    const out = {}; if (!hdr) return out;
    hdr.split(';').forEach(p => { const [k,v] = p.trim().split('='); out[k] = v; });
    return out;
  }
  function authorized(req) {
    if (!password) return true;
    const cookies = parseCookies(req.headers['cookie']);
    const ok = cookies[COOKIE_NAME] && sessions.has(cookies[COOKIE_NAME]);
    if (!ok && DEBUG) {
      log('auth failed', { ip: req.socket?.remoteAddress, ua: req.headers['user-agent'] });
    }
    return ok;
  }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

  const server = http.createServer((req, res) => {
    const ip = req.socket?.remoteAddress;
    if (DEBUG) log(req.method, req.url, { ip, ua: req.headers['user-agent'] });
    appendLog('request', { method: req.method, url: req.url, ip });
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } else if (req.url === '/assets/webtty.css' && req.method === 'GET') {
      try {
        const css = fs.readFileSync(path.join(__dirname, 'webtty.css'));
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(css);
      } catch (e) {
        res.statusCode = 500; res.end('CSS load error');
      }
    } else if (req.url === '/assets/clientloader.js' && req.method === 'GET') {
      try {
        const js = fs.readFileSync(path.join(__dirname, 'clientloader.js'));
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
      } catch (e) {
        res.statusCode = 500; res.end('JS load error');
      }
    } else if (req.url === '/auth' && req.method === 'POST') {
      let buf = [];
      req.on('data', d => buf.push(d));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8') || '{}');
          if (password && body.password === password) {
            const sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            sessions.add(sid);
            // Ensure cookie is visible to all routes (not only /auth)
            res.writeHead(200, { 'Set-Cookie': `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Strict` });
            if (DEBUG) log('auth ok', { ip, sid: sid.slice(0,6)+'…' });
            appendLog('auth_ok', { ip });
            res.end('{"ok":true}');
          } else {
            if (DEBUG) log('auth bad password', { ip });
            appendLog('auth_fail', { ip });
            res.statusCode = 403; res.end('Forbidden');
          }
        } catch (e) { if (DEBUG) log('auth parse error', e?.message||e); appendLog('auth_error', { ip, error: String(e?.message||e) }); res.statusCode = 400; res.end('Bad Request'); }
      });
  } else if (req.url.startsWith('/stream') && req.method === 'GET') {
      if (!authorized(req)) return deny(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': connected\n\n');
      const t = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
      clients.set(res, t);
      if (DEBUG) log('SSE open', { ip, clients: clients.size });
      appendLog('sse_open', { ip, clients: clients.size });
      // Send initial client count and broadcast to others
      try { res.write(`event: meta\n` + `data: ${JSON.stringify({ clients: clients.size })}\n\n`); } catch (_) {}
      try { for (const [r] of clients) { if (r !== res) r.write(`event: meta\n` + `data: ${JSON.stringify({ clients: clients.size })}\n\n`); } } catch (_) {}
      req.on('close', () => {
        try { clearInterval(t); clients.delete(res); res.end(); } catch (_) {}
        // Broadcast updated client count on disconnect
        try { for (const [r] of clients) { r.write(`event: meta\n` + `data: ${JSON.stringify({ clients: clients.size })}\n\n`); } } catch (_) {}
      });
    } else if (req.url.startsWith('/input') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (DEBUG) log('input', { bytes: Buffer.byteLength(data) });
        appendLog('input', { bytes: Buffer.byteLength(data), preview: data.slice(0,120) });
        ttySession.write(data);
        res.writeHead(204); res.end();
      });
    } else if (req.url.startsWith('/resize') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { cols, rows } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (DEBUG) log('resize', { cols, rows });
          appendLog('resize', { cols, rows });
          ttySession.resize(cols, rows);
        } catch (e) { if (DEBUG) log('resize parse error', e?.message||e); appendLog('resize_error', { error: String(e?.message||e) }); }
        res.writeHead(204); res.end();
      });
    } else if (req.url.startsWith('/chat') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        let cmd = '';
        try { cmd = JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}').cmd || ''; } catch(_) {}
        if (DEBUG) log('chat', { cmd: cmd.slice(0,120) });
        appendLog('chat_cmd', { cmd });
        if (!cmd) { res.statusCode = 400; return res.end('{"error":"missing cmd"}'); }
        // Execute command in container and return output
        const { spawn } = require('child_process');
        const wd = workdir || process.cwd();
        const composed = `cd '${wd}' && ${cmd}`;
        const proc = spawn(runtime, ['exec', '-i', containerName, 'bash', '-lc', composed], { cwd: '/' });
        let out = Buffer.alloc(0);
        let err = Buffer.alloc(0);
        proc.stdout.on('data', d => { out = Buffer.concat([out, d]); });
        proc.stderr.on('data', d => { err = Buffer.concat([err, d]); });
        proc.on('close', (code) => {
          const text = Buffer.concat([out, err]).toString('utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, code, output: text }));
          if (DEBUG) log('chat done', { code, bytes: Buffer.byteLength(text) });
          appendLog('chat_result', { code, bytes: Buffer.byteLength(text), preview: text.slice(0,2000) });
        });
      });
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  const broadcast = (data) => {
    if (!data) return;
    const str = typeof data === 'string' ? data : data.toString('utf8');
    const chunk = 'data: ' + JSON.stringify(str) + '\n\n';
    for (const [res] of clients) { try { res.write(chunk); } catch (_) {} }
    if (DEBUG) log('broadcast', { bytes: Buffer.byteLength(chunk), clients: clients.size });
    appendLog('broadcast', { bytes: Buffer.byteLength(chunk), clients: clients.size, preview: str.slice(0,2000) });
  };

  ttySession.onOutput((d) => { appendLog('tty_output', { bytes: Buffer.byteLength(d||''), preview: String(d||'').slice(0,2000) }); broadcast(d); });
  ttySession.onClose(() => {
    if (DEBUG) log('tty closed');
    appendLog('tty_close', {});
    broadcast('\n[session closed]\n');
  });

  server.listen(port, () => {
    console.log(`Ploinky WebTTY ready: http://localhost:${port} (agent: ${agentName})`);
    console.log('Close with Ctrl+C');
    if (DEBUG) log('server started', { agentName, containerName, runtime, port, pty: !!ttySession.isPTY });
  });

  return server;
}

module.exports = { startWebTTYServer };
