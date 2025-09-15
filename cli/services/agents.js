const fs = require('fs');
const path = require('path');
const workspace = require('./workspace');
const { getAgentContainerName } = require('./docker');
const { findAgent } = require('./utils');

// Enable (register) an agent in workspace registry so start/stop/status can manage it
function enableAgent(agentName) {
  const { manifestPath, repo: repoName, shortAgentName } = findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const agentPath = path.dirname(manifestPath);
  const containerName = getAgentContainerName(shortAgentName, repoName);
  const record = {
    agentName: shortAgentName,
    repoName,
    containerImage: manifest.container || manifest.image || 'node:18-alpine',
    createdAt: new Date().toISOString(),
    projectPath: process.cwd(),
    type: 'agent',
    config: {
      binds: [ { source: process.cwd(), target: process.cwd() }, { source: path.resolve(__dirname, '../../../Agent'), target: '/Agent' }, { source: agentPath, target: '/code' } ],
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

