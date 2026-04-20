import { spawnSync } from 'child_process';
import { containerRuntime, getRuntimeForAgent } from './docker/common.js';

const SUPPORTED_FAMILIES = new Set(['bwrap', 'seatbelt', 'container']);

function normalizeRuntimeFamily(runtime) {
    if (runtime === 'bwrap' || runtime === 'seatbelt') return runtime;
    if (runtime === 'docker' || runtime === 'podman') return 'container';
    return runtime;
}

function nodeMajorFromVersion(version) {
    const raw = String(version || '').split('.')[0];
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildRuntimeKey({ family, platform, arch, nodeMajor, variant = '' }) {
    if (!SUPPORTED_FAMILIES.has(family)) {
        throw new Error(`Unsupported runtime family: ${family}`);
    }
    if (!platform || !arch || !nodeMajor) {
        throw new Error(`Incomplete runtime-key inputs: family=${family} platform=${platform} arch=${arch} nodeMajor=${nodeMajor}`);
    }
    const variantSuffix = variant ? `-${variant}` : '';
    return `${family}-${platform}-${arch}${variantSuffix}-node${nodeMajor}`;
}

export function detectHostRuntimeKey(runtimeFamily) {
    const family = normalizeRuntimeFamily(runtimeFamily);
    if (family === 'container') {
        throw new Error('detectHostRuntimeKey does not support container runtimes; use detectContainerRuntimeKey.');
    }
    return buildRuntimeKey({
        family,
        platform: process.platform,
        arch: process.arch,
        nodeMajor: nodeMajorFromVersion(process.versions.node),
    });
}

export function detectRuntimeKeyForAgent(manifest, repoName, agentName) {
    const runtime = getRuntimeForAgent(manifest);
    const family = normalizeRuntimeFamily(runtime);
    if (family === 'container') {
        return detectContainerRuntimeKey({ manifest, repoName, agentName, runtime });
    }
    return detectHostRuntimeKey(family);
}

export function parseContainerProbeOutput(raw) {
    const text = String(raw || '').trim();
    if (!text) {
        throw new Error('Container runtime-key probe returned no output.');
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new Error(`Container runtime-key probe returned invalid JSON: ${err.message}`);
    }
    const platform = String(parsed?.platform || '').trim();
    const arch = String(parsed?.arch || '').trim();
    const nodeMajor = Number.parseInt(parsed?.nodeMajor, 10);
    const libc = String(parsed?.libc || '').trim().toLowerCase();
    if (!platform || !arch || !Number.isFinite(nodeMajor) || nodeMajor <= 0) {
        throw new Error('Container runtime-key probe response is incomplete.');
    }
    const variant = platform === 'linux' && (libc === 'glibc' || libc === 'musl')
        ? libc
        : '';
    return { platform, arch, nodeMajor, variant };
}

function defaultContainerProbe({ image, runtime }) {
    const probeScript = [
        'const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;',
        'const header = report && report.header ? report.header : null;',
        'const libc = process.platform === "linux" ? (header && header.glibcVersionRuntime ? "glibc" : "musl") : "";',
        'process.stdout.write(JSON.stringify({',
        '  platform: process.platform,',
        '  arch: process.arch,',
        '  nodeMajor: parseInt(process.versions.node.split(".")[0], 10),',
        '  libc',
        '}));',
    ].join('');
    const args = ['run', '--rm', '--entrypoint', 'node', image, '-e', probeScript];
    const res = spawnSync(runtime, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    if (res.error) {
        throw new Error(`Container runtime-key probe failed: ${res.error.message}`);
    }
    if (res.status !== 0) {
        const stderr = String(res.stderr || '').trim();
        throw new Error(`Container runtime-key probe exited with code ${res.status}${stderr ? `: ${stderr}` : ''}`);
    }
    return String(res.stdout || '').trim();
}

export function detectContainerRuntimeKey({
    manifest = null,
    repoName = '',
    agentName = '',
    runtime = containerRuntime,
    image = '',
    execProbe = defaultContainerProbe,
} = {}) {
    const resolvedImage = String(image || manifest?.container || manifest?.image || '').trim();
    if (!resolvedImage) {
        throw new Error(`Container runtime-key detection requires an image${repoName || agentName ? ` for ${repoName}/${agentName}` : ''}.`);
    }
    const output = execProbe({ image: resolvedImage, runtime, manifest, repoName, agentName });
    const probe = parseContainerProbeOutput(output);
    return buildRuntimeKey({
        family: 'container',
        platform: probe.platform,
        arch: probe.arch,
        nodeMajor: probe.nodeMajor,
        variant: probe.variant,
    });
}

export function parseRuntimeKey(runtimeKey) {
    const match = /^([a-z]+)-([a-z0-9]+)-([a-z0-9_]+)(?:-([a-z0-9_]+))?-node(\d+)$/.exec(String(runtimeKey || ''));
    if (!match) return null;
    return {
        family: match[1],
        platform: match[2],
        arch: match[3],
        variant: match[4] || '',
        nodeMajor: parseInt(match[5], 10),
    };
}

export { normalizeRuntimeFamily, buildRuntimeKey, SUPPORTED_FAMILIES };
