const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envSvc = require('../services/secretVars');

const COMPONENTS = {
  webtty: { varName: 'WEBTTY_TOKEN', label: 'WebTTY', path: '/webtty' },
  webchat: { varName: 'WEBCHAT_TOKEN', label: 'WebChat', path: '/webchat' },
  dashboard: { varName: 'WEBDASHBOARD_TOKEN', label: 'Dashboard', path: '/dashboard' },
  webmeet: { varName: 'WEBMEET_TOKEN', label: 'WebMeet', path: '/webmeet' }
};

function getRouterPort() {
  let port = null;
  try {
    const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8'));
    if (routing && routing.port) {
      const candidate = parseInt(routing.port, 10);
      if (!Number.isNaN(candidate) && candidate > 0) port = candidate;
    }
  } catch (_) {}
  if (!port) {
    try {
      const val = parseInt(envSvc.resolveVarValue('ROUTER_PORT'), 10);
      if (!Number.isNaN(val) && val > 0) port = val;
    } catch (_) {}
  }
  if (!port) {
    const envPort = parseInt(process.env.ROUTER_PORT || '', 10);
    if (!Number.isNaN(envPort) && envPort > 0) port = envPort;
  }
  return port || 8080;
}

function maskToken(token) {
  if (typeof token !== 'string') return '';
  return token.slice(0, 5);
}

function refreshComponentToken(component, { quiet } = {}) {
  const spec = COMPONENTS[component];
  if (!spec) throw new Error(`Unknown component '${component}'`);
  const token = crypto.randomBytes(32).toString('hex');
  envSvc.setEnvVar(spec.varName, token);
  if (!quiet) {
    const port = getRouterPort();
    console.log(`✓ ${spec.label} token refreshed (${maskToken(token)}…).`);
    console.log(`  Visit: http://127.0.0.1:${port}${spec.path}?token=<stored in ${spec.varName} in .ploinky/.secrets>`);
  }
  return token;
}

function getComponentToken(component) {
  const spec = COMPONENTS[component];
  if (!spec) throw new Error(`Unknown component '${component}'`);
  try {
    const val = envSvc.resolveVarValue(spec.varName);
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  } catch (_) {}
  return null;
}

function ensureComponentToken(component, { quiet } = {}) {
  const spec = COMPONENTS[component];
  if (!spec) throw new Error(`Unknown component '${component}'`);
  const existing = getComponentToken(component);
  if (existing) {
    if (!quiet) {
      const port = getRouterPort();
      console.log(`✓ ${spec.label} token ready (${maskToken(existing)}…).`);
      console.log(`  Visit: http://127.0.0.1:${port}${spec.path}?token=<stored in ${spec.varName} in .ploinky/.secrets>`);
    }
    return existing;
  }
  return refreshComponentToken(component, { quiet });
}

module.exports = {
  COMPONENTS,
  getRouterPort,
  refreshComponentToken,
  ensureComponentToken,
  getComponentToken
};
