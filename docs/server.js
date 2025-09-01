// Simple static file server without external dependencies
// Usage: node server.js [--port 8080]
// Serves files from the current working directory

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = process.cwd();
const argvPort = (() => {
  const i = process.argv.indexOf('--port');
  if (i !== -1 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return undefined;
})();
const PORT = argvPort || Number(process.env.PORT) || 8083;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
};

function safeJoin(root, requestPath) {
  // Decode and normalize path; prevent path traversal
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const joined = path.join(root, normalized);
  if (!joined.startsWith(root)) {
    return null;
  }
  return joined;
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('404 Not Found');
}

function serveFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const ctype = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': ctype,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store', // dev: always fetch fresh
    'Last-Modified': stat.mtime.toUTCString()
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  });
  stream.pipe(res);
}

function tryServeIndex(dirPath, req, res) {
  const indexPath = path.join(dirPath, 'index.html');
  fs.stat(indexPath, (err, st) => {
    if (err || !st.isFile()) return sendNotFound(res);
    serveFile(req, res, indexPath, st);
  });
}

const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url);
    const pathname = parsed.pathname || '/';
    const filePath = safeJoin(ROOT, pathname);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
      if (err) {
        // If path doesn't exist, optionally fallback to index.html for SPA
        // Here we return 404 to keep behavior explicit for static testing
        return sendNotFound(res);
      }
      if (stat.isDirectory()) {
        return tryServeIndex(filePath, req, res);
      }
      return serveFile(req, res, filePath, stat);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`);
  console.log(`Serving: ${ROOT}`);
});

