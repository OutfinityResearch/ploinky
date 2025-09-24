const fs = require('fs');
const path = require('path');

const { PLOINKY_DIR } = require('./config');
const reposSvc = require('./repos');

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const PREDEFINED_REPOS = reposSvc.getPredefinedRepos();

function findAgentManifest(agentName) {
  const { findAgent } = require('./utils');
  const { manifestPath } = findAgent(agentName);
  return manifestPath;
}

function listRepos() {
  const enabled = new Set(reposSvc.loadEnabledRepos());
  const installed = new Set(reposSvc.getInstalledRepos(REPOS_DIR));
  const allRepos = { ...PREDEFINED_REPOS };

  for (const repo of installed) {
    if (!allRepos[repo]) {
      allRepos[repo] = { url: 'local', description: '' };
    }
  }

  console.log('Available repositories:');
  for (const [name, info] of Object.entries(allRepos)) {
    const isInstalled = installed.has(name);
    const isEnabled = enabled.has(name);
    const flags = `${isInstalled ? '[installed]' : ''}${isEnabled ? ' [enabled]' : ''}`.trim();
    const url = info.url === 'local' ? '(local)' : info.url;
    console.log(`- ${name}: ${url} ${flags ? ' ' + flags : ''}`);
  }
  console.log("\nTip: enable repos with 'enable repo <name>'. If none are enabled, installed repos are used by default for agent listings.");
}

function listCurrentAgents() {
  try {
    const { getAgentsRegistry } = require('./docker');
    const reg = getAgentsRegistry();
    const names = Object.keys(reg || {});
    if (!names.length) { console.log('No agents recorded for this workspace yet.'); return; }
    console.log('Current agents (from .ploinky/agents):');
    for (const name of names) {
      const r = reg[name] || {};
      const type = r.type || '-';
      const agent = r.agentName || '-';
      const repo = r.repoName || '-';
      const img = r.containerImage || '-';
      const cwd = r.projectPath || '-';
      const created = r.createdAt || '-';
      const binds = (r.config && r.config.binds ? r.config.binds.length : 0);
      const envs = (r.config && r.config.env ? r.config.env.length : 0);
      const ports = (r.config && r.config.ports ? r.config.ports.map(p => `${p.containerPort}->${p.hostPort}`).join(', ') : '');
      console.log(`- ${name}`);
      console.log(`    type: ${type}  agent: ${agent}  repo: ${repo}`);
      console.log(`    image: ${img}`);
      console.log(`    created: ${created}`);
      console.log(`    cwd: ${cwd}`);
      console.log(`    binds: ${binds}  env: ${envs}${ports ? `  ports: ${ports}` : ''}`);
    }
  } catch (e) {
    console.error('Failed to list current agents:', e.message);
  }
}

function collectAgentsSummary({ includeInactive = false } = {}) {
  const repoList = includeInactive
    ? reposSvc.getInstalledRepos(REPOS_DIR)
    : reposSvc.getActiveRepos(REPOS_DIR);

  const summary = [];
  if (!repoList || repoList.length === 0) return summary;

  for (const repo of repoList) {
    const repoPath = path.join(REPOS_DIR, repo);
    const installed = fs.existsSync(repoPath);
    const record = { repo, installed, agents: [] };

    if (installed) {
      let dirs = [];
      try { dirs = fs.readdirSync(repoPath); }
      catch (_) { dirs = []; }

      for (const name of dirs) {
        const agentDir = path.join(repoPath, name);
        const manifestPath = path.join(agentDir, 'manifest.json');
        try {
          if (!fs.statSync(agentDir).isDirectory() || !fs.existsSync(manifestPath)) continue;
        } catch (_) { continue; }

        let about = '-';
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest && typeof manifest.about === 'string') {
            about = manifest.about;
          }
        } catch (_) {}

        record.agents.push({
          repo,
          name,
          about,
          manifestPath
        });
      }
    }

    summary.push(record);
  }

  return summary;
}

function listAgents() {
  const summary = collectAgentsSummary();
  if (!summary.length) {
    console.log('No repos installed. Use: add repo <name>');
    return;
  }

  for (const { repo, installed, agents } of summary) {
    console.log(`\n[Repo] ${repo}${installed ? '' : ' (not installed)'}:`);
    if (!installed) {
      console.log('  (install with: add repo ' + repo + ')');
      continue;
    }
    if (!agents.length) {
      console.log('  (no agents found)');
      continue;
    }
    for (const agent of agents) {
      console.log(`  - ${agent.name}: ${agent.about || '-'}`);
    }
  }
  console.log("\nTip: enable repos with 'enable repo <name>' to control listings. If none are enabled, installed repos are used by default.");
}

