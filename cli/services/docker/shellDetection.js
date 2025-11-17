import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { containerRuntime } from './common.js';

const SHELL_PROBE_PATHS = ['/bin/bash', '/bin/sh', '/bin/ash', '/bin/dash', '/bin/zsh', '/bin/fish', '/bin/ksh'];
const SHELL_FALLBACK_DIRECT = Symbol('no-shell');
const shellDetectionCache = new Map();

function normalizeMountPath(raw) {
    const lines = String(raw || '').trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return '';
    const last = lines[lines.length - 1];
    const colonIdx = last.indexOf(':');
    if (colonIdx > 0 && !last.startsWith('/')) {
        return last.slice(colonIdx + 1).trim();
    }
    return last.trim();
}

function findShellInMount(mountPath) {
    for (const shellPath of SHELL_PROBE_PATHS) {
        const relPath = shellPath.replace(/^\/+/, '');
        const candidate = path.join(mountPath, relPath);
        try {
            const stats = fs.statSync(candidate);
            if (stats.isFile() && (stats.mode & 0o111)) {
                return shellPath;
            }
        } catch (_) {}
    }
    return '';
}

function detectShellViaImageMount(image) {
    if (containerRuntime !== 'podman') return '';
    let mountPoint = '';
    try {
        const mountRes = spawnSync(containerRuntime, ['image', 'mount', image], { stdio: ['ignore', 'pipe', 'pipe'] });
        if (mountRes.status !== 0) return '';
        mountPoint = normalizeMountPath(mountRes.stdout || mountRes.stderr);
        if (!mountPoint) return '';
        const shellPath = findShellInMount(mountPoint);
        return shellPath;
    } finally {
        if (mountPoint) {
            try { spawnSync(containerRuntime, ['image', 'unmount', mountPoint], { stdio: 'ignore' }); } catch (_) {}
        }
    }
}

function detectShellViaContainerRun(image) {
    for (const shellPath of SHELL_PROBE_PATHS) {
        const res = spawnSync(containerRuntime, ['run', '--rm', image, 'test', '-x', shellPath], { stdio: 'ignore' });
        if (res.status === 0) {
            return shellPath;
        }
    }
    return '';
}

function detectShellForImage(agentName, image) {
    if (!agentName || !image) {
        throw new Error('[start] Missing agent or image for shell detection.');
    }
    if (shellDetectionCache.has(image)) {
        return shellDetectionCache.get(image);
    }
    const fromMount = detectShellViaImageMount(image);
    const shellPath = fromMount || detectShellViaContainerRun(image);
    const finalShell = shellPath || SHELL_FALLBACK_DIRECT;
    shellDetectionCache.set(image, finalShell);
    return finalShell;
}

export {
    SHELL_FALLBACK_DIRECT,
    detectShellForImage
};
