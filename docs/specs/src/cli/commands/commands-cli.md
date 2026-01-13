# cli/commands/cli.js - Main Command Handler

## Overview

The central command dispatcher for the Ploinky CLI. Routes all CLI commands to their appropriate handlers, manages agent operations, workspace lifecycle, and provides the main command parsing logic.

## Source File

`cli/commands/cli.js`

## Dependencies

```javascript
import { execSync, spawn } from 'child_process';
import { debugLog, findAgent } from '../services/utils.js';
import { isKnownCommand } from '../services/commandRegistry.js';
import 'achillesAgentLib/LLMAgents';
import { showHelp } from '../services/help.js';
import * as envSvc from '../services/secretVars.js';
import * as agentsSvc from '../services/agents.js';
import { listRepos, listAgents, listCurrentAgents, listRoutes, statusWorkspace } from '../services/status.js';
import { logsTail, showLast } from '../services/logUtils.js';
import { startWorkspace, runCli, runShell, refreshAgent } from '../services/workspaceUtil.js';
import { refreshComponentToken, ensureComponentToken, getComponentToken } from '../server/utils/routerEnv.js';
import {
    getAgentContainerName,
    getRuntime,
    isContainerRunning,
    stopConfiguredAgents,
    destroyWorkspaceContainers
} from '../services/docker/index.js';
import * as workspaceSvc from '../services/workspace.js';
import { handleSystemCommand, handleInvalidCommand, resetLlmInvokerCache } from './llmSystemCommands.js';
import * as inputState from '../services/inputState.js';
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
import { runSettingsMenu } from '../services/settingsMenu.js';
import { configureWebttyShell } from './webttyCommands.js';
import { handleProfileCommand } from './profileCommands.js';
import {
    cleanupSessionContainers,
    destroyAll,
    killRouterIfRunning,
    shutdownSession,
} from './sessionControl.js';
import { handleSsoCommand } from './ssoCommands.js';
import ClientCommands from './client.js';
```

## Data Structures

```javascript
/**
 * Parsed enable agent arguments
 * @typedef {Object} EnableAgentArgs
 * @property {string|undefined} agentName - Agent name (short or repo/name)
 * @property {string|undefined} mode - Mode (global or devel)
 * @property {string|undefined} repoName - Optional repository name
 * @property {string|undefined} alias - Optional alias for the agent
 */

/**
 * Disable agent result
 * @typedef {Object} DisableResult
 * @property {'removed'|'not-found'|'static-removed'|'ambiguous'|'container-exists'} status
 * @property {string} [shortAgentName] - Agent short name
 * @property {string} [repoName] - Repository name
 * @property {string} [containerName] - Container name if exists
 * @property {string[]} [matches] - Ambiguous matches
 */
```

## Internal Functions

### parseEnableAgentArgs(rawOptions)

**Purpose**: Parses the arguments for the `enable agent` command, supporting alias syntax

**Parameters**:
- `rawOptions` (string[]): Raw command arguments

**Returns**: `EnableAgentArgs`

**Implementation**:
```javascript
function parseEnableAgentArgs(rawOptions = []) {
    const tokens = rawOptions
        .filter(arg => arg !== undefined && arg !== null)
        .map(arg => (typeof arg === 'string' ? arg.trim() : arg))
        .filter(arg => !(typeof arg === 'string' && arg.length === 0));

    if (!tokens.length) {
        return { agentName: undefined, mode: undefined, repoName: undefined, alias: undefined };
    }

    // Look for 'as' keyword for alias
    let alias;
    let aliasIndex = -1;
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (typeof token === 'string' && token.toLowerCase() === 'as') {
            aliasIndex = i;
            break;
        }
    }

    if (aliasIndex !== -1) {
        alias = tokens.slice(aliasIndex + 1).join(' ').trim();
        tokens.splice(aliasIndex);
        if (!alias) {
            throw new Error("Usage: enable agent <name|repo/name> [global|devel [repoName]] [as <alias>]");
        }
    }

    return {
        agentName: tokens[0],
        mode: tokens[1],
        repoName: tokens[2],
        alias,
    };
}
```

