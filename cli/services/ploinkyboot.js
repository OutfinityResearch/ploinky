const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PLOINKY_DIR } = require('./config');
const repos = require('./repos');

const DEFAULT_REPO_URL = 'https://github.com/PloinkyRepos/Basic.git';

function ensureDefaultRepo() {
  const reposDir = path.join(PLOINKY_DIR, 'repos');
  const defaultRepoPath = path.join(reposDir, 'basic');
  try { fs.mkdirSync(reposDir, { recursive: true }); } catch (_) {}
  if (!fs.existsSync(defaultRepoPath)) {
    console.log(`Default 'basic' repository not found. Cloning...`);
    try {
      execSync(`git clone ${DEFAULT_REPO_URL} ${defaultRepoPath}`, { stdio: 'inherit' });
      console.log('Default repository cloned successfully.');
    } catch (error) {
      console.error(`Error cloning default repository: ${error.message}`);
    }
  }
}

function bootstrap() {
  ensureDefaultRepo();
  // Ensure 'basic' is enabled by default if present
  try {
    const list = repos.loadEnabledRepos();
    const basicPath = path.join(PLOINKY_DIR, 'repos', 'basic');
    if (fs.existsSync(basicPath) && !list.includes('basic')) {
      list.push('basic');
      repos.saveEnabledRepos(list);
    }
  } catch (_) {}
}

module.exports = { bootstrap };
