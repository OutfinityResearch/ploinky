import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as utils from './utils.js';
import * as agentsSvc from './agents.js';
import * as workspaceSvc from './workspace.js';
import * as dockerSvc from './docker/index.js';
import { applyManifestDirectives } from './bootstrapManifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function shellQuote(str) {
  if (str === undefined || str === null) return "''";
  const s = String(str);
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function wrapCliWithWebchat(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) return trimmed;
  if (process.env.PLOINKY_SKIP_MANIFEST_CLI_WEBCHAT === '1') {
    return trimmed;
  }
  const enableWrap = process.env.PLOINKY_MANIFEST_CLI_WEBCHAT === '1';
  if (!enableWrap) {
    return trimmed;
  }
  if (/^(?:\/Agent\/bin\/)?webchat\b/.test(trimmed) || /^ploinky\s+webchat\b/.test(trimmed)) {
    return trimmed;
  }
  return `/Agent/bin/webchat -- ${shellQuote(trimmed)}`;
}

function findAgentManifest(agentName) {
  const { manifestPath } = utils.findAgent(agentName);
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
        utils.debugLog('Failed to refresh component tokens:', e.message);
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
    const staticManifestPath0 = staticAgentName0 ? (() => {
      try {
        const { manifestPath } = utils.findAgent(staticAgentName0);
        return manifestPath;
      } catch (_) {
        return null;
      }
    })() : null;
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
    const staticAgent = cfg0.static.agent;
    const staticPort = cfg0.static.port;
    let staticManifestPath = null;
    let staticAgentPath = null;
    try {
      const res = utils.findAgent(staticAgent);
      staticManifestPath = res.manifestPath;
      staticAgentPath = path.dirname(staticManifestPath);
    } catch (e) {
      console.error(`start: static agent '${staticAgent}' not found in any repo. Use 'enable agent <repo/name>' or check repos.`);
      return;
    }
    cfg.port = staticPort;
    cfg.static = { agent: staticAgent, container: getServiceContainerName(staticAgent), hostPath: staticAgentPath };
    console.log(`Static: agent=${utils.colorize(staticAgent, 'cyan')} port=${utils.colorize(String(staticPort), 'yellow')}`);
    if (typeof killRouterIfRunning === 'function') {
      try { killRouterIfRunning(); } catch (_) {}
    }
    const runningDir = path.resolve('.ploinky/running');
    fs.mkdirSync(runningDir, { recursive: true });
    const routerPath = path.resolve(__dirname, '../server/Watchdog.js');
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
    console.log(`[start] Watchdog launched in background (pid ${child.pid}).`);
    console.log(`[start] Watchdog will automatically restart the server if it crashes.`);
    console.log(`[start] Server logs: ${path.resolve('logs/router.log')}`);
    console.log(`[start] Watchdog logs: ${path.resolve('logs/watchdog.log')}`);
    console.log(`[start] Dashboard: http://127.0.0.1:${staticPort}/dashboard`);
  } catch (e) {
    console.error('start (workspace) failed:', e.message);
  }
}

async function runCli(agentName, args) {
  if (!agentName) { throw new Error('Usage: cli <agentName> [args...]'); }
  const { manifestPath, shortAgentName } = utils.findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cliBase = getCliCmd(manifest);
  if (!cliBase || !cliBase.trim()) { throw new Error(`Manifest for '${shortAgentName}' has no 'cli' command.`); }
  const rawCmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
  const cmd = wrapCliWithWebchat(rawCmd);
  const { ensureAgentService, attachInteractive, getConfiguredProjectPath } = dockerSvc;
  const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
  const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
  console.log(`[cli] container: ${containerName}`);
  console.log(`[cli] command: ${cmd}`);
  console.log(`[cli] agent: ${shortAgentName}`);
  const agentDir = path.dirname(manifestPath);
  const repoDir = path.dirname(agentDir);
  const repoName = path.basename(repoDir);
  const projPath = getConfiguredProjectPath(shortAgentName, repoName);
  attachInteractive(containerName, projPath, cmd);
}

async function runShell(agentName) {
  if (!agentName) { throw new Error('Usage: shell <agentName>'); }
  const { manifestPath, shortAgentName } = utils.findAgent(agentName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { ensureAgentService, attachInteractive, getConfiguredProjectPath } = dockerSvc;
  const containerInfo = ensureAgentService(shortAgentName, manifest, path.dirname(manifestPath));
  const containerName = (containerInfo && containerInfo.containerName) || `ploinky_agent_${shortAgentName}`;
  const cmd = '/bin/sh';
  console.log(`[shell] container: ${containerName}`);
  console.log(`[shell] command: ${cmd}`);
  console.log(`[shell] agent: ${shortAgentName}`);
  const agentDir = path.dirname(manifestPath);
  const repoDir = path.dirname(agentDir);
  const repoName = path.basename(repoDir);
  const projPath = getConfiguredProjectPath(shortAgentName, repoName);
  attachInteractive(containerName, projPath, cmd);
}

async function refreshAgent(agentName) {
    if (!agentName) { throw new Error('Usage: refresh agent <name>'); }

    const { getServiceContainerName, isContainerRunning, stopAndRemove, ensureAgentService } = dockerSvc;
    const containerName = getServiceContainerName(agentName);

    if (!isContainerRunning(containerName)) {
        console.error(`Agent '${agentName}' is not running.`);
        return;
    }

    console.log(`Refreshing (re-creating) agent '${agentName}'...`);

    try {
        const res = utils.findAgent(agentName);
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
                const saved = workspaceSvc.getConfig();
                if (saved && saved.static && saved.static.port) {
                    port = parseInt(saved.static.port, 10) || port;
                }
            } catch(_) {}
            cfg.port = port;
            fs.mkdirSync(path.dirname(routingFile), { recursive: true });
            fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));

            const isRouterUp = (p) => {
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
                const routerPath = path.resolve(__dirname, '../server/Watchdog.js');
                const routerPidFile = path.join(runningDir, 'router.pid');
                const child = spawn(process.execPath, [routerPath], {
                    detached: true,
                    stdio: ['ignore', 'inherit', 'inherit'],
                    env: { ...process.env, PORT: String(cfg.port), PLOINKY_ROUTER_PID_FILE: routerPidFile }
                });
                try { fs.writeFileSync(routerPidFile, String(child.pid)); } catch(_) {}
                child.unref();
                console.log(`[refresh] Watchdog launched (pid ${child.pid}) on port ${cfg.port}.`);
                console.log(`[refresh] Watchdog will automatically restart the server if needed.`);
            }
        } catch (e) {
            console.error('[refresh] routing update/router start failed:', e?.message||e);
        }
    } catch (e) {
        console.error(`[refresh] ${agentName}: ${e?.message||e}`);
    }
}

export {
  startWorkspace,
  runCli,
  runShell,
  refreshAgent
};
