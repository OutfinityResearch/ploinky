import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const ENV_KEY = '3'.repeat(64);
const FILE_KEY = '4'.repeat(64);

test('encrypted .secrets migrates plaintext, round-trips, and enforces the master key', async (t) => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'ploinky-secrets-file-'));
    const ploinkyDir = path.join(workspace, '.ploinky');
    mkdirSync(ploinkyDir, { recursive: true });
    writeFileSync(path.join(ploinkyDir, '.secrets'), [
        '# plaintext legacy file',
        'WEBDASHBOARD_TOKEN=legacy-token',
        'ONLYOFFICE_JWT_SECRET=legacy-office-secret',
        '',
    ].join('\n'));
    writeFileSync(path.join(workspace, '.env'), `PLOINKY_MASTER_KEY=${FILE_KEY}\n`);

    const previousCwd = process.cwd();
    const previousMasterKey = process.env.PLOINKY_MASTER_KEY;
    process.chdir(workspace);
    process.env.PLOINKY_MASTER_KEY = ENV_KEY;
    t.after(() => {
        process.chdir(previousCwd);
        if (previousMasterKey === undefined) {
            delete process.env.PLOINKY_MASTER_KEY;
        } else {
            process.env.PLOINKY_MASTER_KEY = previousMasterKey;
        }
        rmSync(workspace, { recursive: true, force: true });
    });

    const nonce = Date.now();
    const store = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/encryptedSecretsFile.js')).href}?test=${nonce}`);

    assert.deepEqual(store.readSecretsFile(), {
        WEBDASHBOARD_TOKEN: 'legacy-token',
        ONLYOFFICE_JWT_SECRET: 'legacy-office-secret',
    });

    let encryptedText = readFileSync(path.join(ploinkyDir, '.secrets'), 'utf8');
    assert.match(encryptedText, /"alg": "aes-256-gcm"/);
    assert.doesNotMatch(encryptedText, /legacy-token|legacy-office-secret|WEBDASHBOARD_TOKEN|ONLYOFFICE_JWT_SECRET/);

    store.setSecretValue('DPU_MASTER_KEY', 'dpu-secret');
    assert.equal(store.readSecretsFile().DPU_MASTER_KEY, 'dpu-secret');
    encryptedText = readFileSync(path.join(ploinkyDir, '.secrets'), 'utf8');
    assert.doesNotMatch(encryptedText, /dpu-secret|DPU_MASTER_KEY/);

    store.deleteSecretValue('WEBDASHBOARD_TOKEN');
    assert.equal(store.readSecretsFile().WEBDASHBOARD_TOKEN, undefined);

    delete process.env.PLOINKY_MASTER_KEY;
    assert.throws(
        () => store.readSecretsFile(),
        /Unable to decrypt .ploinky\/.secrets/,
        '.env uses a different key, so process env must have taken precedence while writing',
    );

    writeFileSync(path.join(workspace, '.env'), `PLOINKY_MASTER_KEY=${ENV_KEY}\n`);
    assert.equal(store.readSecretsFile().DPU_MASTER_KEY, 'dpu-secret');

    writeFileSync(path.join(workspace, '.env'), '');
    assert.throws(
        () => store.readSecretsFile(),
        /PLOINKY_MASTER_KEY is required/,
    );

    process.env.PLOINKY_MASTER_KEY = 'abc';
    assert.throws(
        () => store.readSecretsFile(),
        /PLOINKY_MASTER_KEY must be exactly 64 hex characters/,
    );
});
