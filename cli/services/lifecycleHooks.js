import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { containerRuntime } from './docker/common.js';
import { debugLog } from './utils.js';
import { getProfileConfig, getProfileEnvVars, getHookNames } from './profileService.js';
import { validateSecrets, getSecrets, createEnvWithSecrets, formatMissingSecretsError } from './secretInjector.js';
import { installDependencies } from './dependencyInstaller.js';
import {
    initWorkspaceStructure,
    createAgentSymlinks,
    createAgentWorkDir
} from './workspaceStructure.js';

function normalizeProfileEnv(env) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(env)) {
        if (!key) continue;
        normalized[String(key)] = value === undefined ? '' : String(value);
    }
    return normalized;
}

/**
 * Execute a hook script on the host.
 * @param {string} scriptPath - Path to the script
 * @param {object} env - Environment variables to pass
 * @param {object} options - Options
 * @returns {{ success: boolean, message: string, output?: string }}
 */
export function executeHostHook(scriptPath, env = {}, options = {}) {
    const { cwd = process.cwd(), timeout = 300000 } = options;

    if (!scriptPath) {
        return { success: true, message: 'No hook script specified' };
    }

    const resolvedPath = path.isAbsolute(scriptPath) ? scriptPath : path.join(cwd, scriptPath);

    if (!fs.existsSync(resolvedPath)) {
        return { success: false, message: `Hook script not found: ${resolvedPath}` };
    }

    // Make script executable
    try {
        fs.chmodSync(resolvedPath, '755');
    } catch (_) {}

    const hookEnv = {
        ...process.env,
        ...env,
        PLOINKY_HOOK_TYPE: 'host'
    };

    try {
        debugLog(`[hook] Executing host hook: ${resolvedPath}`);
        const output = execSync(resolvedPath, {
            cwd,
            env: hookEnv,
            stdio: 'pipe',
            timeout
        }).toString();

        return { success: true, message: 'Hook executed successfully', output };
    } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        const stdout = err.stdout ? err.stdout.toString() : '';
        return {
            success: false,
            message: `Hook execution failed: ${err.message}`,
            output: stdout + stderr
        };
    }
}

/**
 * Execute a hook script inside a container.
 * @param {string} containerName - The container name
 * @param {string} script - The script content or command
 * @param {object} env - Environment variables to pass
 * @param {object} options - Options
 * @returns {{ success: boolean, message: string, output?: string }}
 */
export function executeContainerHook(containerName, script, env = {}, options = {}) {
    const { timeout = 300000, workdir = '/code' } = options;

    if (!script) {
        return { success: true, message: 'No hook script specified' };
    }

    const envFlags = [];
    for (const [key, value] of Object.entries(env)) {
        envFlags.push('-e', `${key}=${String(value ?? '')}`);
    }

    try {
        debugLog(`[hook] Executing container hook in ${containerName}: ${script}`);
        const result = spawnSync(containerRuntime, [
            'exec',
            ...envFlags,
            '-w',
            workdir,
            containerName,
            'sh',
            '-c',
            script
        ], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout
        });

        if (result.status === 0) {
            return { success: true, message: 'Hook executed successfully', output: result.stdout };
        }

        const output = `${result.stdout || ''}${result.stderr || ''}`;
        const errorMessage = result.error ? result.error.message : `command exited with ${result.status}`;
        return {
            success: false,
            message: `Hook execution failed: ${errorMessage}`,
            output
        };
    } catch (err) {
        return {
            success: false,
            message: `Hook execution failed: ${err.message}`,
            output: err.output ? err.output.toString() : ''
        };
    }
}

/**
 * Run the complete profile lifecycle for an agent.
 * Uses merged profile configuration (default + active profile).
 *
 * Hook execution order:
 * 1. hosthook_aftercreation [HOST] - Runs after container creation
 * 2. preinstall [CONTAINER] - Runs before install
 * 3. install [CONTAINER] - Main installation
 * 4. postinstall [CONTAINER] - Runs after install
 * 5. hosthook_postinstall [HOST] - Runs after container postinstall completes
 *
 * Full Lifecycle order:
 * 1. Workspace Structure Init [HOST]
 * 2. Symbolic Links Creation [HOST]
 * 3. Container Creation (handled externally)
 * 4. hosthook_aftercreation [HOST]
 * 5. Container Start (handled externally)
 * 6. Core Dependencies Installation [CONTAINER] (conditional)
 * 7. Agent Dependencies Installation [CONTAINER] (conditional)
 * 8. preinstall [CONTAINER]
 * 9. install [CONTAINER]
 * 10. postinstall [CONTAINER]
 * 11. hosthook_postinstall [HOST]
 * 12. Agent Ready
 *
 * @param {string} agentName - The agent name
 * @param {string} profileName - The profile name
 * @param {object} options - Options
 * @returns {{ success: boolean, steps: object[], errors: string[] }}
 */
