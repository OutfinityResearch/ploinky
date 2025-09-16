const fs = require('fs');
const path = require('path');
const { SECRETS_FILE } = require('./config');

function ensureSecretsFile() {
  try {
    const dir = path.dirname(SECRETS_FILE);
    if (dir && dir !== '.') { try { fs.mkdirSync(dir, { recursive: true }); } catch(_){} }
    if (!fs.existsSync(SECRETS_FILE)) {
      fs.writeFileSync(SECRETS_FILE, '# Ploinky secrets\n');
    }
  } catch(_) {}
}

function parseSecrets() {
  ensureSecretsFile();
  const map = {};
  try {
    const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
    for (const line of (raw.split('\n')||[])) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx+1);
        if (k) map[k] = v;
      }
    }
  } catch(_) {}
  return map;
}

function setEnvVar(name, value) {
  if (!name) throw new Error('Missing variable name.');
  ensureSecretsFile();
  let lines = [];
  try { lines = (fs.readFileSync(SECRETS_FILE,'utf8').split('\n')); } catch(_) { lines = []; }
  const envLine = `${name}=${value ?? ''}`;
  const idx = lines.findIndex(l => String(l).startsWith(name + '='));
  if (idx >= 0) lines[idx] = envLine; else lines.push(envLine);
  fs.writeFileSync(SECRETS_FILE, lines.filter(x => x !== undefined).join('\n'));
}

function deleteVar(name) {
  if (!name) return;
  ensureSecretsFile();
  let lines = [];
  try { lines = (fs.readFileSync(SECRETS_FILE,'utf8').split('\n')); } catch(_) { lines = []; }
  const idx = lines.findIndex(l => String(l).startsWith(name + '='));
  if (idx >= 0) {
    lines.splice(idx, 1);
    fs.writeFileSync(SECRETS_FILE, lines.join('\n'));
  }
}

function declareVar(name) {
  return setEnvVar(name, '');
}

function resolveAlias(value, secrets, seen = new Set()) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('$')) return value;
  const ref = value.slice(1);
  if (!ref || seen.has(ref)) return '';
  seen.add(ref);
  const next = secrets[ref];
  if (next === undefined) return '';
  return resolveAlias(next, secrets, seen);
}

function resolveVarValue(name) {
  const secrets = parseSecrets();
  const raw = secrets[name];
  if (raw === undefined) return '';
  return resolveAlias(raw, secrets);
}

function getExposedNames(manifest) {
  const names = new Set();
  if (Array.isArray(manifest?.env)) manifest.env.forEach(n => names.add(String(n)));
  const exp = manifest?.expose;
  if (Array.isArray(exp)) { exp.forEach(e => { if (e && e.name) names.add(String(e.name)); }); }
  else if (exp && typeof exp === 'object') { Object.keys(exp).forEach(n => names.add(String(n))); }
  return Array.from(names);
}

function buildEnvFlags(manifest) {
  const secrets = parseSecrets();
  const out = [];
  // Legacy env array
  if (Array.isArray(manifest?.env)) {
    for (const k of manifest.env) {
      const val = resolveAlias(secrets[k], secrets);
      if (val !== undefined) out.push(`-e ${k}=${val ?? ''}`);
    }
  }
  const exp = manifest?.expose;
  if (Array.isArray(exp)) {
    for (const spec of exp) {
      if (!spec || !spec.name) continue;
      if (Object.prototype.hasOwnProperty.call(spec, 'value')) {
        out.push(`-e ${spec.name}=${spec.value}`);
      } else if (spec.ref) {
        const v = resolveAlias('$' + spec.ref, secrets);
        if (v !== undefined) out.push(`-e ${spec.name}=${v ?? ''}`);
      }
    }
  } else if (exp && typeof exp === 'object') {
    for (const [name, val] of Object.entries(exp)) {
      if (typeof val === 'string' && val.startsWith('$')) {
        const v = resolveAlias(val, secrets);
        if (v !== undefined) out.push(`-e ${name}=${v ?? ''}`);
      } else if (val !== undefined) {
        out.push(`-e ${name}=${val}`);
      }
    }
  }
  return out;
}

// Build a map of ENV_NAME -> value (resolved) for manifest.env + expose
function buildEnvMap(manifest) {
  const secrets = parseSecrets();
  const out = {};
  if (Array.isArray(manifest?.env)) {
    for (const k of manifest.env) {
      const val = resolveAlias(secrets[k], secrets);
      out[k] = val ?? '';
    }
  }
  const exp = manifest?.expose;
  if (Array.isArray(exp)) {
    for (const spec of exp) {
      if (!spec || !spec.name) continue;
      if (Object.prototype.hasOwnProperty.call(spec, 'value')) out[spec.name] = String(spec.value);
      else if (spec.ref) out[spec.name] = resolveAlias('$' + spec.ref, secrets) ?? '';
    }
  } else if (exp && typeof exp === 'object') {
    for (const [name, val] of Object.entries(exp)) {
      if (typeof val === 'string' && val.startsWith('$')) out[name] = resolveAlias(val, secrets) ?? '';
      else out[name] = val !== undefined ? String(val) : '';
    }
  }
  return out;
}

function updateAgentExpose(manifestPath, exposedName, src) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if (!manifest.expose) manifest.expose = [];
  if (!Array.isArray(manifest.expose)) {
    const obj = manifest.expose;
    manifest.expose = Object.entries(obj).map(([name,val]) => (
      (typeof val === 'string' && val.startsWith('$')) ? { name, ref: val.slice(1) } : { name, value: val }
    ));
  }
  manifest.expose = manifest.expose.filter(e => e && e.name !== exposedName);
  if (src && typeof src === 'string') {
    if (src.startsWith('$')) manifest.expose.push({ name: exposedName, ref: src.slice(1) });
    else manifest.expose.push({ name: exposedName, value: src });
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

module.exports = {
  parseSecrets,
  setEnvVar,
  deleteVar,
  declareVar,
  buildEnvFlags,
  updateAgentExpose,
  resolveVarValue,
  getExposedNames,
  buildEnvMap,
};
