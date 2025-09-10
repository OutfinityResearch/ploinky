// Moved from cloud/RoutingServer.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');

const ROUTING_DIR = path.resolve('.ploinky');
const ROUTING_FILE = path.join(ROUTING_DIR, 'routing.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')) || {}; } catch (_) { return {}; }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(ROUTING_DIR, { recursive: true }); fs.writeFileSync(ROUTING_FILE, JSON.stringify(cfg, null, 2)); } catch (_) {}
}

function serveStatic(req, res, cfg) {
  const base = (cfg.static && cfg.static.hostPath) ? cfg.static.hostPath : process.cwd();
  const parsed = url.parse(req.url);
  let rel = decodeURIComponent(parsed.pathname || '/');
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(base, rel);
  if (!filePath.startsWith(base)) { res.statusCode = 403; return res.end('Forbidden'); }
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200); res.end(data);
  } catch (e) {
    res.statusCode = 404; res.end('Not found');
  }
}

function postJsonToAgent(port, json, cb) {
  const data = Buffer.from(JSON.stringify(json||{}), 'utf8');
  const out = http.request({ hostname: '127.0.0.1', port, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (r) => {
    const chunks = [];
    r.on('data', d => chunks.push(d));
    r.on('end', () => cb(null, r, Buffer.concat(chunks)));
  });
  out.on('error', (e) => cb(e));
  out.write(data);
  out.end();
}

function proxyApi(req, res, targetPort) {
  // For POST: stream to upstream as JSON; for GET, convert query params to JSON and POST
  if (req.method === 'GET') {
    const u = url.parse(req.url);
    const params = querystring.parse(u.query || '');
    return postJsonToAgent(targetPort, params, (err, r, body) => {
      if (err) { res.statusCode = 502; return res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(err) })); }
      res.writeHead(r.statusCode || 200, r.headers);
      res.end(body);
    });
  }
  // Default: POST/others pipe through
  const opts = { hostname: '127.0.0.1', port: targetPort, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const out = http.request(opts, (r) => {
    let buf = [];
    r.on('data', d => buf.push(d));
    r.on('end', () => { const body = Buffer.concat(buf); res.writeHead(r.statusCode || 200, r.headers); res.end(body); });
  });
  out.on('error', (e) => { res.statusCode = 502; res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(e) })); });
  req.pipe(out);
}

function start(port) {
  const server = http.createServer((req, res) => {
    const cfg = loadConfig();
    const u = url.parse(req.url || '/');
    // Health/inspection endpoint
    if (u.pathname === '/list-agents/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, port, static: cfg.static || null, routes: cfg.routes || {} }));
    }
    // API routing: /apis/:agent -> proxy to hostPort
    if (u.pathname && u.pathname.startsWith('/apis/')) {
      const agent = u.pathname.split('/')[2];
      const route = (cfg.routes && cfg.routes[agent]) || null;
      if (!route || !route.hostPort) {
        const keys = Object.keys((cfg.routes)||{});
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: 'route not found', agent, available: keys }));
      }
      return proxyApi(req, res, route.hostPort);
    }
    return serveStatic(req, res, cfg);
  });
  server.listen(port, () => {
    console.log(`[RoutingServer] listening on http://127.0.0.1:${port}`);
  });
}

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8088;
start(port);
