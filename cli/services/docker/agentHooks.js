import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { normalizeLifecycleCommands } from './agentCommands.js';
import { containerRuntime, waitForContainerRunning, isContainerRunning } from './common.js';
import { WORKSPACE_ROOT } from '../config.js';


function ensureSharedHostDir() {
    const dir = path.resolve(WORKSPACE_ROOT, 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
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
    runPostinstallHook
};
