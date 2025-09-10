const fs = require('fs');
const path = require('path');
const { AGENTS_FILE, PLOINKY_DIR } = require('./config');

function ensureDirs() {
  try { fs.mkdirSync(PLOINKY_DIR, { recursive: true }); } catch (_) {}
}

function loadAgents() {
  ensureDirs();
  try {
    if (!fs.existsSync(AGENTS_FILE)) return {};
    const data = fs.readFileSync(AGENTS_FILE, 'utf8');
    return JSON.parse(data || '{}') || {};
  } catch (_) { return {}; }
}

function saveAgents(map) {
  ensureDirs();
  try { fs.writeFileSync(AGENTS_FILE, JSON.stringify(map || {}, null, 2)); } catch (_) {}
}

function listAgents() { return Object.values(loadAgents()); }

function getAgentRecord(containerName) {
  const map = loadAgents();
  return map[containerName] || null;
}

function upsertAgent(containerName, record) {
  const map = loadAgents();
  map[containerName] = { ...(record || {}) };
  saveAgents(map);
}

function removeAgent(containerName) {
  const map = loadAgents();
  delete map[containerName];
  saveAgents(map);
}

module.exports = { loadAgents, saveAgents, listAgents, getAgentRecord, upsertAgent, removeAgent };
// Optional top-level config (stored under _config)
function getConfig() {
  const map = loadAgents();
  return map._config || {};
}
function setConfig(cfg) {
  const map = loadAgents();
  map._config = cfg || {};
  saveAgents(map);
}

module.exports.getConfig = getConfig;
module.exports.setConfig = setConfig;
