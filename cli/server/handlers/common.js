const crypto = require('crypto');
const secretVars = require('../../services/secretVars');

const TOKEN_VARS = {
  webtty: 'WEBTTY_TOKEN',
  webchat: 'WEBCHAT_TOKEN',
  dashboard: 'WEBDASHBOARD_TOKEN',
  webmeet: 'WEBMEET_TOKEN',
  status: 'WEBDASHBOARD_TOKEN'
};

function loadToken(component) {
  const varName = TOKEN_VARS[component];
  if (!varName) throw new Error(`Unknown component '${component}'`);
  const fromEnv = (key) => {
    const raw = process.env[key];
    return raw && String(raw).trim();
  };
  let token = '';
  let source = 'secrets';
  try {
    const secrets = secretVars.parseSecrets();
    const raw = secrets[varName];
    if (raw && String(raw).trim()) {
      token = secretVars.resolveVarValue(varName);
    }
  } catch (_) {
    token = '';
  }
  if (!token) {
    const envToken = fromEnv(varName) || '';
    if (envToken) {
      token = envToken;
      source = 'env';
    }
  }
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    source = 'generated';
  }
  if (source !== 'secrets') {
    try { secretVars.setEnvVar(varName, token); } catch (_) {}
  }
  return token;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const map = new Map();
  header.split(';').forEach((cookie) => {
    const idx = cookie.indexOf('=');
    if (idx > -1) {
      const key = cookie.slice(0, idx).trim();
      const value = cookie.slice(idx + 1).trim();
      if (key) map.set(key, value);
    }
  });
  return map;
}

function buildCookie(name, value, req, pathPrefix, options = {}) {
  const parts = [`${name}=${value}`];
  const prefix = pathPrefix || '/';
  parts.push(`Path=${prefix}`);
  parts.push('HttpOnly');
  parts.push('SameSite=Strict');
  const secure = Boolean(req.socket && req.socket.encrypted) ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
  if (secure) parts.push('Secure');
  // Use custom maxAge if provided, otherwise default to 7 days
  const maxAge = options.maxAge || 604800;
  parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  loadToken,
  parseCookies,
  buildCookie,
  readJsonBody
};
