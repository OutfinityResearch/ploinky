const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve('.ploinky');
const BLOBS_DIR = path.join(ROOT_DIR, 'blobs');

function ensureDirs() {
  try { fs.mkdirSync(BLOBS_DIR, { recursive: true }); } catch (_) {}
}

function newId() { return crypto.randomBytes(24).toString('hex'); }

function getPaths(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe !== id) return null;
  const filePath = path.join(BLOBS_DIR, `${safe}`);
  const metaPath = path.join(BLOBS_DIR, `${safe}.json`);
  return { filePath, metaPath };
}

function readMeta(id) {
  ensureDirs();
  const p = getPaths(id); if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p.metaPath, 'utf8')); } catch (_) { return null; }
}

function writeMeta(id, meta) {
  ensureDirs();
  const p = getPaths(id); if (!p) return false;
  try { fs.writeFileSync(p.metaPath, JSON.stringify(meta || {}, null, 2)); return true; } catch (_) { return false; }
}

function handlePost(req, res) {
  try {
    ensureDirs();
    const mime = req.headers['x-mime-type'] || req.headers['content-type'] || 'application/octet-stream';
    const id = newId();
    const p = getPaths(id);
    if (!p) { res.writeHead(400); return res.end('Bad id'); }
    const out = fs.createWriteStream(p.filePath);
    let size = 0;
    req.on('data', chunk => { size += chunk.length; });
    req.pipe(out);
    out.on('finish', () => {
      const meta = { id, mime, size, createdAt: new Date().toISOString() };
      writeMeta(id, meta);
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ id, url: `/blobs/${id}`, size, mime }));
    });
    out.on('error', (e) => { try { fs.unlinkSync(p.filePath); } catch(_){}; res.writeHead(500); res.end('Write error'); });
  } catch (e) {
    res.writeHead(500); res.end('Upload error');
  }
}

function streamRange(req, res, filePath, meta) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const range = req.headers['range'];
    if (range && /^bytes=/.test(range)) {
      const m = range.match(/bytes=(\d+)-(\d+)?/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (start <= end && start < size) {
          res.writeHead(206, {
            'Content-Type': meta?.mime || 'application/octet-stream',
            'Content-Length': (end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff'
          });
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }
      }
    }
    // Full response
    res.writeHead(200, {
      'Content-Type': meta?.mime || 'application/octet-stream',
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end('Read error');
  }
}

function handleGetHead(req, res, id, isHead = false) {
  try {
    ensureDirs();
    const p = getPaths(id); if (!p) { res.writeHead(400); return res.end('Bad id'); }
    const meta = readMeta(id) || {};
    if (!fs.existsSync(p.filePath)) { res.writeHead(404); return res.end('Not Found'); }
    if (req.method === 'HEAD' || isHead) {
      const stat = fs.statSync(p.filePath);
      res.writeHead(200, {
        'Content-Type': meta?.mime || 'application/octet-stream',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end();
    }
    return streamRange(req, res, p.filePath, meta);
  } catch (e) {
    res.writeHead(500); res.end('Error');
  }
}

function handleBlobs(req, res) {
  const u = require('url').parse(req.url || '', true);
  const pathname = u.pathname || '/blobs';
  if (pathname === '/blobs' && req.method === 'POST') return handlePost(req, res);
  if (pathname.startsWith('/blobs/')) {
    const id = pathname.substring('/blobs/'.length);
    if (!id) { res.writeHead(400); return res.end('Missing id'); }
    return handleGetHead(req, res, id, req.method === 'HEAD');
  }
  res.writeHead(404); res.end('Not Found');
}

module.exports = { handleBlobs };

