import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildEnvFlags } from '../secretVars.js';
import { normalizeLifecycleCommands } from './agentCommands.js';
import { containerRuntime, flagsToArgs, waitForContainerRunning, isContainerRunning } from './common.js';
import { WORKSPACE_ROOT } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');

function ensureSharedHostDir() {
    const dir = path.resolve(WORKSPACE_ROOT, 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}

function runInstallHook(agentName, manifest, agentPath, cwd) {
    const installCmd = String(manifest.install || '').trim();
    if (!installCmd) return;

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const projectRoot = process.env.PLOINKY_ROOT;
    const nodeModulesPath = projectRoot ? path.join(projectRoot, 'node_modules') : null;
    const sharedDir = ensureSharedHostDir();
    const volZ = runtime === 'podman' ? ':z' : '';
    const roZ = runtime === 'podman' ? ':ro,z' : ':ro';

    const args = ['run', '--rm', '-w', cwd,
        '-v', `${cwd}:${cwd}${volZ}`,
        '-v', `${AGENT_LIB_PATH}:/Agent${roZ}`,
        '-v', `${path.resolve(agentPath)}:/code${roZ}`,
        '-v', `${sharedDir}:/shared${volZ}`
    ];
    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }
    if (nodeModulesPath) {
        args.push('-v', `${nodeModulesPath}:/node_modules${roZ}`);
    }
    const envFlags = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags.length) args.push(...envFlags);
    console.log(`[install] ${agentName}: cd '${cwd}' && ${installCmd}`);
    args.push(image, '/bin/sh', '-lc', `cd '${cwd}' && ${installCmd}`);
    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error(`[install] ${agentName}: command exited with ${res.status}`);
    }
}

/**
 * Run preinstall hook for manifests without profiles.
 * Runs the preinstall command inside a temporary container before the main container starts.
 * The preinstall typically installs dependencies (npm install, pip install, etc.)
 *
 * @param {string} agentName - Agent name
 * @param {object} manifest - Agent manifest
 * @param {string} agentPath - Path to agent source code
 * @param {string} cwd - Working directory (agent workspace)
 * @param {string} nodeModulesPath - Path to mount node_modules (for persistence)
 */
function runPreinstallHook(agentName, manifest, agentPath, cwd, nodeModulesPath) {
    const preinstallCmd = String(manifest.preinstall || '').trim();
    if (!preinstallCmd) return;

    const runtime = containerRuntime;
    const image = manifest.container || manifest.image || 'node:18-alpine';
    const sharedDir = ensureSharedHostDir();
    const volZ = runtime === 'podman' ? ':z' : '';
    const roZ = runtime === 'podman' ? ':ro,z' : ':ro';

    // Use /code as working directory to match the main container
    const args = ['run', '--rm', '-w', '/code',
        '-v', `${cwd}:${cwd}${volZ}`,
        '-v', `${AGENT_LIB_PATH}:/Agent${roZ}`,
        '-v', `${path.resolve(agentPath)}:/code${volZ}`,
        '-v', `${sharedDir}:/shared${volZ}`
    ];

    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }

    // Mount node_modules for npm install to persist
    if (nodeModulesPath && fs.existsSync(path.dirname(nodeModulesPath))) {
        if (!fs.existsSync(nodeModulesPath)) {
            fs.mkdirSync(nodeModulesPath, { recursive: true });
        }
        args.push('-v', `${nodeModulesPath}:/code/node_modules${volZ}`);
    }

    const envFlags = flagsToArgs(buildEnvFlags(manifest));
    if (envFlags.length) args.push(...envFlags);

    console.log(`[preinstall] ${agentName}: ${preinstallCmd}`);
    args.push(image, '/bin/sh', '-lc', preinstallCmd);

    const res = spawnSync(runtime, args, { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error(`[preinstall] ${agentName}: command exited with ${res.status}`);
    }
}

function runPostinstallHook(agentName, containerName, manifest, cwd) {
    const commands = normalizeLifecycleCommands(manifest?.postinstall);
    if (!commands.length) return;

    if (!waitForContainerRunning(containerName, 40, 250)) {
        console.warn(`[postinstall] ${agentName}: container not running; skipping postinstall commands. Container may have exited immediately.`);
        return;
    }

    for (const cmd of commands) {
        // Check if container is still running before each command
        if (!isContainerRunning(containerName)) {
            console.warn(`[postinstall] ${agentName}: container exited before postinstall could complete. The agent may have crashed or exited. Skipping remaining postinstall commands.`);
            return;
        }
        console.log(`[postinstall] ${agentName}: cd '${cwd}' && ${cmd}`);
        const res = spawnSync(containerRuntime, ['exec', containerName, 'sh', '-lc', `cd '${cwd}' && ${cmd}`], { stdio: 'inherit' });
        if (res.status !== 0) {
            // If exec failed because container exited, warn instead of failing
            if (!isContainerRunning(containerName)) {
                console.warn(`[postinstall] ${agentName}: container exited during postinstall. The agent may need configuration or has dependencies issues.`);
                return;
            }
            throw new Error(`[postinstall] ${agentName}: command exited with ${res.status}`);
        }
    }

    // Only restart if the container is not already running
    // The postinstall commands may have caused the container to become unstable
    if (!isContainerRunning(containerName)) {
        console.log(`[postinstall] ${agentName}: restarting container ${containerName}`);
        const restartRes = spawnSync(containerRuntime, ['restart', containerName], { stdio: 'inherit' });
        if (restartRes.status !== 0) {
            // If restart fails, just warn - the container may have issues
            console.warn(`[postinstall] ${agentName}: restart failed with code ${restartRes.status}, container may need manual intervention`);
            return;
        }

        if (!waitForContainerRunning(containerName, 40, 250)) {
            console.warn(`[postinstall] ${agentName}: container did not reach running state after restart.`);
            return;
        }
    } else {
        console.log(`[postinstall] ${agentName}: container ${containerName} is already running, skipping restart`);
    }
}

export {
    ensureSharedHostDir,
    runInstallHook,
    runPreinstallHook,
    runPostinstallHook
};
