import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as utils from './utils.js';
import * as agentsSvc from './agents.js';
import * as workspaceSvc from './workspace.js';
import * as dockerSvc from './docker/index.js';
import { applyManifestDirectives } from './bootstrapManifest.js';
import { executeHostHook, isInlineCommand } from './lifecycleHooks.js';
import { getActiveProfile, getProfileConfig, getProfileEnvVars } from './profileService.js';
import { getSecrets, createEnvWithSecrets } from './secretInjector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAgentCmd(manifest) {
  return (manifest.agent && String(manifest.agent)) || (manifest.commands && manifest.commands.run) || '';
}

function getCliCmd(manifest) {
  const explicitCli =
    (manifest.cli && String(manifest.cli)) ||
    (manifest.commands && manifest.commands.cli);

  if (explicitCli) {
    return explicitCli;
  }

  return '/Agent/default_cli.sh';
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
      let aliasResolved = null;
      try {
        const resolvedAliasRecord = agentsSvc.resolveEnabledAgentRecord(staticAgentArg);
        if (resolvedAliasRecord && resolvedAliasRecord.record && resolvedAliasRecord.record.alias) {
          aliasResolved = `${resolvedAliasRecord.record.repoName}/${resolvedAliasRecord.record.agentName}`;
        }
      } catch (_) {
        aliasResolved = null;
      }
      let alreadyEnabled = false;
      let resolvedAgent = null;
      try {
        resolvedAgent = utils.findAgent(aliasResolved || staticAgentArg);
      } catch (_) { resolvedAgent = null; }

      if (resolvedAgent) {
        try {
          const agentsMap = workspaceSvc.loadAgents();
          const expectedKey = dockerSvc.getAgentContainerName(resolvedAgent.shortAgentName, resolvedAgent.repo);
          const existingByKey = agentsMap[expectedKey];
          if (existingByKey && existingByKey.type === 'agent') {
            alreadyEnabled = true;
          } else {
            alreadyEnabled = Object.values(agentsMap).some((value) => (
              value && value.type === 'agent' &&
              value.agentName === resolvedAgent.shortAgentName &&
              value.repoName === resolvedAgent.repo
            ));
          }
        } catch (_) {
          alreadyEnabled = false;
        }
      }

      if (!alreadyEnabled) {
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
      } else {
        utils.debugLog(`startWorkspace: static agent '${staticAgentArg}' already enabled; reusing existing record.`);
      }
      const portNum = parseInt(portArg || '0', 10) || 8080;
      const cfg = workspaceSvc.getConfig() || {};
      cfg.static = { agent: aliasResolved || staticAgentArg, port: portNum };
      workspaceSvc.setConfig(cfg);
    }
    const cfg0 = workspaceSvc.getConfig() || {};
    const staticAgentCfg = cfg0?.static?.agent;
    let normalizedStaticAgent = staticAgentCfg;
    if (staticAgentCfg) {
      try {
        const aliasRecord = agentsSvc.resolveEnabledAgentRecord(staticAgentCfg);
        if (aliasRecord && aliasRecord.record && aliasRecord.record.alias) {
          normalizedStaticAgent = `${aliasRecord.record.repoName}/${aliasRecord.record.agentName}`;
        }
      } catch (_) {
        normalizedStaticAgent = staticAgentCfg;
      }
    }
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
    // Run preinstall hook for the static (main) agent BEFORE starting dependencies.
    // This allows the main agent's preinstall to set ploinky vars that dependencies need.
    // Note: This only runs the preinstall hook; workspace init/symlinks are done in agentServiceManager.
    try {
      const staticAgentForPreinstall = cfg0.static.agent;
      if (staticAgentForPreinstall) {
        const resolved = utils.findAgent(staticAgentForPreinstall);
        if (resolved) {
          const agentPath = path.dirname(resolved.manifestPath);
          const activeProfile = getActiveProfile();
          const profileConfig = getProfileConfig(`${resolved.repo}/${resolved.shortAgentName}`, activeProfile);
          if (profileConfig?.preinstall) {
            console.log(`[start] Running preinstall hook for ${resolved.shortAgentName} (profile: ${activeProfile})...`);
            // For inline commands, pass as-is; for script paths, join with agentPath
            const hookValue = isInlineCommand(profileConfig.preinstall)
              ? profileConfig.preinstall
              : path.join(agentPath, profileConfig.preinstall);
            
            // Build environment for the hook
            const envVars = getProfileEnvVars(resolved.shortAgentName, resolved.repo, activeProfile, {});
            const profileEnv = profileConfig.env && typeof profileConfig.env === 'object' && !Array.isArray(profileConfig.env) 
              ? profileConfig.env : {};
            const secrets = profileConfig.secrets ? getSecrets(profileConfig.secrets) : {};
            const hookEnv = createEnvWithSecrets({ ...envVars, ...profileEnv }, secrets);
            
            const result = executeHostHook(hookValue, hookEnv, { cwd: process.cwd() });
            if (!result.success) {
              console.error(`[start] Preinstall failed: ${result.message}`);
            }
          }
        }
      }
    } catch (preErr) {
      console.error(`[start] Preinstall hook error: ${preErr.message}`);
    }

    try { await applyManifestDirectives(cfg0.static.agent); } catch (_) {}
    let reg = workspaceSvc.loadAgents();
    const { getAgentContainerName } = dockerSvc;
    const dedup = {};
    const aliasEntries = {};
    const canonical = new Map();

    for (const [key, rec] of Object.entries(reg || {})) {
      if (key === '_config') continue;
      if (!rec || typeof rec !== 'object') {
        dedup[key] = rec;
        continue;
      }
      if (rec.type !== 'agent') {
        dedup[key] = rec;
        continue;
      }
      if (rec.alias) {
        aliasEntries[key] = rec;
        continue;
      }
      if (!rec.agentName) continue;
      const repo = rec.repoName || '';
      const expectedKey = getAgentContainerName(rec.agentName, repo);
      const agentKey = `${repo}::${rec.agentName}`;
      const existing = canonical.get(agentKey);
      if (!existing || key === expectedKey) {
        canonical.set(agentKey, { key: expectedKey, rec });
      }
    }

    for (const { key, rec } of canonical.values()) {
      dedup[key] = rec;
    }
    for (const [aliasKey, rec] of Object.entries(aliasEntries)) {
      dedup[aliasKey] = rec;
    }

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

    // Get all agent names, we'll reorder them below
    const allNames = Object.keys(reg || {}).filter(name => name !== '_config');
    const { ensureAgentService } = dockerSvc;

    // Reorder agents: dependencies first, static agent last
    // This ensures enable list agents start before the main agent
    const reorderAgentsForStart = (agentNames, staticAgentName, staticRepoName) => {
      const staticContainerName = getAgentContainerName(staticAgentName, staticRepoName);
      const isStaticAgent = (name) => {
        const rec = reg[name];
        return rec && rec.agentName === staticAgentName && rec.repoName === staticRepoName;
      };

      // Separate static agent from dependencies
      const dependencies = agentNames.filter(name => !isStaticAgent(name));
      const staticAgents = agentNames.filter(name => isStaticAgent(name));

      // Dependencies first, then static agent
      return [...dependencies, ...staticAgents];
    };
    const routingFile = path.resolve('.ploinky/routing.json');
    let cfg = { routes: {} };
    try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch (_) {}
    cfg.routes = cfg.routes || {};
    const staticAgent = normalizedStaticAgent || cfg0.static.agent;
    const staticPort = cfg0.static.port;
    let staticManifestPath = null;
    let staticAgentPath = null;
    let staticRepoName = null;
    let staticShortAgent = null;
    try {
      const res = utils.findAgent(staticAgent);
      staticManifestPath = res.manifestPath;
      staticAgentPath = path.dirname(staticManifestPath);
      staticRepoName = res.repo;
      staticShortAgent = res.shortAgentName;
    } catch (e) {
      console.error(`start: static agent '${staticAgent}' not found in any repo. Use 'enable agent <repo/name>' or check repos.`);
      return;
    }
    cfg.port = staticPort;

    // Reorder agents: start dependencies before the static agent
    const names = reorderAgentsForStart(allNames, staticShortAgent, staticRepoName);

    const staticCandidates = Object.entries(reg || {})
      .filter(([key, rec]) => key !== '_config' && rec && rec.type === 'agent')
      .filter(([, rec]) => rec.agentName === staticShortAgent && rec.repoName === staticRepoName);
    const preferredStatic = staticCandidates.find(([, rec]) => !rec.alias) || staticCandidates[0];
    const fallbackStatic = getAgentContainerName(staticShortAgent || staticAgent, staticRepoName || '');
    const staticContainer = preferredStatic ? preferredStatic[0] : fallbackStatic;
    cfg.static = { agent: staticAgent, container: staticContainer, hostPath: staticAgentPath };
    console.log(`Static: agent=${utils.colorize(staticAgent, 'cyan')} port=${utils.colorize(String(staticPort), 'yellow')}`);
    if (typeof killRouterIfRunning === 'function') {
      try { killRouterIfRunning(); } catch (_) {}
    }
    const runningDir = path.resolve('.ploinky/running');
    fs.mkdirSync(runningDir, { recursive: true });
    const routerPath = path.resolve(__dirname, '../server/Watchdog.js');
    const updateRoutes = async () => {
      cfg.routes = cfg.routes || {};
      const failedAgents = [];
      for (const name of names) {
        const rec = reg[name];
        if (!rec || !rec.agentName) continue;
        const shortAgentName = rec.agentName;
        const manifestRef = rec.repoName ? `${rec.repoName}/${shortAgentName}` : shortAgentName;
        try {
          const manifestPath0 = findAgentManifest(manifestRef);
          const manifest = JSON.parse(fs.readFileSync(manifestPath0, 'utf8'));
          const agentPath = path.dirname(manifestPath0);
          const repoName = rec.repoName || path.basename(path.dirname(agentPath));
          const routeKey = rec.alias || shortAgentName;
          const { containerName, hostPort } = ensureAgentService(shortAgentName, manifest, agentPath, { containerName: name, alias: rec.alias });
          cfg.routes[routeKey] = cfg.routes[routeKey] || {};
          cfg.routes[routeKey].container = containerName;
          cfg.routes[routeKey].hostPath = agentPath;
          cfg.routes[routeKey].repo = repoName;
          cfg.routes[routeKey].agent = shortAgentName;
          if (rec.alias) cfg.routes[routeKey].alias = rec.alias;
          cfg.routes[routeKey].hostPort = hostPort || cfg.routes[routeKey].hostPort;
        } catch (agentErr) {
          console.error(`[start] Failed to start agent '${shortAgentName}': ${agentErr.message}`);
          failedAgents.push(shortAgentName);
        }
      }
      fs.writeFileSync(routingFile, JSON.stringify(cfg, null, 2));
      if (failedAgents.length > 0) {
        console.warn(`[start] ${failedAgents.length} agent(s) failed to start: ${failedAgents.join(', ')}`);
      }
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
  let registryRecord = null;
  try {
    registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
  } catch (err) {
    console.error(err?.message || err);
    return;
  }
  const manifestLookup = registryRecord
    ? `${registryRecord.record.repoName}/${registryRecord.record.agentName}`
    : agentName;
  const { manifestPath, shortAgentName } = utils.findAgent(manifestLookup);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cliBase = getCliCmd(manifest);
  if (!cliBase || !cliBase.trim()) { throw new Error(`Manifest for '${shortAgentName}' has no 'cli' command.`); }
  const rawCmd = cliBase + (args && args.length ? (' ' + args.join(' ')) : '');
  const cmd = wrapCliWithWebchat(rawCmd);
  const { ensureAgentService, attachInteractive, getConfiguredProjectPath, getAgentContainerName } = dockerSvc;
  const agentDir = path.dirname(manifestPath);
  const repoName = path.basename(path.dirname(agentDir));
  utils.debugLog(`[runCli] agent=${agentName} container=${registryRecord?.containerName || getAgentContainerName(shortAgentName, repoName)}`);
  const containerInfo = ensureAgentService(shortAgentName, manifest, agentDir, { containerName: registryRecord?.containerName, alias: registryRecord?.record?.alias });
  const containerName = (containerInfo && containerInfo.containerName)
    || registryRecord?.containerName
    || getAgentContainerName(shortAgentName, repoName);
  const projPath = getConfiguredProjectPath(shortAgentName, repoName, registryRecord?.record?.alias);
  attachInteractive(containerName, projPath, cmd);
}

