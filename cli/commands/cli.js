import { execSync } from 'child_process';
import { debugLog } from '../services/utils.js';
import { isKnownCommand } from '../services/commandRegistry.js';
import 'ploinkyAgentLib/LLMAgents';
import { showHelp } from '../services/help.js';
import * as envSvc from '../services/secretVars.js';
import * as agentsSvc from '../services/agents.js';
import { listRepos, listAgents, listCurrentAgents, listRoutes, statusWorkspace } from '../services/status.js';
import { logsTail, showLast } from '../services/logUtils.js';
import { startWorkspace, runCli, runShell, refreshAgent } from '../services/workspaceUtil.js';
import { refreshComponentToken, ensureComponentToken, getComponentToken } from '../server/utils/routerEnv.js';
import * as dockerSvc from '../services/docker/index.js';
import * as workspaceSvc from '../services/workspace.js';
import { handleSystemCommand, handleInvalidCommand } from './llmSystemCommands.js';
import {
    getRepoNames,
    getAgentNames,
    addRepo,
    updateRepo,
    enableRepo,
    disableRepo,
    enableAgent,
    findAgentManifest,
} from './repoAgentCommands.js';
import {
    handleVarsCommand,
    handleVarCommand,
    handleEchoCommand,
    handleExposeCommand,
} from './envVarCommands.js';
import { configureWebttyShell } from './webttyCommands.js';
import {
    cleanupSessionContainers,
    destroyAll,
    killRouterIfRunning,
    shutdownSession,
} from './sessionControl.js';
import { handleSsoCommand } from './ssoCommands.js';
import ClientCommands from './client.js';