## Public API

### handleCommand(args)

**Purpose**: Main command dispatcher - routes commands to appropriate handlers

**Parameters**:
- `args` (string[]): Command and arguments array

**Returns**: `Promise<void>`

**Implementation**:
```javascript
async function handleCommand(args) {
    const [command, ...options] = args;
    switch (command) {
        case 'shell':
            // Open interactive shell in agent container
            if (!options[0]) { showHelp(); break; }
            await runShell(options[0]);
            break;

        case 'cli':
            // Execute command in agent container
            if (!options[0]) { showHelp(); break; }
            await runCli(options[0], options.slice(1));
            break;

        case 'add':
            // Add repository
            if (options[0] === 'repo') addRepo(options[1], options[2]);
            else showHelp();
            break;

        case 'vars':
            // List all environment variables
            handleVarsCommand();
            break;

        case 'var':
            // Get/set single environment variable
            handleVarCommand(options);
            break;

        case 'echo':
            // Echo with variable expansion
            handleEchoCommand(options);
            break;

        case 'update':
            // Update agent or repository
            if (options[0] === 'agent') await updateAgent(options[1]);
            else if (options[0] === 'repo') await updateRepo(options[1]);
            else showHelp();
            break;

        case 'refresh':
            // Refresh agent code without rebuilding
            if (options[0] === 'agent' && options[1]) await refreshAgent(options[1]);
            else showHelp();
            break;

        case 'enable':
            // Enable repository or agent
            if (options[0] === 'repo') enableRepo(options[1]);
            else if (options[0] === 'agent') {
                const parsed = parseEnableAgentArgs(options.slice(1));
                await enableAgent(parsed.agentName, parsed.mode, parsed.repoName, parsed.alias);
            }
            else showHelp();
            break;

        case 'expose':
            // Expose environment variable to agent
            handleExposeCommand(options);
            break;

        case 'disable': {
            // Disable repository or agent
            if (!options.length) { showHelp(); break; }

            if (options[0] === 'repo') {
                disableRepo(options[1]);
                break;
            }

            // Handle agent disable
            let target = options.join(' ').trim();
            if (options[0] === 'agent') {
                target = options.slice(1).join(' ').trim();
            }

            if (!target) { showHelp(); break; }

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

        case 'start':
            // Start workspace with optional static agent and port
            await startWorkspace(options[0], options[1], {
                refreshComponentToken,
                ensureComponentToken,
                enableAgent,
                killRouterIfRunning
            });
            break;

        case 'webconsole':
        case 'webtty': {
            // Configure and manage WebTTY
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
                try { await handleCommand(['restart']); } catch (_) { }
            }
            if (rotate) await refreshComponentToken('webtty');
            else ensureComponentToken('webtty');
            break;
        }

        case 'webchat': {
            // Manage WebChat tokens
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
            // SSO configuration
            await handleSsoCommand(options);
            break;

        case 'dashboard': {
            // Manage dashboard tokens
            const rotate = (options || []).includes('--rotate');
            if (rotate) await refreshComponentToken('dashboard');
            else ensureComponentToken('dashboard');
            break;
        }

        case 'webmeet': {
            // Configure WebMeet with moderator agent
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
            if (rotate) refreshComponentToken('webmeet');
            else ensureComponentToken('webmeet');
            break;
        }

        case 'list':
            // List agents, repos, or routes
            if (options[0] === 'agents') listAgents();
            else if (options[0] === 'repos') listRepos();
            else if (options[0] === 'routes') listRoutes();
            else showHelp();
            break;

        case 'status':
            // Show workspace status
            await statusWorkspace();
            break;

        case 'restart': {
            // Restart router, agent, or entire workspace
            const target = (options[0] || '').trim();
            if (target && target.toLowerCase() === 'router') {
                // Restart only the router
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
                // Restart specific agent
                const agentName = target;
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
                    resolved = findAgent(lookup);
                } catch (err) {
                    console.error(err?.message || `Agent '${agentName}' not found.`);
                    return;
                }

                const runtime = getRuntime();
                const containerName = registryRecord?.containerName ||
                    getAgentContainerName(resolved.shortAgentName, resolved.repo);

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
                // Restart entire workspace
                const cfg = workspaceSvc.getConfig();
                if (!cfg || !cfg.static || !cfg.static.agent || !cfg.static.port) {
                    console.error('restart: start is not configured. Run: start <staticAgent> <port>');
                    break;
                }
                console.log('[restart] Stopping Router and configured agents...');
                killRouterIfRunning();
                console.log('[restart] Stopping configured agent containers...');
                const list = stopConfiguredAgents();
                if (list.length) {
                    console.log('[restart] Stopped containers:');
                    list.forEach(n => console.log(` - ${n}`));
                } else {
                    console.log('[restart] No containers to stop.');
                }
                console.log('[restart] Starting workspace...');
                await startWorkspace(undefined, undefined, {
                    refreshComponentToken,
                    ensureComponentToken,
                    enableAgent,
                    killRouterIfRunning
                });
                console.log('[restart] Done.');
            }
            break;
        }

        case 'shutdown': {
            // Stop router and destroy workspace containers
            console.log('[shutdown] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[shutdown] Removing workspace containers...');
            const list = destroyWorkspaceContainers();
            if (list.length) {
                console.log('[shutdown] Removed containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Destroyed ${list.length} containers from this workspace (per .ploinky/agents).`);
            break;
        }

        case 'stop': {
            // Stop router and agent containers without destroying
            console.log('[stop] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[stop] Stopping configured agent containers...');
            const list = stopConfiguredAgents();
            if (list.length) {
                console.log('[stop] Stopped containers:');
                list.forEach(n => console.log(` - ${n}`));
            }
            console.log(`Stopped ${list.length} configured agent containers.`);
            break;
        }

        case 'destroy':
            // Destroy all workspace containers
            console.log('[destroy] Stopping RoutingServer...');
            killRouterIfRunning();
            console.log('[destroy] Removing all workspace containers...');
            await destroyAll();
            break;

        case 'logs': {
            // View logs
            const sub = options[0];
            if (sub === 'tail') {
                const kind = options[1] || 'router';
                if (kind !== 'router') {
                    console.log('Only router logs are available.');
                    break;
                }
                await logsTail('router');
            } else if (sub === 'last') {
                const count = options[1] || '200';
                const kind = options[2];
                if (kind && kind !== 'router') {
                    console.log('Only router logs are available.');
                    break;
                }
                showLast(count, 'router');
            } else {
                console.log("Usage: logs tail [router] | logs last <count>");
            }
            break;
        }

        case 'clean':
            // Alias for destroy
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
            // MCP client commands
            await new ClientCommands().handleClientCommand(options);
            break;
        }

        case '/settings':
        case 'settings': {
            // Open settings menu
            await runSettingsMenu({ onEnvChange: resetLlmInvokerCache });
            break;
        }

        case 'set': {
            console.log("Command renamed to '/settings'.");
            break;
        }

        case 'profile': {
            // Profile management
            await handleProfileCommand(options);
            break;
        }

        default: {
            // Unknown command - try system command or LLM suggestion
            if (!isKnownCommand(command)) {
                const handled = await handleSystemCommand(command, options);
                if (!handled) {
                    await handleInvalidCommand(command, options, async (suggestedLine) => {
                        const trimmedSuggestion = (suggestedLine || '').trim();
                        if (!trimmedSuggestion) return;

                        const shellMetaPattern = /[|&;<>(){}\[\]`$]/;
                        if (shellMetaPattern.test(trimmedSuggestion)) {
                            // Execute via shell
                            console.log(`[LLM] Executing shell command: ${trimmedSuggestion}`);
                            await new Promise((resolve) => {
                                const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
                                let finished = false;
                                const finish = () => {
                                    if (finished) return;
                                    finished = true;
                                    try { restoreInput(); } catch (_) {}
                                    resolve();
                                };
                                let child;
                                try {
                                    child = spawn(process.env.SHELL || 'bash', ['-lc', trimmedSuggestion], { stdio: 'inherit' });
                                } catch (error) {
                                    console.error(`[LLM] Failed to start suggested command: ${error?.message || error}`);
                                    finish();
                                    return;
                                }
                                child.on('exit', (code) => {
                                    if (code && code !== 0) {
                                        console.error(`[LLM] Command exited with code ${code}`);
                                    }
                                    finish();
                                });
                                child.on('error', (error) => {
                                    console.error(`[LLM] Failed to run suggested command: ${error?.message || error}`);
                                    finish();
                                });
                            });
                            return;
                        }

                        // Execute as Ploinky command
                        const argsToRun = trimmedSuggestion.split(/\s+/).filter(Boolean);
                        if (!argsToRun.length) return;
                        await handleCommand(argsToRun);
                    });
                }
            } else {
                console.log(`Command '${command}' is currently not supported by this build. Type help to see available options.`);
            }
            break;
        }
    }
}
```

## Exports

```javascript
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
```

## Command Reference

| Command | Syntax | Description |
|---------|--------|-------------|
| `shell` | `shell <agent>` | Open interactive shell in agent container |
| `cli` | `cli <agent> [args...]` | Execute command in agent container |
| `add` | `add repo <name> [url]` | Add repository |
| `vars` | `vars` | List all environment variables |
| `var` | `var <name> [value]` | Get/set environment variable |
| `echo` | `echo <text>` | Echo with variable expansion |
| `update` | `update agent\|repo <name>` | Update agent or repository |
| `refresh` | `refresh agent <name>` | Refresh agent code |
| `enable` | `enable repo\|agent <name> [options]` | Enable repository or agent |
| `expose` | `expose <VAR> <value> <agent>` | Expose env var to agent |
| `disable` | `disable [repo\|agent] <name>` | Disable repository or agent |
| `start` | `start [agent] [port]` | Start workspace |
| `webtty` | `webtty [shell] [--rotate]` | Configure WebTTY |
| `webchat` | `webchat [--rotate]` | Manage WebChat tokens |
| `webmeet` | `webmeet [agent] [--rotate]` | Configure WebMeet |
| `dashboard` | `dashboard [--rotate]` | Manage dashboard tokens |
| `list` | `list agents\|repos\|routes` | List items |
| `status` | `status` | Show workspace status |
| `restart` | `restart [router\|agent]` | Restart components |
| `shutdown` | `shutdown` | Stop and destroy workspace |
| `stop` | `stop` | Stop without destroying |
| `destroy` | `destroy` | Destroy all containers |
| `logs` | `logs tail\|last [count]` | View logs |
| `client` | `client <subcommand>` | MCP client operations |
| `profile` | `profile <subcommand>` | Profile management |
| `settings` | `settings` | Open settings menu |
| `sso` | `sso <subcommand>` | SSO configuration |

## Error Handling

- Invalid commands show help
- Agent operations handle ambiguous names
- Container operations catch and report failures
- LLM fallback for unknown commands

## Integration Points

- All service modules in `services/`
- All command modules in `commands/`
- Docker/container runtime via `services/docker/`
- Router management via `server/utils/routerEnv.js`

## Related Modules

- [commands-client.md](./commands-client.md) - MCP client commands
- [commands-repo-agent.md](./commands-repo-agent.md) - Repository/agent commands
- [commands-env-vars.md](./commands-env-vars.md) - Environment variable commands
- [commands-session-control.md](./commands-session-control.md) - Session control