function listRoutes() {
  try {
    const routingPath = path.resolve('.ploinky/routing.json');
    if (!fs.existsSync(routingPath)) {
      console.log('No routing configuration found (.ploinky/routing.json missing).');
      console.log("Tip: run 'start <staticAgent> <port>' to generate it.");
      return;
    }
    let routing = {};
    try {
      routing = JSON.parse(fs.readFileSync(routingPath, 'utf8')) || {};
    } catch (e) {
      console.log('Invalid routing.json (cannot parse).');
      return;
    }

    const port = routing.port || '-';
    const staticCfg = routing.static || {};
    const routes = routing.routes || {};

    console.log('Routing configuration (.ploinky/routing.json):');
    console.log(`- Port: ${port}`);
    if (staticCfg && staticCfg.agent) {
      const root = staticCfg.hostPath || staticCfg.root || '-';
      console.log(`- Static: agent=${staticCfg.agent} root=${root}`);
    } else {
      console.log('- Static: (not configured)');
    }

    const names = Object.keys(routes);
    if (!names.length) {
      console.log('No routes defined.');
      return;
    }
    console.log('Configured routes:');
    names.sort().forEach((name) => {
      const r = routes[name] || {};
      const container = r.container || '-';
      const hostPort = r.hostPort || r.port || '-';
      console.log(`- ${name}: hostPort=${hostPort} container=${container}`);
    });
  } catch (e) {
    console.error('Failed to list routes:', e.message);
  }
}

