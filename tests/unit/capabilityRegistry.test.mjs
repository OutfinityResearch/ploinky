import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-caps-'));

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
const registryModule = await import(`../../cli/services/capabilityRegistry.js${moduleSuffix}`);
const {
    buildCapabilityIndex,
    listProvidersForContract,
    resolveAgentDescriptor,
    getAgentDescriptorByPrincipal,
    setCapabilityBinding,
    listCapabilityBindings,
    getCapabilityBinding,
    removeCapabilityBinding,
    resolveAliasForConsumer,
    resolveBindingsForConsumer,
    resolveBindingsForProvider,
    registerAgentPublicKey,
    getRegisteredAgentPublicKey,
    canonicalJsonHash
} = registryModule;

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buildCapabilityIndex surfaces provides/requires/principal', () => {
    writeManifest('dpu', 'dpuAgent', {
        provides: {
            'secret-store/v1': {
                operations: ['secret_get', 'secret_put'],
                supportedScopes: ['secret:read', 'secret:write']
            }
        },
        runtime: {
            resources: {
                persistentStorage: { key: 'dpu-data', containerPath: '/dpu-data' }
            }
        }
    });
    writeManifest('git', 'gitAgent', {
        requires: {
            secretStore: { contract: 'secret-store/v1', maxScopes: ['secret:read'] }
        }
    });

    const index = buildCapabilityIndex();
    assert.ok(index.agents.has('dpu/dpuAgent'));
    assert.ok(index.agents.has('git/gitAgent'));
    assert.deepEqual(index.byContract.get('secret-store/v1').map((d) => d.agentRef), ['dpu/dpuAgent']);
    assert.equal(index.byPrincipal.get('agent:dpu/dpuAgent').agent, 'dpuAgent');
});

test('resolveAgentDescriptor finds by full ref or short name', () => {
    const fullDescriptor = resolveAgentDescriptor('dpu/dpuAgent');
    assert.equal(fullDescriptor.agentRef, 'dpu/dpuAgent');
    const principalDescriptor = getAgentDescriptorByPrincipal('agent:git/gitAgent');
    assert.equal(principalDescriptor.agentRef, 'git/gitAgent');
});

test('listProvidersForContract returns only matching provides', () => {
    const providers = listProvidersForContract('secret-store/v1');
    assert.equal(providers.length, 1);
    assert.equal(providers[0].agentRef, 'dpu/dpuAgent');
});

test('capability bindings round-trip through workspace config', () => {
    const binding = setCapabilityBinding({
        consumer: 'git/gitAgent',
        alias: 'secretStore',
        provider: 'dpu/dpuAgent',
        contract: 'secret-store/v1',
        approvedScopes: ['secret:read']
    });
    assert.equal(binding.id, 'git/gitAgent:secretStore');
    assert.deepEqual(
        listCapabilityBindings().map((b) => b.id),
        ['git/gitAgent:secretStore']
    );
    const fetched = getCapabilityBinding({ consumer: 'git/gitAgent', alias: 'secretStore' });
    assert.equal(fetched.provider, 'dpu/dpuAgent');
    removeCapabilityBinding({ consumer: 'git/gitAgent', alias: 'secretStore' });
    assert.equal(getCapabilityBinding({ consumer: 'git/gitAgent', alias: 'secretStore' }), null);
});

test('resolveAliasForConsumer enforces scope intersection', () => {
    setCapabilityBinding({
        consumer: 'git/gitAgent',
        alias: 'secretStore',
        provider: 'dpu/dpuAgent',
        contract: 'secret-store/v1',
        approvedScopes: ['secret:read']
    });
    const resolved = resolveAliasForConsumer({
        consumerAgentRef: 'git/gitAgent',
        alias: 'secretStore',
        requestedScopes: ['secret:read', 'secret:write']
    });
    assert.deepEqual(resolved.grantedScopes, ['secret:read']);
    assert.deepEqual(resolved.deniedScopes, ['secret:write']);

    assert.throws(() => resolveAliasForConsumer({
        consumerAgentRef: 'git/gitAgent',
        alias: 'nonexistent',
        requestedScopes: []
    }), /no requires/);
});

test('resolveBindingsForConsumer returns launcher-facing binding metadata', () => {
    const resolved = resolveBindingsForConsumer('git/gitAgent');
    assert.deepEqual(resolved.secretStore, {
        id: 'git/gitAgent:secretStore',
        consumer: 'git/gitAgent',
        provider: 'dpu/dpuAgent',
        providerPrincipal: 'agent:dpu/dpuAgent',
        providerRouteName: 'dpuAgent',
        contract: 'secret-store/v1',
        approvedScopes: ['secret:read'],
        maxScopes: ['secret:read'],
        grantedScopes: ['secret:read'],
        deniedScopes: []
    });
});

test('resolveBindingsForProvider returns provider-facing binding metadata', () => {
    const resolved = resolveBindingsForProvider('dpu/dpuAgent');
    assert.deepEqual(resolved['git/gitAgent:secretStore'], {
        id: 'git/gitAgent:secretStore',
        consumer: 'git/gitAgent',
        consumerPrincipal: 'agent:git/gitAgent',
        alias: 'secretStore',
        provider: 'dpu/dpuAgent',
        providerPrincipal: 'agent:dpu/dpuAgent',
        providerRouteName: 'dpuAgent',
        contract: 'secret-store/v1',
        approvedScopes: ['secret:read']
    });
});

test('registerAgentPublicKey persists in workspace config', () => {
    registerAgentPublicKey('agent:git/gitAgent', {
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
        fingerprint: 'fp-123'
    });
    const entry = getRegisteredAgentPublicKey('agent:git/gitAgent');
    assert.equal(entry.fingerprint, 'fp-123');
    assert.equal(entry.publicKeyJwk.x, 'abc');
});

test('canonicalJsonHash is stable across key order', () => {
    const a = canonicalJsonHash({ tool: 'secret_get', input: { key: 'A', ttl: 60 } });
    const b = canonicalJsonHash({ input: { ttl: 60, key: 'A' }, tool: 'secret_get' });
    assert.equal(a, b);
});
