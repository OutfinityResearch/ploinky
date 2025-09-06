const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

function detectRuntime() {
    return new Promise((resolve) => {
        exec('command -v docker', (err) => {
            if (!err) return resolve('docker');
            exec('command -v podman', (err2) => {
                if (!err2) return resolve('podman');
                resolve(null);
            });
        });
    });
}

async function* walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            yield p;
            yield* walk(p);
        }
    }
}

async function readAgentsFile(file) {
    try {
        const data = await fs.readFile(file, 'utf-8');
        return JSON.parse(data);
    } catch { return {}; }
}

async function stopAndRemove(runtime, name) {
    const run = (cmd) => new Promise((resolve) => exec(cmd, () => resolve()));
    await run(`${runtime} stop ${name}`);
    await run(`${runtime} rm ${name}`);
}

async function cleanupAllAgents(workingDir, logger) {
    const runtime = await detectRuntime();
    const result = { runtime: runtime || 'none', removed: [], errors: [] };
    if (!runtime) return result;

    for await (const dir of walk(workingDir)) {
        if (!dir.endsWith('.ploinky')) continue;
        const agentsPath = path.join(dir, '.agents');
        const exists = await fs.access(agentsPath).then(() => true).catch(() => false);
        if (!exists) continue;
        const agents = await readAgentsFile(agentsPath);
        const names = Object.keys(agents || {});
        for (const containerName of names) {
            try {
                await stopAndRemove(runtime, containerName);
                result.removed.push(containerName);
                logger?.log('info', 'Removed agent container', { containerName });
            } catch (e) {
                result.errors.push({ containerName, error: e.message });
                logger?.log('warn', 'Failed removing agent container', { containerName, error: e.message });
            }
        }
        // Reset agents file
        try { await fs.writeFile(agentsPath, JSON.stringify({}, null, 2)); } catch {}
    }
    return result;
}

module.exports = { cleanupAllAgents };