export function runProfileLifecycle(agentName, profileName, options = {}) {
    const {
        containerName,
        agentPath,
        repoName,
        manifest,
        skipContainer = false,
        verbose = false
    } = options;

    const steps = [];
    const errors = [];
    const log = verbose ? console.log : debugLog;

    // Get profile configuration
    const profileConfig = getProfileConfig(`${repoName}/${agentName}`, profileName) || {};

    // Build environment variables
    const envVars = getProfileEnvVars(agentName, repoName, profileName, {
        containerName,
        containerId: containerName // We use container name as ID for simplicity
    });

    // Validate secrets
    if (profileConfig.secrets && profileConfig.secrets.length > 0) {
        const secretValidation = validateSecrets(profileConfig.secrets);
        if (!secretValidation.valid) {
            errors.push(formatMissingSecretsError(secretValidation.missing, profileName));
            return { success: false, steps, errors };
        }
    }

    // Get secrets for hooks
    const profileEnv = normalizeProfileEnv(profileConfig.env);
    const secrets = profileConfig.secrets ? getSecrets(profileConfig.secrets) : {};
    const hookEnv = createEnvWithSecrets({ ...envVars, ...profileEnv }, secrets);

    // Step 1: Workspace Structure Init [HOST]
    log('[lifecycle] Step 1: Initializing workspace structure...');
    try {
        initWorkspaceStructure();
        steps.push({ step: 1, name: 'workspace_init', success: true });
    } catch (err) {
        steps.push({ step: 1, name: 'workspace_init', success: false, error: err.message });
        errors.push(`Workspace init failed: ${err.message}`);
    }

    // Step 2: Symbolic Links Creation [HOST]
    log('[lifecycle] Step 2: Creating symbolic links...');
    try {
        if (agentPath) {
            createAgentSymlinks(agentName, repoName, agentPath);
            createAgentWorkDir(agentName);
        }
        steps.push({ step: 2, name: 'symlinks', success: true });
    } catch (err) {
        steps.push({ step: 2, name: 'symlinks', success: false, error: err.message });
        errors.push(`Symlink creation failed: ${err.message}`);
    }

    // Steps 3-5 are handled externally (container creation and start)
    if (skipContainer) {
        return { success: errors.length === 0, steps, errors };
    }

    // Step 4: hosthook_aftercreation [HOST]
    if (profileConfig.hosthook_aftercreation) {
        log('[lifecycle] Step 4: Running hosthook_aftercreation...');
        const hookPath = path.join(agentPath || '', profileConfig.hosthook_aftercreation);
        const result = executeHostHook(hookPath, hookEnv, { cwd: agentPath });
        steps.push({ step: 4, name: 'hosthook_aftercreation', success: result.success, output: result.output });
        if (!result.success) {
            errors.push(`hosthook_aftercreation failed: ${result.message}`);
        }
    }

    // Container should be started by caller before calling post-start hooks

    // Step 6 & 7: Dependencies Installation [CONTAINER] (conditional)
    if (containerName) {
        log('[lifecycle] Steps 6-7: Installing dependencies...');
        const depResult = installDependencies(containerName, agentName, { verbose });
        steps.push({ step: 6, name: 'dependencies', success: depResult.success, message: depResult.message });
        if (!depResult.success) {
            errors.push(`Dependency installation failed: ${depResult.message}`);
        }
    }

    // Step 8: preinstall [CONTAINER]
    if (profileConfig.preinstall && containerName) {
        log('[lifecycle] Step 8: Running preinstall hook...');
        const result = executeContainerHook(containerName, profileConfig.preinstall, hookEnv);
        steps.push({ step: 8, name: 'preinstall', success: result.success, output: result.output });
        if (!result.success) {
            errors.push(`preinstall hook failed: ${result.message}`);
        }
    }

    // Step 9: install [CONTAINER]
    if (profileConfig.install && containerName) {
        log('[lifecycle] Step 9: Running install hook...');
        const result = executeContainerHook(containerName, profileConfig.install, hookEnv);
        steps.push({ step: 9, name: 'install', success: result.success, output: result.output });
        if (!result.success) {
            errors.push(`install hook failed: ${result.message}`);
        }
    }

    // Step 10: postinstall [CONTAINER]
    if (profileConfig.postinstall && containerName) {
        log('[lifecycle] Step 10: Running postinstall hook...');
        const result = executeContainerHook(containerName, profileConfig.postinstall, hookEnv);
        steps.push({ step: 10, name: 'postinstall', success: result.success, output: result.output });
        if (!result.success) {
            errors.push(`postinstall hook failed: ${result.message}`);
        }
    }

    // Step 11: hosthook_postinstall [HOST]
    if (profileConfig.hosthook_postinstall) {
        log('[lifecycle] Step 11: Running hosthook_postinstall...');
        const hookPath = path.join(agentPath || '', profileConfig.hosthook_postinstall);
        const result = executeHostHook(hookPath, hookEnv, { cwd: agentPath });
        steps.push({ step: 11, name: 'hosthook_postinstall', success: result.success, output: result.output });
        if (!result.success) {
            errors.push(`hosthook_postinstall failed: ${result.message}`);
        }
    }

    // Step 12: Agent Ready
    steps.push({ step: 12, name: 'agent_ready', success: errors.length === 0 });

    return {
        success: errors.length === 0,
        steps,
        errors
    };
}