async function runShell(agentName) {
  if (!agentName) { throw new Error('Usage: shell <agentName>'); }
  let registryRecord = null;
  try {
    registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
  } catch (err) {
    console.error(err?.message || err);
    return;
  }
  const manifestLookup = registryRecord
    ? `${registryRecord.record.repoName}/${registryRecord.record.agentName}`
    : agentName;
  const { manifestPath, shortAgentName } = utils.findAgent(manifestLookup);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { ensureAgentService, attachInteractive, getConfiguredProjectPath, getAgentContainerName } = dockerSvc;
  const agentDir = path.dirname(manifestPath);
  const repoName = path.basename(path.dirname(agentDir));
  const containerInfo = ensureAgentService(shortAgentName, manifest, agentDir, { containerName: registryRecord?.containerName, alias: registryRecord?.record?.alias });
  const containerName = (containerInfo && containerInfo.containerName)
    || registryRecord?.containerName
    || getAgentContainerName(shortAgentName, repoName);
  const cmd = '/bin/sh';
  console.log(`[shell] container: ${containerName}`);
  console.log(`[shell] command: ${cmd}`);
  console.log(`[shell] agent: ${shortAgentName}`);
  const projPath = getConfiguredProjectPath(shortAgentName, repoName, registryRecord?.record?.alias);
  attachInteractive(containerName, projPath, cmd);
}

