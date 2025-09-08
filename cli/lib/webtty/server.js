const http = require('http');
const fs = require('fs');
const path = require('path');

function startWebTTYServer({ agentName, runtime, containerName, port, ttySession, password }) {
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
    return cookies[COOKIE_NAME] && sessions.has(cookies[COOKIE_NAME]);
  }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } else if (req.url === '/auth' && req.method === 'POST') {
      let buf = [];
      req.on('data', d => buf.push(d));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8') || '{}');
          if (password && body.password === password) {
            const sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            sessions.add(sid);
            res.writeHead(200, { 'Set-Cookie': `${COOKIE_NAME}=${sid}; HttpOnly; SameSite=Strict` });
            res.end('{"ok":true}');
          } else {
            res.statusCode = 403; res.end('Forbidden');
          }
        } catch (_) { res.statusCode = 400; res.end('Bad Request'); }
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
      req.on('close', () => { try { clearInterval(t); clients.delete(res); res.end(); } catch (_) {} });
    } else if (req.url.startsWith('/input') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
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
          ttySession.resize(cols, rows);
        } catch (_) {}
        res.writeHead(204); res.end();
      });
    } else if (req.url.startsWith('/chat') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        let cmd = '';
        try { cmd = JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}').cmd || ''; } catch(_) {}
        if (!cmd) { res.statusCode = 400; return res.end('{"error":"missing cmd"}'); }
        // Execute command in container and return output
        const { spawn } = require('child_process');
        const proc = spawn(runtime, ['exec', '-w', '/agent', containerName, 'sh', '-lc', cmd]);
        let out = Buffer.alloc(0);
        let err = Buffer.alloc(0);
        proc.stdout.on('data', d => { out = Buffer.concat([out, d]); });
        proc.stderr.on('data', d => { err = Buffer.concat([err, d]); });
        proc.on('close', (code) => {
          const text = Buffer.concat([out, err]).toString('utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, code, output: text }));
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
    const lines = str.split('\n');
    let chunk = '';
    for (let i = 0; i < lines.length; i++) {
      chunk += 'data: ' + lines[i] + '\n';
    }
    chunk += '\n';
    for (const [res] of clients) { try { res.write(chunk); } catch (_) {} }
  };

  ttySession.onOutput(broadcast);
  ttySession.onClose(() => broadcast('\n[session closed]\n'));

  server.listen(port, () => {
    console.log(`Ploinky WebTTY ready: http://localhost:${port} (agent: ${agentName})`);
    console.log('Close with Ctrl+C');
  });

  return server;
}

module.exports = { startWebTTYServer };
