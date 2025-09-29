const fs = require('fs');
const path = require('path');
const workspace = require('./workspace');
const { getAgentContainerName } = require('./docker');
const { findAgent } = require('./utils');
const { REPOS_DIR } = require('./config');

// Enable (register) an agent in workspace registry so start/stop/status can manage it
function enableAgent(agentName, mode, repoNameParam) {
  const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const agentPath = path.dirname(manifestPath);
  const containerName = getAgentContainerName(shortAgentName, repoName);

  const normalizedMode = (mode || '').toLowerCase();
  let runMode = 'isolated';
  let projectPath = '';

  if (!normalizedMode || normalizedMode === 'default') {
    // If an existing record exists for this agent/repo, preserve its projectPath/runMode
    try {
      const current = workspace.loadAgents();
      const existing = Object.values(current || {}).find(r => r && r.type === 'agent' && r.agentName === shortAgentName && r.repoName === repoName);
      if (existing && existing.projectPath) {
        projectPath = existing.projectPath;
        runMode = existing.runMode === 'default' ? 'isolated' : (existing.runMode || 'isolated');
      }
    } catch(_) {}
    if (!projectPath) {
      runMode = 'isolated';
      projectPath = path.join(process.cwd(), shortAgentName);
      try { fs.mkdirSync(projectPath, { recursive: true }); } catch(_) {}
    }
  } else if (normalizedMode === 'global') {
    runMode = 'global';
    projectPath = process.cwd();
  } else if (normalizedMode === 'devel') {
    const repoCandidate = String(repoNameParam || '').trim();
    if (!repoCandidate) {
      throw new Error("enable agent devel: missing repoName. Usage: enable agent <name> devel <repoName>");
    }
    const repoPath = path.join(REPOS_DIR, repoCandidate);
    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      throw new Error(`Repository '${repoCandidate}' not found in ${path.join(REPOS_DIR)}`);
    }
    runMode = 'devel';
    projectPath = repoPath;
  } else {
    throw new Error(`Unknown mode '${mode}'. Allowed: global | devel`);
  }

  const record = {
    agentName: shortAgentName,
    repoName,
    containerImage: manifest.container || manifest.image || 'node:18-alpine',
    createdAt: new Date().toISOString(),
    projectPath,
    runMode,
    develRepo: runMode === 'devel' ? String(repoNameParam || '') : undefined,
    type: 'agent',
    config: {
      binds: [
        { source: projectPath, target: projectPath },
        { source: path.resolve(__dirname, '../../../Agent'), target: '/Agent' },
        { source: agentPath, target: '/code' }
      ],
      env: [],
      ports: [ { containerPort: 7000 } ]
    }
  };
  const map = workspace.loadAgents();
  // Migrate any old entries for the same agent to the new key
  for (const key of Object.keys(map)) {
    const r = map[key];
    if (r && r.agentName === shortAgentName && key !== containerName) {
      try { delete map[key]; } catch(_) {}
    }
  }
  map[containerName] = record;
  workspace.saveAgents(map);
  return { containerName, repoName, shortAgentName };
}

module.exports = { enableAgent };
