import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'url';

const ROUTING_FILE = path.resolve('.ploinky/routing.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const MCP_BROWSER_CLIENT_URL = '/MCPBrowserClient.js';
const MCP_BROWSER_CLIENT_FILE = path.resolve(PROJECT_ROOT, 'Agent/client/MCPBrowserClient.js');

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
  try {
    const parsed = parse(req.url);
    const pathname = decodeURIComponent(parsed.pathname || '/');
    if (pathname === MCP_BROWSER_CLIENT_URL) {
      try {
        const data = fs.readFileSync(MCP_BROWSER_CLIENT_FILE);
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(data);
        return true;
      } catch (err) {
        return false;
      }
    }

    const root = getStaticHostPath();
    if (!root) return false;

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

export {
  getStaticHostPath,
  resolveAssetPath,
  resolveFirstAvailable,
  sendFile,
  serveStaticRequest,
};

// --- Agent-specific static routing ---
function getAgentHostPath(agentName) {
  const cfg = readRouting();
  const rec = cfg && cfg.routes ? cfg.routes[agentName] : null;
  if (!rec || !rec.hostPath) return null;
  try {
    const abs = path.resolve(rec.hostPath);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  } catch (_) {}
  return null;
}

function safeJoin(base, rel) {
  const cleaned = sanitizeRelative(rel || '');
  if (cleaned === null) return null;
  const p = path.join(base, cleaned);
  const absBase = path.resolve(base);
  const abs = path.resolve(p);
  if (!abs.startsWith(absBase)) return null; // prevent traversal outside base
  return abs;
}

function resolveAgentStaticFile(agentName, agentRelPath) {
  const root = getAgentHostPath(agentName);
  if (!root) return null;
  const candidate = safeJoin(root, agentRelPath);
  if (!candidate) return null;
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      const indexFiles = ['index.html', 'index.htm', 'default.html'];
      for (const name of indexFiles) {
        const idx = path.join(candidate, name);
        if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
      }
      return null;
    }
    if (stat.isFile()) return candidate;
  } catch (_) { return null; }
  return null;
}

function serveAgentStaticRequest(req, res) {
  try {
    const parsed = parse(req.url);
    const pathname = decodeURIComponent(parsed.pathname || '/');
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 2) return false; // need /agent/...
    const agent = parts[0];
    const rest = parts.slice(1).join('/');
    const target = resolveAgentStaticFile(agent, rest);
    if (target && sendFile(res, target)) return true;
  } catch (_) {}
  return false;
}

export { getAgentHostPath, resolveAgentStaticFile, serveAgentStaticRequest };
