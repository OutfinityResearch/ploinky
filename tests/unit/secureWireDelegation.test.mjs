import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-wire-delegation-'));

function writeManifest(repoName, agentName, manifest) {
    const agentDir = path.join(tempDir, '.ploinky', 'repos', repoName, agentName);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

process.chdir(tempDir);

writeManifest('dpu', 'dpuAgent', {
    identity: { principalId: 'agent:dpuAgent', agentName: 'dpuAgent' },
    provides: {
        'secret-store/v1': {
            operations: ['secret_get', 'secret_put', 'secret_delete', 'secret_grant', 'secret_revoke', 'secret_list'],
            supportedScopes: ['secret:read', 'secret:write', 'secret:grant', 'secret:revoke']
        }
    }
});
writeManifest('git', 'gitAgent', {
    identity: { principalId: 'agent:gitAgent', agentName: 'gitAgent' },
    requires: {
        secretStore: { contract: 'secret-store/v1', maxScopes: ['secret:read'] }
    }
});

const moduleSuffix = `?test=${Date.now()}`;
const { signCallerAssertion } = await import(`../../Agent/lib/wireSign.mjs${moduleSuffix}`);
const registryModule = await import(`../../cli/services/capabilityRegistry.js${moduleSuffix}`);
const secureWireModule = await import(`../../cli/server/mcp-proxy/secureWire.js${moduleSuffix}`);

const { setCapabilityBinding, registerAgentPublicKey } = registryModule;
const { issueUserContextToken, buildDelegatedInvocation } = secureWireModule;

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('delegated invocation forwards the router-issued user-context token for nested calls', () => {
    const caller = crypto.generateKeyPairSync('ed25519');
    registerAgentPublicKey('agent:gitAgent', {
        publicKeyJwk: caller.publicKey.export({ format: 'jwk' }),
        fingerprint: 'git-agent-test'
    });
    setCapabilityBinding({
        consumer: 'git/gitAgent',
        alias: 'secretStore',
        provider: 'dpu/dpuAgent',
        contract: 'secret-store/v1',
        approvedScopes: ['secret:read']
    });

    const userContextToken = issueUserContextToken({
        user: {
            id: 'user-1',
            username: 'alice',
            email: 'alice@example.com',
            roles: ['developer']
        },
        sessionId: 'session-1'
    });

    const bodyObject = { tool: 'secret_get', arguments: { key: 'GIT_GITHUB_TOKEN' } };
    const { token: callerAssertion } = signCallerAssertion({
        callerPrincipal: 'agent:gitAgent',
        bindingId: 'git/gitAgent:secretStore',
        alias: 'secretStore',
        tool: 'secret_get',
        scope: ['secret:read'],
        bodyObject,
        privatePem: caller.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        userContextToken
    });

    const delegated = buildDelegatedInvocation({
        callerAssertionToken: callerAssertion,
        bodyObject,
        providerAgentRef: 'dpu/dpuAgent',
        tool: 'secret_get'
    });

    assert.equal(delegated.payload.sub, 'agent:gitAgent');
    assert.equal(delegated.payload.user.id, 'user-1');
    assert.equal(delegated.payload.user.email, 'alice@example.com');
    assert.equal(delegated.payload.user_context_token, userContextToken);
    assert.deepEqual(delegated.payload.scope, ['secret:read']);
  });
