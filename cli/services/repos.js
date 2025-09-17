const fs = require('fs');
const path = require('path');
const { PLOINKY_DIR } = require('./config');
const { execSync, execFileSync } = require('child_process');

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

// --- Extended repo management ---

// Central registry of predefined repos (used by commands and services)
const PREDEFINED_REPOS = {
  'basic':   { url: 'https://github.com/PloinkyRepos/Basic.git', description: 'Default base agents' },
  'cloud':   { url: 'https://github.com/PloinkyRepos/cloud.git', description: 'Cloud infrastructure agents' },
  'vibe':    { url: 'https://github.com/PloinkyRepos/vibe.git', description: 'Vibe coding agents' },
  'security':{ url: 'https://github.com/PloinkyRepos/security.git', description: 'Security and scanning tools' },
  'extra':   { url: 'https://github.com/PloinkyRepos/extra.git', description: 'Additional utility agents' },
  'demo':    { url: 'https://github.com/PloinkyRepos/demo.git', description: 'Demo agents and examples' }
};

function getPredefinedRepos() { return PREDEFINED_REPOS; }

function ensureReposDir() {
  try { fs.mkdirSync(path.join(PLOINKY_DIR, 'repos'), { recursive: true }); } catch (_) {}
  return path.join(PLOINKY_DIR, 'repos');
}

function resolveRepoUrl(name, url) {
  if (url && url.trim()) return url;
  const p = PREDEFINED_REPOS[String(name||'').toLowerCase()];
  return p ? p.url : null;
}

function addRepo(name, url) {
  if (!name) throw new Error('Missing repository name.');
  const REPOS_DIR = ensureReposDir();
  const repoPath = path.join(REPOS_DIR, name);
  if (fs.existsSync(repoPath)) { return { status: 'exists', path: repoPath }; }
  const actualUrl = resolveRepoUrl(name, url);
  if (!actualUrl) throw new Error(`Missing repository URL for '${name}'.`);
  execSync(`git clone ${actualUrl} ${repoPath}`, { stdio: 'inherit' });
  return { status: 'cloned', path: repoPath };
}

function enableRepo(name) {
  if (!name) throw new Error('Missing repository name.');
  const list = loadEnabledRepos();
  if (!list.includes(name)) { list.push(name); saveEnabledRepos(list); }
  // Ensure installed
  const REPOS_DIR = ensureReposDir();
  const repoPath = path.join(REPOS_DIR, name);
  if (!fs.existsSync(repoPath)) {
    const url = resolveRepoUrl(name, null);
    if (!url) throw new Error(`No URL configured for repo '${name}'.`);
    execSync(`git clone ${url} ${repoPath}`, { stdio: 'inherit' });
  }
  return true;
}

function disableRepo(name) {
  const list = loadEnabledRepos();
  const filtered = list.filter(r => r !== name);
  saveEnabledRepos(filtered);
  return true;
}

function updateRepo(name, { rebase = true, autostash = true } = {}) {
  if (!name) throw new Error('Missing repository name.');
  const REPOS_DIR = ensureReposDir();
  const repoPath = path.join(REPOS_DIR, name);
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository '${name}' is not installed.`);
  }
  const args = ['-C', repoPath, 'pull'];
  if (rebase) args.push('--rebase');
  if (autostash) args.push('--autostash');
  execFileSync('git', args, { stdio: 'inherit' });
  return true;
}

module.exports.getPredefinedRepos = getPredefinedRepos;
module.exports.addRepo = addRepo;
module.exports.enableRepo = enableRepo;
module.exports.disableRepo = disableRepo;
module.exports.updateRepo = updateRepo;
