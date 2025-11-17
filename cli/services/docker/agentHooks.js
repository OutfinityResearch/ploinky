import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildEnvFlags } from '../secretVars.js';
import { normalizeLifecycleCommands } from './agentCommands.js';
import { containerRuntime, flagsToArgs, waitForContainerRunning } from './common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_LIB_PATH = path.resolve(__dirname, '../../../Agent');

function ensureSharedHostDir() {
    const dir = path.resolve(process.cwd(), 'shared');
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

function runPostinstallHook(agentName, containerName, manifest, cwd) {
    const commands = normalizeLifecycleCommands(manifest?.postinstall);
    if (!commands.length) return;

    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[postinstall] ${agentName}: container not running; cannot execute postinstall commands.`);
    }

    for (const cmd of commands) {
        console.log(`[postinstall] ${agentName}: cd '${cwd}' && ${cmd}`);
        const res = spawnSync(containerRuntime, ['exec', containerName, 'sh', '-lc', `cd '${cwd}' && ${cmd}`], { stdio: 'inherit' });
        if (res.status !== 0) {
            throw new Error(`[postinstall] ${agentName}: command exited with ${res.status}`);
        }
    }

    console.log(`[postinstall] ${agentName}: restarting container ${containerName}`);
    const restartRes = spawnSync(containerRuntime, ['restart', containerName], { stdio: 'inherit' });
    if (restartRes.status !== 0) {
        throw new Error(`[postinstall] ${agentName}: restart failed with code ${restartRes.status}`);
    }

    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[postinstall] ${agentName}: container did not reach running state after restart.`);
    }
}

export {
    ensureSharedHostDir,
    runInstallHook,
    runPostinstallHook
};
