const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROUTING_DIR = path.resolve('.ploinky');
const ROUTING_FILE = path.join(ROUTING_DIR, 'routing.json');
const { createBufferedLogger } = require('../logs/logger');
const WEB_LOG_FILE = path.join(process.cwd(), 'web.logs');
const logger = createBufferedLogger(WEB_LOG_FILE, { flushIntervalMs: 1500 });

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
    logger.write({ type: 'static_hit', path: rel, file: filePath });
    res.writeHead(200); res.end(data);
  } catch (e) {
    logger.write({ type: 'static_miss', path: rel });
    res.statusCode = 404; res.end('Not found');
  }
}

function proxyApi(req, res, targetPort) {
  const opts = { hostname: '127.0.0.1', port: targetPort, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json' } };
  logger.write({ type: 'proxy_start', port: targetPort });
  const out = http.request(opts, (r) => {
    let buf = [];
    r.on('data', d => buf.push(d));
    r.on('end', () => {
      const body = Buffer.concat(buf);
      logger.write({ type: 'proxy_done', port: targetPort, status: r.statusCode, bytes: body.length });
      res.writeHead(r.statusCode || 200, r.headers); res.end(body);
    });
  });
  out.on('error', (e) => { logger.write({ type: 'proxy_err', error: String(e) }); res.statusCode = 502; res.end(JSON.stringify({ ok: false, error: 'upstream error', detail: String(e) })); });
  req.pipe(out);
}

function start(port) {
  const server = http.createServer((req, res) => {
    const cfg = loadConfig();
    const u = url.parse(req.url || '/');
    logger.write({ type: 'request', method: req.method, path: u.pathname });
    // Health/inspection endpoint
    if (u.pathname === '/list-agents/' && req.method === 'GET') {
      logger.write({ type: 'health' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, port, static: cfg.static || null, routes: cfg.routes || {} }));
    }
    // API routing: /apis/:agent -> proxy to hostPort
    if (u.pathname && u.pathname.startsWith('/apis/')) {
      const agent = u.pathname.split('/')[2];
      const route = (cfg.routes && cfg.routes[agent]) || null;
      if (!route || !route.hostPort) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, error: 'route not found' })); }
      return proxyApi(req, res, route.hostPort);
    }
    // Default: static serving
    return serveStatic(req, res, cfg);
  });
  server.listen(port, () => {
    console.log(`[RoutingServer] listening on http://127.0.0.1:${port}`);
    logger.write({ type: 'start', port });
  });
}

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8088;
start(port);
