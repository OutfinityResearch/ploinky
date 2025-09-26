const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { debugLog } = require('./utils');
const agentsSvc = require('./agents');
const workspaceSvc = require('./workspace');
const dockerSvc = require('./docker');
const { applyManifestDirectives } = require('./bootstrapManifest');

function getAgentCmd(manifest) {
  return (manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '';
}

function getCliCmd(manifest) {
  return (
    (manifest.cli && String(manifest.cli)) ||
    (manifest.commands && manifest.commands.cli) ||
    (manifest.run && String(manifest.run)) ||
    (manifest.commands && manifest.commands.run) ||
    ''
  );
}

function findAgentManifest(agentName) {
  const { findAgent } = require('./utils');
  const { manifestPath } = findAgent(agentName);
  return manifestPath;
}

async function startWorkspace(staticAgentArg, portArg, { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning } = {}) {
  try {
    if (staticAgentArg) {
      if (enableAgent) {
        await enableAgent(staticAgentArg);
      } else {
        try {
          const info = agentsSvc.enableAgent(staticAgentArg);
          if (info && info.shortAgentName) {
            console.log(`✓ Agent '${info.shortAgentName}' from repo '${info.repoName}' enabled. Use 'start' to start all configured agents.`);
          }
        } catch (e) {
          console.error(`start: failed to enable agent '${staticAgentArg}': ${e?.message || e}`);
          return;
        }
      }
      const portNum = parseInt(portArg || '0', 10) || 8080;
      const cfg = workspaceSvc.getConfig() || {};
      cfg.static = { agent: staticAgentArg, port: portNum };
      workspaceSvc.setConfig(cfg);
    }
    const cfg0 = workspaceSvc.getConfig() || {};
    if (!cfg0.static || !cfg0.static.agent || !cfg0.static.port) {
      console.error('start: missing static agent or port. Usage: start <staticAgent> <port> (first time).');
      return;
    }
    if (typeof refreshComponentToken === 'function' || typeof ensureComponentToken === 'function') {
      try {
        refreshComponentToken && refreshComponentToken('webtty', { quiet: true });
        const ensureToken = ensureComponentToken || refreshComponentToken;
        if (ensureComponentToken) {
          ensureComponentToken('webchat', { quiet: true });
        }
        refreshComponentToken && refreshComponentToken('dashboard', { quiet: true });
        if (ensureComponentToken) {
          ensureComponentToken('webmeet', { quiet: true });
        }
      } catch (e) {
        debugLog('Failed to refresh component tokens:', e.message);
      }
    }
    try { await applyManifestDirectives(cfg0.static.agent); } catch (_) {}
    let reg = workspaceSvc.loadAgents();
    const { getAgentContainerName } = dockerSvc;
    const byAgent = {};
    for (const [key, rec] of Object.entries(reg || {})) {
      if (!rec || !rec.agentName) continue;
      const a = rec.agentName; const repo = rec.repoName || '';
      const expectedKey = getAgentContainerName(a, repo);
      if (!byAgent[a]) { byAgent[a] = { key, rec }; }
      const haveExpected = byAgent[a].key === expectedKey;
      const isExpected = key === expectedKey;
      if (isExpected && !haveExpected) { byAgent[a] = { key, rec }; }
    }
    const dedup = Object.fromEntries(Object.values(byAgent).map(({ key, rec }) => [key, rec]));
    const preservedCfg = workspaceSvc.getConfig();
    if (preservedCfg && Object.keys(preservedCfg).length) dedup._config = preservedCfg;
    const staticAgentName0 = cfg0?.static?.agent;
    const staticManifestPath0 = staticAgentName0 ? (function(){ try { const { manifestPath } = require('./utils').findAgent(staticAgentName0); return manifestPath; } catch(_) { return null; } })() : null;
    if (staticManifestPath0) {
      try {
        const manifest = JSON.parse(fs.readFileSync(staticManifestPath0, 'utf8'));
        if (Array.isArray(manifest.enable)) {
          for (const agentRef of manifest.enable) {
            try {
              const info = agentsSvc.enableAgent(agentRef);
              if (info && info.containerName) {
                const regMap = workspaceSvc.loadAgents();
                const record = regMap[info.containerName];
                if (record) dedup[info.containerName] = record;
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    workspaceSvc.saveAgents(dedup);
    reg = dedup;
    const names = Object.keys(reg || {});
    const { ensureAgentService, getServiceContainerName } = dockerSvc;
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = { routes: {} };
    try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch (_) {}
    cfg.routes = cfg.routes || {};
    const { colorize } = require('./utils');
    const staticAgent = cfg0.static.agent;
    const staticPort = cfg0.static.port;
    let staticManifestPath = null;
    let staticAgentPath = null;
    try {
      const { findAgent } = require('./utils');
      const res = findAgent(staticAgent);
      staticManifestPath = res.manifestPath;
      staticAgentPath = path.dirname(staticManifestPath);
    } catch (e) {
      console.error(`start: static agent '${staticAgent}' not found in any repo. Use 'enable agent <repo/name>' or check repos.`);
      return;
    }
    cfg.port = staticPort;
    cfg.static = { agent: staticAgent, container: getServiceContainerName(staticAgent), hostPath: staticAgentPath };
    console.log(`Static: agent=${colorize(staticAgent, 'cyan')} port=${colorize(String(staticPort), 'yellow')}`);
    if (typeof killRouterIfRunning === 'function') {
      try { killRouterIfRunning(); } catch (_) {}
    }
    const runningDir = path.resolve('.ploinky/running');
    fs.mkdirSync(runningDir, { recursive: true });
    const routerPath = path.resolve(__dirname, '../server/RoutingServer.js');
    const updateRoutes = async () => {
      cfg.routes = cfg.routes || {};
      for (const name of names) {
        if (name === '_config') continue;
        const rec = reg[name];
        if (!rec || !rec.agentName) continue;
        const shortAgentName = rec.agentName;
        const manifestPath0 = findAgentManifest(shortAgentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath0, 'utf8'));
        const agentPath = path.dirname(manifestPath0);
        const repoName = path.basename(path.dirname(agentPath));
        const { containerName, hostPort } = ensureAgentService(shortAgentName, manifest, agentPath);
        cfg.routes[shortAgentName] = cfg.routes[shortAgentName] || {};
        cfg.routes[shortAgentName].container = containerName;
        cfg.routes[shortAgentName].hostPath = agentPath;
        cfg.routes[shortAgentName].repo = repoName;
        cfg.routes[shortAgentName].agent = shortAgentName;
        cfg.routes[shortAgentName].hostPort = hostPort || cfg.routes[shortAgentName].hostPort;
      }
      fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
    };
    await updateRoutes();
    const routerPidFile = path.join(runningDir, 'router.pid');
    const child = spawn(process.execPath, [routerPath], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        PORT: String(staticPort),
        PLOINKY_ROUTER_PID_FILE: routerPidFile
      }
    });
    try { fs.writeFileSync(routerPidFile, String(child.pid)); } catch (_) {}
    // Detach so the CLI can exit while the router keeps running.
    child.unref();
    console.log(`[start] RoutingServer launched in background (pid ${child.pid}).`);
    console.log(`[start] Logs: ${path.resolve('.ploinky/logs/router.log')}`);
    console.log(`[start] Dashboard: http://127.0.0.1:${staticPort}/dashboard`);
  } catch (e) {
    console.error('start (workspace) failed:', e.message);
  }
}

async function runCli(agentName, args) {
  if (!agentName) { throw new Error('Usage: cli <agentName> [args...]'); }
  const { findAgent } = require('./utils');
  const { manifestPath, shortAgentName } = findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cliBase = getCliCmd(manifest);
  if (!cliBase || !cliBase.trim()) { throw new Error(`Manifest for '${shortAgentName}' has no 'cli' command.`); }
  const cmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
  const { ensureAgentService, attachInteractive } = dockerSvc;
  const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
  const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
  console.log(`[cli] container: ${containerName}`);
  console.log(`[cli] command: ${cmd}`);
  console.log(`[cli] agent: ${shortAgentName}`);
  attachInteractive(containerName, process.cwd(), cmd);
}

async function runShell(agentName) {
  if (!agentName) { throw new Error('Usage: shell <agentName>'); }
  const { findAgent } = require('./utils');
  const { manifestPath, shortAgentName } = findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { ensureAgentService, attachInteractive } = dockerSvc;
  const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
  const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
  const cmd = '/bin/sh';
  console.log(`[shell] container: ${containerName}`);
  console.log(`[shell] command: ${cmd}`);
  console.log(`[shell] agent: ${shortAgentName}`);
  attachInteractive(containerName, process.cwd(), cmd);
}

async function refreshAgent(agentName) {
    if (!agentName) { throw new Error('Usage: refresh agent <name>'); }

    const dockerSvc = require('./docker');
    const { getServiceContainerName, isContainerRunning, stopAndRemove, ensureAgentService } = dockerSvc;
    const containerName = getServiceContainerName(agentName);

    if (!isContainerRunning(containerName)) {
        console.error(`Agent '${agentName}' is not running.`);
        return;
    }

    console.log(`Refreshing (re-creating) agent '${agentName}'...`);

    try {
        const { findAgent } = require('./utils');
        const res = findAgent(agentName);
        const short = res.shortAgentName;
        const manifest = JSON.parse(fs.readFileSync(res.manifestPath, 'utf8'));
        const agentPath = path.dirname(res.manifestPath);
        
        stopAndRemove(containerName);
        
        const { containerName: newContainerName, hostPort } = await ensureAgentService(short, manifest, agentPath);
        console.log(`[refresh] refreshed '${short}' [container: ${newContainerName}]`);

        // Routing update logic from original restart command
        try {
            const routingFile = path.resolve('.ploinky/routing.json');
            let cfg = { routes: {} };
            try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch(_) {}
            cfg.routes = cfg.routes || {};
            const repoName = path.basename(path.dirname(agentPath));
            cfg.routes[short] = cfg.routes[short] || {};
            cfg.routes[short].container = newContainerName;
            cfg.routes[short].hostPath = agentPath;
            cfg.routes[short].repo = repoName;
            cfg.routes[short].agent = short;
            if (hostPort) cfg.routes[short].hostPort = hostPort;
            
            let port = 8080;
            if (cfg && cfg.port) { port = parseInt(cfg.port, 10) || port; }
            try {
                const ws = require('./workspace');
                const saved = ws.getConfig();
                if (saved && saved.static && saved.static.port) {
                    port = parseInt(saved.static.port, 10) || port;
                }
            } catch(_) {}
            cfg.port = port;
            fs.mkdirSync(path.dirname(routingFile), { recursive: true });
            fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));

            const isRouterUp = (p) => {
                const { execSync } = require('child_process');
                try {
                    const out = execSync(`lsof -t -i :${p} -sTCP:LISTEN`, { stdio: 'pipe' }).toString().trim();
                    if (out) return true;
                } catch(_) {}
                try {
                    const out = execSync('ss -ltnp', { stdio: 'pipe' }).toString();
                    return out.includes(`:${p}`) && out.includes('LISTEN');
                } catch(_) { return false; }
            };
            if (!isRouterUp(cfg.port)) {
                const runningDir = path.resolve('.ploinky/running');
                fs.mkdirSync(runningDir, { recursive: true });
                const routerPath = path.resolve(__dirname, '../server/RoutingServer.js');
                const routerPidFile = path.join(runningDir, 'router.pid');
                const child = require('child_process').spawn(process.execPath, [routerPath], {
                    detached: true,
                    stdio: ['ignore', 'inherit', 'inherit'],
                    env: { ...process.env, PORT: String(cfg.port), PLOINKY_ROUTER_PID_FILE: routerPidFile }
                });
                try { fs.writeFileSync(routerPidFile, String(child.pid)); } catch(_) {}
                child.unref();
                console.log(`[refresh] RoutingServer launched (pid ${child.pid}) on port ${cfg.port}.`);
            }
        } catch (e) {
            console.error('[refresh] routing update/router start failed:', e?.message||e);
        }
    } catch (e) {
        console.error(`[refresh] ${agentName}: ${e?.message||e}`);
    }
}

module.exports = {
  startWorkspace,
  runCli,
  runShell,
  refreshAgent
};
