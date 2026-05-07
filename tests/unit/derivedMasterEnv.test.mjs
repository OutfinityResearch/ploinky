import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const originalMasterKey = process.env.PLOINKY_MASTER_KEY;
const originalDerivedTestSecret = process.env.DERIVED_MASTER_TEST_SECRET;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-derived-env-'));
process.chdir(tempDir);
process.env.PLOINKY_MASTER_KEY = '7'.repeat(64);
process.env.DERIVED_MASTER_TEST_SECRET = 'operator-value';

const moduleSuffix = `?test=${Date.now()}`;
const { buildEnvMap } = await import(`../../cli/services/secretVars.js${moduleSuffix}`);
const { deriveAgentSecret } = await import(`../../cli/services/masterKey.js${moduleSuffix}`);

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalMasterKey === undefined) {
        delete process.env.PLOINKY_MASTER_KEY;
    } else {
        process.env.PLOINKY_MASTER_KEY = originalMasterKey;
    }
    if (originalDerivedTestSecret === undefined) {
        delete process.env.DERIVED_MASTER_TEST_SECRET;
    } else {
        process.env.DERIVED_MASTER_TEST_SECRET = originalDerivedTestSecret;
    }
});

test('buildEnvMap derives derived-master env entries from the derived master key', () => {
    const manifest = {
        env: [
            {
                name: 'DERIVED_MASTER_TEST_SECRET',
                derive: 'derived-master',
            },
        ],
    };
    const env = buildEnvMap(manifest, null, {
        repoName: 'repo-one',
        agentName: 'agent-one',
    });
    assert.equal(env.DERIVED_MASTER_TEST_SECRET, deriveAgentSecret({
        repoName: 'repo-one',
        agentName: 'agent-one',
        name: 'DERIVED_MASTER_TEST_SECRET',
    }));
    assert.notEqual(env.DERIVED_MASTER_TEST_SECRET, 'operator-value');
});

test('buildEnvMap can share a derived-master identity across agents', () => {
    const manifest = {
        env: [
            {
                name: 'SHARED_SECRET',
                derive: 'derived-master',
                deriveRepoName: 'logical-repo',
                deriveAgentName: 'logical-agent',
                deriveName: 'shared-secret',
            },
        ],
    };
    const first = buildEnvMap(manifest, null, {
        repoName: 'repo-one',
        agentName: 'agent-one',
    });
    const second = buildEnvMap(manifest, null, {
        repoName: 'repo-two',
        agentName: 'agent-two',
    });
    assert.equal(first.SHARED_SECRET, second.SHARED_SECRET);
    assert.equal(first.SHARED_SECRET, deriveAgentSecret({
        repoName: 'logical-repo',
        agentName: 'logical-agent',
        name: 'shared-secret',
    }));
});