async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'shell':
            if (!options[0]) { showHelp(); break; }
            await runShell(options[0]);
            break;
        case 'cli':
            if (!options[0]) { showHelp(); break; }
            await runCli(options[0], options.slice(1));
            break;
        // 'agent' command removed; use 'enable agent <agentName>' then 'start'
        case 'add':
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else showHelp();
            break;
        case 'vars':
            handleVarsCommand();
            break;
        case 'var':
            handleVarCommand(options);
            break;
        case 'echo':
            handleEchoCommand(options);
            break;
        case 'update':
            if (options[0] === 'agent') await updateAgent(options[1]);
            else if (options[0] === 'repo') await updateRepo(options[1]);
            else showHelp();
            break;
        case 'refresh':
            if (options[0] === 'agent' && options[1]) await refreshAgent(options[1]); else showHelp();
            break;
        case 'enable':
            if (options[0] === 'repo') enableRepo(options[1]);
            else if (options[0] === 'agent') await enableAgent(options[1], options[2], options[3]);
            else showHelp();
            break;
        case 'expose':
            handleExposeCommand(options);
            break;
        case 'disable': {
            if (!options.length) {
                showHelp();
                break;
            }

            if (options[0] === 'repo') {
                disableRepo(options[1]);
                break;
            }

            let target = options.join(' ').trim();
            if (options[0] === 'agent') {
                target = options.slice(1).join(' ').trim();
            }

            if (!target) {
                showHelp();
                break;
            }

            try {
                const result = agentsSvc.disableAgent(target);
                switch (result.status) {
                    case 'removed':
                        console.log(`✓ Agent '${result.shortAgentName}' from repo '${result.repoName}' disabled.`);
                        break;
                    case 'not-found':
                        console.log(`Agent '${target}' is not enabled in this workspace.`);
                        break;
                    case 'static-removed':
                        console.log(`✓ Static agent '${target}' configuration cleared.`);
                        break;
                    case 'ambiguous':
                        console.log(`Agent name '${target}' is ambiguous. Please specify one of:`);
                        for (const entry of result.matches || []) {
                            console.log(`  - ${entry}`);
                        }
                        break;
                    case 'container-exists':
                        console.log(`Cannot disable agent '${result.shortAgentName}' because container '${result.containerName}' still exists. Please destroy the container before disabling the agent.`);
                        break;
                    default:
                        console.log(`No changes made for agent '${target}'.`);
                        break;
                }
            } catch (error) {
                throw new Error(`disable agent failed: ${error?.message || error}`);
            }
            break;
        }
        // 'run' legacy commands removed; use 'start', 'cli', 'shell', 'console'.
        case 'start':
            await startWorkspace(options[0], options[1], { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
            break;
        // 'route' and 'probe' commands removed (replaced by start/status and client commands)
        case 'webconsole': {
            // Alias of webtty; supports optional shell and --rotate
            const argsList = (options || []).filter(Boolean);
            let shellCandidate = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else if (!shellCandidate) {
                    shellCandidate = arg;
                }
            }
            if (shellCandidate) {
                const ok = configureWebttyShell(shellCandidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) { }
            }
            if (rotate) await refreshComponentToken('webtty');
            else ensureComponentToken('webtty');
            break;
        }
        case 'webchat': {
            const argsList = (options || []).filter(Boolean);
            let rotate = false;
            const positional = [];
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else {
                    positional.push(arg);
                }
            }

            if (rotate) refreshComponentToken('webchat');
            else ensureComponentToken('webchat');

            if (!rotate && positional.length) {
                console.warn('webchat: argument-based configuration has been removed; tokens are still managed by this command.');
            }
            break;
        }
        case 'sso':
            await handleSsoCommand(options);
            break;
        case 'webtty': {
            const argsList = (options || []).filter(Boolean);
            let shellCandidate = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                } else if (!shellCandidate) {
                    shellCandidate = arg;
                }
            }
            if (shellCandidate) {
                const ok = configureWebttyShell(shellCandidate);
                if (!ok) break;
                // Apply immediately if workspace start is configured
                try { await handleCommand(['restart']); } catch (_) { }
            }
            if (rotate) await refreshComponentToken('webtty');
            else ensureComponentToken('webtty');
            break;
        }
        case 'dashboard': {
            const rotate = (options || []).includes('--rotate');
            if (rotate) await refreshComponentToken('dashboard');
            else ensureComponentToken('dashboard');
            break;
        }
        case 'webmeet': {
            const argsList = (options || []).filter(Boolean);
            let moderator = null;
            let rotate = false;
            for (const arg of argsList) {
                if (String(arg).startsWith('--')) {
                    if (arg === '--rotate') rotate = true;
                    continue;
                }
                if (!moderator) moderator = arg;
            }
            if (moderator) {
                try {
                    await enableAgent(moderator);
                    envSvc.setEnvVar('WEBMEET_AGENT', moderator);
                    console.log(`✓ Stored WebMeet moderator agent: ${moderator}`);
                } catch (e) {
                    console.error(`webmeet: failed to configure agent '${moderator}': ${e?.message || e}`);
                }
            }
            if (rotate) {
                refreshComponentToken('webmeet');
            } else {
                ensureComponentToken('webmeet');
            }
            break;
        }
        case 'list':
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else if (options[0] === 'routes') listRoutes();
            else showHelp();
            break;
        case 'status':
            await statusWorkspace();
            break;
        case 'restart': {
            const target = (options[0] || '').trim();
            if (target && target.toLowerCase() === 'router') {
                const cfg = workspaceSvc.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) {
                    console.error('restart router: start is not configured. Run: start <staticAgent> <port> first.');
                    break;
                }
                console.log('[restart] Restarting RoutingServer (containers untouched)...');
                killRouterIfRunning();
                await startWorkspace(undefined, undefined, {
                    refreshComponentToken,
                    ensureComponentToken,
                    enableAgent,
                    killRouterIfRunning: () => { }
                });
                console.log('[restart] RoutingServer restarted.');
                break;
            }

            if (target) {
                const agentName = target;
                const { getAgentContainerName, getRuntime, isContainerRunning } = dockerSvc;
                let resolved;
                try {
                    resolved = findAgent(agentName);
                } catch (err) {
                    console.error(err?.message || `Agent '${agentName}' not found.`);
                    return;
                }

                const runtime = getRuntime();
                const containerName = getAgentContainerName(resolved.shortAgentName, resolved.repo);

                if (!isContainerRunning(containerName)) {
                    console.error(`Agent '${agentName}' is not running.`);
                    return;
                }

                console.log(`Restarting (stop/start) agent '${agentName}'...`);

                try {
                    execSync(`${runtime} stop ${containerName}`, { stdio: 'inherit' });
                } catch (e) {
                    console.error(`Failed to stop container ${containerName}: ${e.message}`);
                    return;
                }

                try {
                    execSync(`${runtime} start ${containerName}`, { stdio: 'inherit' });
                    console.log('✓ Agent restarted.');
                } catch (e) {
                    console.error(`Failed to start container ${containerName}: ${e.message}`);
                }
            } else {
                const cfg = workspaceSvc.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) { console.error('restart: start is not configured. Run: start <staticAgent> <port>'); break; }
                console.log('[restart] Stopping Router and configured agents...');
                killRouterIfRunning();
                console.log('[restart] Stopping configured agent containers...');
                const list = dockerSvc.stopConfiguredAgents();
                if (list.length) { console.log('[restart] Stopped containers:'); list.forEach(n => console.log(` - ${n}`)); }
                else { console.log('[restart] No containers to stop.'); }
                console.log('[restart] Starting workspace...');
                await startWorkspace(undefined, undefined, { refreshComponentToken, ensureComponentToken, enableAgent, killRouterIfRunning });
                console.log('[restart] Done.');
            }
            break;
        }
        case 'delete':
            showHelp();
            break;
        case 'shutdown': {
            console.log('[shutdown] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[shutdown] Removing workspace containers...');
            const list = dockerSvc.destroyWorkspaceContainers();
            if (list.length) {
                console.log('[shutdown] Removed containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Destroyed ${list.length} containers from this workspace (per .ploinky/agents).`);
            break;
        }
        case 'stop': {
            console.log('[stop] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[stop] Stopping configured agent containers...');
            const list = dockerSvc.stopConfiguredAgents();
            if (list.length) {
                console.log('[stop] Stopped containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Stopped ${list.length} configured agent containers.`);
            break;
        }
        case 'destroy':
            console.log('[destroy] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[destroy] Removing all workspace containers...');
            await destroyAll();
            break;
        case 'logs': {
            const sub = options[0];
            if (sub === 'tail') {
                const kind = options[1] || 'router';
                if (kind !== 'router') { console.log('Only router logs are available.'); break; }
                await logsTail('router');
            } else if (sub === 'last') {
                const count = options[1] || '200';
                const kind = options[2];
                if (kind && kind !== 'router') { console.log('Only router logs are available.'); break; }
                showLast(count, 'router');
            } else { console.log("Usage: logs tail [router] | logs last <count>"); }
            break;
        }
        case 'clean':
            console.log('[clean] Removing all workspace containers...');
            await destroyAll();
            break;
        case 'help':
            showHelp(options);
            break;
        case 'cloud':
            console.log('Cloud commands are not available in this build.');
            break;
        case 'client': {
            await new ClientCommands().handleClientCommand(options);
            break;
        }
        default: {
            if (!isKnownCommand(command)) {
                const handled = await handleSystemCommand(command, options);
                if (!handled) {
                    await handleInvalidCommand(command, options);
                }
            } else {
                console.log(`Command '${command}' is currently not supported by this build. Type help to see available options.`);
            }
            break;
        }
    }
}

export {
    handleCommand,
    getAgentNames,
    getRepoNames,
    findAgentManifest,
    addRepo,
    enableRepo,
    disableRepo,
    listAgents,
    listRepos,
    listCurrentAgents,
    shutdownSession,
    cleanupSessionContainers,
    destroyAll
};
