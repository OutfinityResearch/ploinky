const fs = require('fs');
const path = require('path');
const url = require('url');

const ROUTING_FILE = path.resolve('.ploinky/routing.json');

function readRouting() {
  try {
    return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function getStaticHostPath() {
  const cfg = readRouting();
  const hostPath = cfg?.static?.hostPath;
  if (!hostPath) return null;
  const abs = path.resolve(hostPath);
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  } catch (_) {}
  return null;
}

function dedupe(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const key = path.resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.existsSync(key) && fs.statSync(key).isDirectory()) out.push(key);
    } catch (_) {}
  }
  return out;
}

function getBaseDirs(appName, fallbackDir) {
  const dirs = [];
  const staticRoot = getStaticHostPath();
  const variants = Array.from(new Set([appName, appName.toLowerCase()]));
  if (staticRoot) {
    for (const variant of variants) {
      dirs.push(path.join(staticRoot, 'web', variant));
      dirs.push(path.join(staticRoot, 'apps', variant));
      dirs.push(path.join(staticRoot, 'static', variant));
      dirs.push(path.join(staticRoot, 'assets', variant));
      dirs.push(path.join(staticRoot, variant));
    }
    dirs.push(staticRoot);
  }
  dirs.push(fallbackDir);
  return dedupe(dirs);
}

function sanitizeRelative(relPath) {
  const cleaned = String(relPath || '').replace(/[\\]+/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('..')) return null;
  return cleaned;
}

function resolveAssetPath(appName, fallbackDir, relPath) {
  const sanitized = sanitizeRelative(relPath);
  if (!sanitized) return null;
  const bases = getBaseDirs(appName, fallbackDir);
  for (const base of bases) {
    const candidates = [
      path.join(base, sanitized),
      path.join(base, 'assets', sanitized)
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch (_) {}
    }
  }
  return null;
}

function resolveFirstAvailable(appName, fallbackDir, filenames) {
  const list = Array.isArray(filenames) ? filenames : [filenames];
  for (const name of list) {
    const filePath = resolveAssetPath(appName, fallbackDir, name);
    if (filePath) return filePath;
  }
  return null;
}

function resolveStaticFile(requestPath) {
  const root = getStaticHostPath();
  if (!root) return null;
  const rel = sanitizeRelative(requestPath);
  if (rel === null) return null;
  const candidates = [];
  // Primary candidate
  candidates.push(path.join(root, rel));
  // If request maps to directory, handle later
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        const indexFiles = ['index.html', 'index.htm', 'default.html'];
        for (const name of indexFiles) {
          const idx = path.join(candidate, name);
          if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
        }
        continue;
      }
      if (stat.isFile()) return candidate;
    } catch (_) {}
  }
  return null;
}

function serveStaticRequest(req, res) {
  const root = getStaticHostPath();
  if (!root) return false;
  try {
    const parsed = url.parse(req.url);
    const pathname = decodeURIComponent(parsed.pathname || '/');
    const rel = pathname.replace(/^\/+/, '');
    const target = resolveStaticFile(rel || '');
    if (target && sendFile(res, target)) return true;
  } catch (_) {}
  return false;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.html': 'text/html',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function sendFile(res, filePath) {
  try {
    const mime = getMimeType(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getStaticHostPath,
  resolveAssetPath,
  resolveFirstAvailable,
  sendFile,
  serveStaticRequest,
};
