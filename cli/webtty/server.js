const http = require('http');
const fs = require('fs');
const path = require('path');

function startWebTTYServer({ agentName, runtime, containerName, port, ttyFactory, password, workdir, entry, title }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty]', ...args); };
  const LOG_PATH = path.resolve(process.cwd(), 'webtty.logs');
  function appendLog(type, data) {
    try { const entry = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n'; fs.appendFileSync(LOG_PATH, entry); }
    catch (e) { if (DEBUG) log('file log error', e?.message||e); }
  }
  const templatePath = path.join(__dirname, 'index.html');
  let indexHtml = fs.readFileSync(templatePath, 'utf8');
  indexHtml = indexHtml
    .replace(/__AGENT_NAME__/g, agentName)
    .replace(/__CONTAINER_NAME__/g, containerName)
    .replace(/__RUNTIME__/g, runtime)
    .replace(/__REQUIRES_AUTH__/g, password ? 'true' : 'false');
  indexHtml = indexHtml.replace('<body ', `<body data-title="${(title||agentName).replace(/"/g,'&quot;')}" `);

  const clients = new Map();
  const sessions = new Set();
  const clientSessions = new Map();
  const COOKIE_NAME = 'webtty_auth';
  function parseCookies(hdr) { const out = {}; if (!hdr) return out; hdr.split(';').forEach(p => { const [k,v] = p.trim().split('='); out[k] = v; }); return out; }
  function authorized(req) { if (!password) return true; const c = parseCookies(req.headers['cookie']); return !!(c[COOKIE_NAME] && sessions.has(c[COOKIE_NAME])); }
  function deny(res) { res.statusCode = 401; res.end('Unauthorized'); }

  const server = http.createServer((req, res) => {
    const ip = req.socket?.remoteAddress;
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } else if (req.url === '/assets/webtty.css' && req.method === 'GET') {
      try { const css = fs.readFileSync(path.join(__dirname, 'webtty.css')); res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(css); }
      catch { res.statusCode = 500; res.end('CSS load error'); }
    } else if (req.url === '/assets/clientloader.js' && req.method === 'GET') {
      try { const js = fs.readFileSync(path.join(__dirname, 'clientloader.js')); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(js); }
      catch { res.statusCode = 500; res.end('JS load error'); }
    } else if (req.url === '/auth' && req.method === 'POST') {
      let buf = []; req.on('data', d => buf.push(d)); req.on('end', () => {
        try { const body = JSON.parse(Buffer.concat(buf).toString('utf8') || '{}'); if (password && body.password === password) {
          const sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); sessions.add(sid);
          res.writeHead(200, { 'Set-Cookie': `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Strict` }); res.end('{"ok":true}');
        } else { res.statusCode = 403; res.end('Forbidden'); } } catch { res.statusCode = 400; res.end('Bad Request'); }
      });
    } else if (req.url.startsWith('/stream') && req.method === 'GET') {
      if (!authorized(req)) return deny(res);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME];
      try { const prev = clientSessions.get(sid); if (prev && prev.sseRes && prev.sseRes !== res) { try { prev.sseRes.end(); } catch(_){} } } catch(_){}
      const t = setInterval(() => { try { res.write(': ping\n\n'); } catch(_){} }, 15000); clients.set(res, t);
      appendLog('sse_open', { ip });
      if (!clientSessions.has(sid)) { const tty = ttyFactory.create(); const unsub = tty.onOutput((d)=>{ try { res.write('data: ' + JSON.stringify(String(d||'')) + '\n\n'); } catch(_){} }); clientSessions.set(sid, { tty, sseRes: res, hb: t, unsub, queue: Promise.resolve() }); }
      else { const sess = clientSessions.get(sid); sess.sseRes=res; sess.hb=t; const unsub=sess.tty.onOutput((d)=>{ try { res.write('data: ' + JSON.stringify(String(d||'')) + '\n\n'); } catch(_){} }); sess.unsub=unsub; }
      req.on('close', () => { try { clearInterval(t); clients.delete(res); } catch(_){} try { const sess = clientSessions.get(sid); if (sess && sess.unsub) { try { sess.unsub(); } catch(_){} } if (sess && sess.tty) { try { sess.tty.close(); } catch(_){} } clientSessions.delete(sid); } catch(_){} appendLog('sse_close', { ip }); });
    } else if (req.url.startsWith('/input') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { const data = Buffer.concat(chunks).toString('utf8'); try { const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME]; const sess = clientSessions.get(sid); sess?.tty?.write?.(data); } catch(_){} res.writeHead(204); res.end(); });
    } else if (req.url.startsWith('/resize') && req.method === 'POST') {
      if (!authorized(req)) return deny(res);
      const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { const { cols, rows } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); try { const cookies = parseCookies(req.headers['cookie']); const sid = cookies[COOKIE_NAME]; const sess = clientSessions.get(sid); sess?.tty?.resize?.(cols, rows); } catch(_){} } catch(_){} res.writeHead(204); res.end(); });
    } else { res.statusCode = 404; res.end('Not found'); }
  });
  server.listen(port, () => { console.log(`Ploinky WebTTY ready: http://localhost:${port} (agent: ${agentName})`); console.log('Close with Ctrl+C'); appendLog('server_start', { port }); });
  return server;
}

module.exports = { startWebTTYServer };
