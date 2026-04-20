import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-sso-'));
const providerDir = path.join(tempDir, '.ploinky', 'repos', 'fake', 'fakeProvider');

fs.mkdirSync(path.join(providerDir, 'runtime'), { recursive: true });
fs.writeFileSync(
    path.join(providerDir, 'manifest.json'),
    JSON.stringify({
        provides: {
            'auth-provider/v1': {
                operations: ['sso_begin_login'],
                supportedScopes: ['auth:login']
            }
        }
    }, null, 2)
);
fs.writeFileSync(path.join(providerDir, 'runtime', 'index.mjs'), 'export function createProvider() { return {}; }');

process.chdir(tempDir);

const moduleSuffix = `?test=${Date.now()}`;
const ssoModule = await import(`../../cli/services/sso.js${moduleSuffix}`);
const {
    bindSsoProvider,
    unbindSsoProvider,
    getSsoBinding,
    getSsoConfig,
    listAuthProviders,
    gatherSsoStatus
} = ssoModule;

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('sso service binds and unbinds auth-provider agents generically', () => {
    const providers = listAuthProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].agentRef, 'fake/fakeProvider');

    const binding = bindSsoProvider('fake/fakeProvider', {
        providerConfig: { issuerBaseUrl: 'https://fake.test' }
    });
    assert.equal(binding.provider, 'fake/fakeProvider');

    const savedBinding = getSsoBinding();
    assert.equal(savedBinding?.provider, 'fake/fakeProvider');

    const config = getSsoConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.providerAgent, 'fake/fakeProvider');
    assert.equal(config.providerConfig.issuerBaseUrl, 'https://fake.test');

    const status = gatherSsoStatus();
    assert.equal(status.config.enabled, true);
    assert.equal(status.config.providerAgent, 'fake/fakeProvider');

    unbindSsoProvider();
    assert.equal(getSsoBinding(), null);
    assert.equal(getSsoConfig().enabled, false);
});