/**
 * Run only the pre-container steps of the lifecycle.
 * Steps: workspace init, symlinks
 * @param {string} agentName - The agent name
 * @param {string} repoName - The repository name
 * @param {string} agentPath - Path to the agent directory
 * @returns {{ success: boolean, errors: string[] }}
 */
export function runPreContainerLifecycle(agentName, repoName, agentPath) {
    const errors = [];

    try {
        initWorkspaceStructure();
    } catch (err) {
        errors.push(`Workspace init failed: ${err.message}`);
    }

    try {
        createAgentSymlinks(agentName, repoName, agentPath);
        createAgentWorkDir(agentName);
    } catch (err) {
        errors.push(`Symlink creation failed: ${err.message}`);
    }

    return {
        success: errors.length === 0,
        errors
    };
}

/**
 * Run only the post-container-start steps of the lifecycle.
 * Steps: dependencies, preinstall, install, postinstall
 * @param {string} containerName - The container name
 * @param {string} agentName - The agent name
 * @param {string} profileName - The profile name
 * @param {object} options - Options
 * @returns {{ success: boolean, errors: string[] }}
 */
export function runPostStartLifecycle(containerName, agentName, profileName, options = {}) {
    const { repoName, agentPath, verbose = false } = options;
    const errors = [];
    const log = verbose ? console.log : debugLog;

    // Get profile configuration
    const profileConfig = getProfileConfig(`${repoName}/${agentName}`, profileName) || {};

    // Build environment variables
    const envVars = getProfileEnvVars(agentName, repoName, profileName, { containerName });
    const profileEnv = normalizeProfileEnv(profileConfig.env);

    // Validate secrets
    if (profileConfig.secrets && profileConfig.secrets.length > 0) {
        const secretValidation = validateSecrets(profileConfig.secrets);
        if (!secretValidation.valid) {
            errors.push(formatMissingSecretsError(secretValidation.missing, profileName));
            return { success: false, errors };
        }
    }

    const secrets = profileConfig.secrets ? getSecrets(profileConfig.secrets) : {};
    const hookEnv = createEnvWithSecrets({ ...envVars, ...profileEnv }, secrets);

    // Dependencies
    log('[lifecycle] Installing dependencies...');
    const depResult = installDependencies(containerName, agentName, { verbose });
    if (!depResult.success) {
        errors.push(`Dependencies: ${depResult.message}`);
    }

    // Container hooks
    const hooks = ['preinstall', 'install', 'postinstall'];
    for (const hookName of hooks) {
        if (profileConfig[hookName]) {
            log(`[lifecycle] Running ${hookName}...`);
            const result = executeContainerHook(containerName, profileConfig[hookName], hookEnv);
            if (!result.success) {
                errors.push(`${hookName}: ${result.message}`);
            }
        }
    }

    // Host postinstall hook
    if (profileConfig.hosthook_postinstall && agentPath) {
        log('[lifecycle] Running hosthook_postinstall...');
        const hookPath = path.join(agentPath, profileConfig.hosthook_postinstall);
        const result = executeHostHook(hookPath, hookEnv, { cwd: agentPath });
        if (!result.success) {
            errors.push(`hosthook_postinstall: ${result.message}`);
        }
    }

    return {
        success: errors.length === 0,
        errors
    };
}

/**
 * Print lifecycle summary.
 * @param {{ success: boolean, steps: object[], errors: string[] }} result - Lifecycle result
 */
export function printLifecycleSummary(result) {
    console.log('');
    console.log('Lifecycle Summary:');
    console.log('------------------');

    for (const step of result.steps) {
        const status = step.success ? '✓' : '✗';
        const name = step.name.replace(/_/g, ' ');
        console.log(`  ${status} Step ${step.step}: ${name}`);
        if (step.error) {
            console.log(`      Error: ${step.error}`);
        }
    }

    console.log('');
    if (result.success) {
        console.log('All lifecycle steps completed successfully.');
    } else {
        console.log('Lifecycle completed with errors:');
        for (const error of result.errors) {
            console.log(`  - ${error}`);
        }
    }
}
