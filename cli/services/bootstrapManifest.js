const fs = require('fs');
const path = require('path');
const repos = require('./repos');
const { enableAgent } = require('./agents');
const { findAgent } = require('./utils');

// Process optional manifest directives:
// - repos: { name: url, ... } => clone + enable
// - enable: [ 'agent1', 'repo/agent2', ... ] => enable agents
async function applyManifestDirectives(agentNameOrPath) {
  let manifest;
  let baseDir;
  if (agentNameOrPath.endsWith('.json')) {
    manifest = JSON.parse(fs.readFileSync(agentNameOrPath, 'utf8'));
    baseDir = path.dirname(agentNameOrPath);
  } else {
    const { manifestPath } = findAgent(agentNameOrPath);
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    baseDir = path.dirname(manifestPath);
  }

  // repos: object mapping { name: url }
  const r = manifest.repos;
  if (r && typeof r === 'object') {
    for (const [name, url] of Object.entries(r)) {
      try {
        repos.addRepo(name, url);
      } catch (_) {}
      try { repos.enableRepo(name); } catch (e) { /* ignore */ }
    }
  }

  // enable: array of agent names (short or repo/name)
  const en = manifest.enable;
  if (Array.isArray(en)) {
    for (const a of en) {
      try { enableAgent(a); } catch (_) {}
    }
  }
}

module.exports = { applyManifestDirectives };

