const fs = require('fs');
const path = require('path');
const { PLOINKY_DIR } = require('./config');

const ENABLED_REPOS_FILE = path.join(PLOINKY_DIR, 'enabled_repos.json');

function loadEnabledRepos() {
  try {
    const raw = fs.readFileSync(ENABLED_REPOS_FILE, 'utf8');
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

function saveEnabledRepos(list) {
  try { fs.mkdirSync(PLOINKY_DIR, { recursive: true }); fs.writeFileSync(ENABLED_REPOS_FILE, JSON.stringify(list || [], null, 2)); } catch (_) {}
}

function getInstalledRepos(REPOS_DIR) {
  try { return fs.readdirSync(REPOS_DIR).filter(n => { try { return fs.statSync(path.join(REPOS_DIR, n)).isDirectory(); } catch (_) { return false; } }); } catch (_) { return []; }
}

function getActiveRepos(REPOS_DIR) {
  const enabled = loadEnabledRepos();
  if (enabled && enabled.length) return enabled;
  // Fallback to installed if none explicitly enabled
  return getInstalledRepos(REPOS_DIR);
}

module.exports = { loadEnabledRepos, saveEnabledRepos, getInstalledRepos, getActiveRepos, ENABLED_REPOS_FILE };