async function refreshAgent(agentName) {
    if (!agentName) { throw new Error('Usage: refresh agent <name>'); }

    const { getAgentContainerName, isContainerRunning, stopAndRemove, ensureAgentService } = dockerSvc;
    let registryRecord = null;
    try {
        registryRecord = agentsSvc.resolveEnabledAgentRecord(agentName);
    } catch (err) {
        console.error(err?.message || err);
        return;
    }

    let resolved;
    try {
        const lookup = registryRecord
            ? `${registryRecord.record.repoName}/${registryRecord.record.agentName}`
            : agentName;
        resolved = utils.findAgent(lookup);
    } catch (err) {
        console.error(err?.message || `Agent '${agentName}' not found.`);
        return;
    }

    const containerName = registryRecord?.containerName || getAgentContainerName(resolved.shortAgentName, resolved.repo);

    if (!isContainerRunning(containerName)) {
        console.error(`Agent '${agentName}' is not running.`);
        return;
    }

    console.log(`Refreshing (re-creating) agent '${agentName}'...`);

    try {
        const short = resolved.shortAgentName;
        const manifest = JSON.parse(fs.readFileSync(resolved.manifestPath, 'utf8'));
        const agentPath = path.dirname(resolved.manifestPath);
        
        stopAndRemove(containerName);
        
        const { containerName: newContainerName, hostPort } = await ensureAgentService(short, manifest, agentPath, {
            containerName,
            alias: registryRecord?.record?.alias,
            forceRecreate: true
        });
        console.log(`[refresh] refreshed '${short}' [container: ${newContainerName}]`);

        // Routing update logic from original restart command
        try {
            const routingFile = path.resolve('.ploinky/routing.json');
            let cfg = { routes: {} };
            try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || { routes: {} }; } catch(_) {}
            cfg.routes = cfg.routes || {};
            const repoName = path.basename(path.dirname(agentPath));
            const routeKey = registryRecord?.record.alias || short;
            cfg.routes[routeKey] = cfg.routes[routeKey] || {};
            cfg.routes[routeKey].container = newContainerName;
            cfg.routes[routeKey].hostPath = agentPath;
            cfg.routes[routeKey].repo = repoName;
            cfg.routes[routeKey].agent = short;
            if (registryRecord?.record.alias) cfg.routes[routeKey].alias = registryRecord.record.alias;
            if (hostPort) cfg.routes[routeKey].hostPort = hostPort;

            const savedCfg = workspaceSvc.getConfig();
            if (!cfg.static && savedCfg?.static?.agent) {
                cfg.static = { ...savedCfg.static };
            }
            const staticAgent = String(cfg.static?.agent || '').trim();
            if (staticAgent) {
                const matches = new Set([short, `${repoName}/${short}`, `${repoName}:${short}`]);
                if (registryRecord?.record?.alias) {
                    matches.add(registryRecord.record.alias);
                }
                if (matches.has(staticAgent)) {
                    cfg.static.container = newContainerName;
                    cfg.static.hostPath = agentPath;
                }
            }
            
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
