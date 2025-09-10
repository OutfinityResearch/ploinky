const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PLOINKY_DIR } = require('./config');

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
}

module.exports = { bootstrap };