async function statusWorkspace() {
  const ws = require('./workspace');
  const reg0 = ws.loadAgents();
  const { getAgentContainerName, getRuntime } = require('./docker');
  const byAgent = {};
  for (const [key, rec] of Object.entries(reg0 || {})) {
    if (!rec || !rec.agentName) continue;
    const a = rec.agentName; const repo = rec.repoName || '';
    const expectedKey = getAgentContainerName(a, repo);
    if (!byAgent[a]) { byAgent[a] = { key, rec }; }
    const haveExpected = byAgent[a].key === expectedKey;
    const isExpected = key === expectedKey;
    if (isExpected && !haveExpected) { byAgent[a] = { key, rec }; }
  }
  const reg = Object.fromEntries(Object.values(byAgent).map(({ key, rec }) => [key, rec]));
  const cfg = ws.getConfig();
  const names = Object.keys(reg || {}).filter(k => k !== '_config');

  let routes = {};
  let staticAgentName = null;
  let routingPort = 8080;
  try {
    const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
    routes = routing.routes || {};
    staticAgentName = (routing.static && routing.static.agent) || null;
    routingPort = routing.port || routingPort;
  } catch (_) {}

  const { colorize } = require('./utils');
  console.log(colorize('Workspace status', 'bold'));
  try {
    const crypto = require('crypto');
    const proj = path.basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const wsid = crypto.createHash('sha256').update(process.cwd()).digest('hex').substring(0, 6);
    console.log(`- Workspace: ${colorize(proj, 'cyan')} ${colorize('[' + wsid + ']', 'yellow')}`);
  } catch (_) {}

  const effectiveStatic = (cfg && cfg.static)
    ? cfg.static
    : (staticAgentName ? { agent: staticAgentName, port: routingPort } : null);
  if (effectiveStatic && effectiveStatic.agent) {
    console.log(`- Static: agent=${colorize(effectiveStatic.agent, 'cyan')} port=${colorize(effectiveStatic.port, 'yellow')}`);
  } else {
    console.log(colorize('- Static: (not configured)', 'yellow'));
    console.log('  Tip: start <staticAgent> <port> to configure.');
  }

  try {
    const env = require('./secretVars');
    const read = (name) => {
      const val = env.resolveVarValue(name);
      return (typeof val === 'string' && val.trim()) ? 'configured' : 'default token';
    };
    console.log(colorize('- Interfaces:', 'bold'));
    console.log(`  • Dashboard: served via router (${read('WEBDASHBOARD_TOKEN')})`);
    console.log(`  • Web Console: served via router (${read('WEBTTY_TOKEN')})`);
    console.log(`  • WebChat: served via router (${read('WEBCHAT_TOKEN')})`);
    const meetAgent = env.resolveVarValue('WEBMEET_AGENT');
    const meetStatus = (typeof meetAgent === 'string' && meetAgent.trim())
      ? `moderator ${meetAgent}`
      : 'run "webmeet <agent>" to set moderator';
    console.log(`  • WebMeet: served via router (${meetStatus})`);
  } catch (_) {}

  try {
    const pidFile = path.resolve('.ploinky/running/router.pid');
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (pid && !Number.isNaN(pid)) {
        try { process.kill(pid, 0); console.log(`- Router: running (pid ${pid})`); }
        catch { console.log(`- Router: not running (stale pid ${pid})`); }
      } else { console.log('- Router: (no pid)'); }
    } else { console.log('- Router: (not running)'); }
  } catch (_) { console.log('- Router: (unknown)'); }

  if (!names.length) { console.log('- Agents: (none enabled)'); return; }
  console.log(colorize('- Agents:', 'bold'));
  const runtime = getRuntime();
  const execSync = require('child_process').execSync;
  for (const name of names) {
    const r = reg[name] || {};
    const agentName = r.agentName;
    const route = (agentName && routes[agentName]) ? routes[agentName] : null;
    const displayContainer = (route && route.container) ? route.container : name;
    let running = false;
    let statusText = '';
    try {
      statusText = execSync(`${runtime} ps -a --filter name=^\/${displayContainer}$ --format "{{.Status}}"`, { stdio: 'pipe' }).toString().trim();
      const liveName = execSync(`${runtime} ps --filter name=^\/${displayContainer}$ --format "{{.Names}}"`, { stdio: 'pipe' }).toString().trim();
      running = (liveName === displayContainer);
    } catch (_) {}
    const ports = '';
    let stateStr;
    if (running) {
      stateStr = colorize('(running)', 'green');
    } else if (statusText && /exited/i.test(statusText)) {
      const codeMatch = statusText.match(/exited \((\d+)\)/i);
      const code = codeMatch ? codeMatch[1] : '?';
      stateStr = colorize(`(exited code ${code})`, 'red');
    } else if (statusText) {
      stateStr = colorize(`(${statusText})`, 'yellow');
    } else {
      stateStr = colorize('(stopped)', 'red');
    }
    const agentLabel = (r.agentName === staticAgentName)
      ? `${colorize(r.agentName, 'cyan')} ${colorize('[static]', 'yellow')}`
      : colorize(r.agentName || '?', 'cyan');
    console.log(`  • ${agentLabel}  [container: ${colorize(displayContainer, 'magenta')}] ${stateStr}`);
    console.log(`    image: ${colorize(r.containerImage || '?', 'yellow')}  repo: ${r.repoName || '?'}  cwd: ${r.projectPath || '?'}`);
    let envNames = [];
    try { if (Array.isArray(r?.config?.env)) envNames = r.config.env.map(e => e && e.name).filter(Boolean); } catch (_) {}
    if (!envNames.length) {
      try {
        const manifestPath = findAgentManifest(r.agentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const { getExposedNames } = require('./secretVars');
        envNames = getExposedNames(manifest) || [];
      } catch (_) {}
    }
    if (envNames.length) {
      console.log(`    env expose: ${envNames.join(', ')}`);
    }
    if (!running && statusText && /exited/i.test(statusText)) {
      console.log(colorize('    hint: container exited. Check your agent command or base image.', 'yellow'));
      console.log(colorize('          - If using default supervisor, ensure the image provides `node` for /Agent/AgentServer.mjs', 'yellow'));
      console.log(colorize('          - Or set `agent` in manifest.json to a valid long-running command', 'yellow'));
      console.log(colorize('          - Debug with: p-cli cli <agentName> or p-cli shell <agentName>', 'yellow'));
      const rt = require('./docker').getRuntime();
      console.log(colorize(`          - Inspect logs: ${rt} logs ${name}`, 'yellow'));
    }
  }
}

module.exports = {
  collectAgentsSummary,
  findAgentManifest,
  listRepos,
  listCurrentAgents,
  listAgents,
  listRoutes,
  statusWorkspace
};
