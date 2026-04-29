import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-graph-'));

function writeManifest(repoName, agentName, manifest) {
    const agentDir = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
        path.join(agentDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    );
}

process.chdir(tempDir);

const moduleSuffix = `?test=${Date.now()}`;
const graphModuleUrl = new URL('../../cli/services/workspaceDependencyGraph.js', import.meta.url);
const graphModule = await import(`${graphModuleUrl.href}${moduleSuffix}`);
const {
    createGraphNodeId,
    parseManifestDependencyRef,
    resolveWorkspaceDependencyGraph,
    topologicallyGroupDependencyGraph
} = graphModule;

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('parseManifestDependencyRef strips mode and alias syntax down to the agent reference', () => {
    assert.equal(parseManifestDependencyRef('gitAgent global'), 'gitAgent');
    assert.equal(parseManifestDependencyRef('basic/keycloak as auth'), 'basic/keycloak');
    assert.equal(parseManifestDependencyRef('repo/agent:dev'), 'repo/agent');
});

test('resolveWorkspaceDependencyGraph collects recursive dependencies and preserves aliases', () => {
    writeManifest('demo', 'leaf', { container: 'node:20-alpine' });
    writeManifest('demo', 'dep', {
        container: 'node:20-alpine',
        enable: ['leaf']
    });
    writeManifest('demo', 'sidecar', { container: 'node:20-alpine' });
    writeManifest('demo', 'app', {
        container: 'node:20-alpine',
        enable: ['dep', 'sidecar as media']
    });

    const graph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'demo/app' });
    const waveIds = topologicallyGroupDependencyGraph(graph);

    assert.equal(graph.staticNodeId, 'demo/app');
    assert.ok(graph.nodes.has('demo/leaf'));
    assert.ok(graph.nodes.has('demo/dep'));
    assert.ok(graph.nodes.has('demo/sidecar as media'));
    assert.deepEqual(waveIds, [
        ['demo/leaf', 'demo/sidecar as media'],
        ['demo/dep'],
        ['demo/app']
    ]);
    assert.deepEqual(
        Array.from(graph.nodes.get('demo/app').dependencies).sort(),
        ['demo/dep', 'demo/sidecar as media']
    );
});

test('resolveWorkspaceDependencyGraph preserves the original enable spec for dependency modes', () => {
    writeManifest('demo', 'mode-target', { container: 'node:20-alpine' });
    writeManifest('demo', 'mode-app', {
        container: 'node:20-alpine',
        enable: ['mode-target global']
    });

    const graph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'demo/mode-app' });
    assert.equal(graph.nodes.get('demo/mode-target').enableSpec, 'mode-target global');
});

test('resolveWorkspaceDependencyGraph respects SSO gating for provider dependencies', () => {
    // SSO provider dependencies are skipped unless the parent manifest requests SSO mode.
    writeManifest('basic', 'keycloak', {
        container: 'quay.io/keycloak/keycloak:24.0',
        ssoProvider: true,
    });
    writeManifest('demo', 'plain-app', {
        container: 'node:20-alpine',
        enable: ['basic/keycloak']
    });
    writeManifest('demo', 'sso-app', {
        container: 'node:20-alpine',
        ploinky: 'sso enable',
        enable: ['basic/keycloak']
    });

    const plainGraph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'demo/plain-app' });
    assert.equal(plainGraph.nodes.has('basic/keycloak'), false);

    const ssoGraph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'demo/sso-app' });
    assert.equal(ssoGraph.nodes.has('basic/keycloak'), true);
});

test('resolveWorkspaceDependencyGraph uses registry auth mode when available', () => {
    writeManifest('demo', 'registry-sso-app', {
        container: 'node:20-alpine',
        enable: ['basic/keycloak']
    });

    const graph = resolveWorkspaceDependencyGraph({
        staticAgentRef: 'demo/registry-sso-app',
        registry: {
            [createGraphNodeId('demo', 'registry-sso-app')]: {
                type: 'agent',
                repoName: 'demo',
                agentName: 'registry-sso-app',
                auth: { mode: 'sso' }
            }
        }
    });

    assert.equal(graph.nodes.has('basic/keycloak'), true);
});

test('resolveWorkspaceDependencyGraph skips cyclic dependency edges with a readable warning', () => {
    writeManifest('cycle', 'a', {
        container: 'node:20-alpine',
        enable: ['cycle/b']
    });
    writeManifest('cycle', 'b', {
        container: 'node:20-alpine',
        enable: ['cycle/a']
    });

    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const graph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'cycle/a' });
        assert.deepEqual(topologicallyGroupDependencyGraph(graph), [
            ['cycle/b'],
            ['cycle/a']
        ]);
    } finally {
        console.error = originalError;
    }

    assert.equal(errors.length, 1);
    assert.match(errors[0], /Dependency cycle detected: cycle\/a -> cycle\/b -> cycle\/a/);
});

test('resolveWorkspaceDependencyGraph skips invalid dependency entries while preserving valid ones', () => {
    writeManifest('demo', 'simulator', { container: 'node:20-alpine' });
    writeManifest('demo', 'app-with-stale-enable', {
        container: 'node:20-alpine',
        enable: ['simulator', 'missing-agent', 'broken alias as']
    });

    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const graph = resolveWorkspaceDependencyGraph({ staticAgentRef: 'demo/app-with-stale-enable' });
        assert.deepEqual(
            topologicallyGroupDependencyGraph(graph),
            [['demo/simulator'], ['demo/app-with-stale-enable']]
        );
    } finally {
        console.error = originalError;
    }

    assert.equal(errors.length, 2);
    assert.match(errors[0], /Failed to resolve dependency 'missing-agent'/);
    assert.match(errors[1], /Failed to resolve dependency 'broken alias as'/);
});
