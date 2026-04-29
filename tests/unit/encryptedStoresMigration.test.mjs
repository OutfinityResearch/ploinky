// Verifies the read-fallback auto-migration: workspaces created with the
// pre-derivation code encrypted .secrets and passwords.enc with the raw master
// key. After upgrading, those files must keep decrypting on read, and the next
// write must re-encrypt them with the per-purpose derived subkeys.
//
// config.js locks WORKSPACE_ROOT at first import from process.cwd(), so the
// chdir + env setup happens before any module under test is imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const MASTER_HEX = '7'.repeat(64);

const workspace = mkdtempSync(path.join(os.tmpdir(), 'ploinky-migration-'));
const ploinkyDir = path.join(workspace, '.ploinky');
mkdirSync(ploinkyDir, { recursive: true });
const previousCwd = process.cwd();
const previousMasterKey = process.env.PLOINKY_MASTER_KEY;
process.chdir(workspace);
process.env.PLOINKY_MASTER_KEY = MASTER_HEX;

test.after(() => {
    process.chdir(previousCwd);
    if (previousMasterKey === undefined) {
        delete process.env.PLOINKY_MASTER_KEY;
    } else {
        process.env.PLOINKY_MASTER_KEY = previousMasterKey;
    }
    rmSync(workspace, { recursive: true, force: true });
});

function aesGcmEncrypt(key, plaintextBuffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    return {
        version: 1,
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}

function tryDecryptWithRawMaster(envelope) {
    const masterKey = Buffer.from(MASTER_HEX, 'hex');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

test('encrypted .secrets read-falls-back to raw master, then re-encrypts with derived subkey on next write', async () => {
    const legacyPayload = Buffer.from(JSON.stringify({
        version: 1,
        secrets: { LEGACY_TOKEN: 'still-readable' },
    }), 'utf8');
    const legacyEnvelope = aesGcmEncrypt(Buffer.from(MASTER_HEX, 'hex'), legacyPayload);
    writeFileSync(path.join(ploinkyDir, '.secrets'), JSON.stringify(legacyEnvelope, null, 2));

    const nonce = Date.now();
    const store = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/encryptedSecretsFile.js')).href}?test=secrets-${nonce}`);

    assert.deepEqual(store.readSecretsFile(), { LEGACY_TOKEN: 'still-readable' });

    store.setSecretValue('NEW_TOKEN', 'fresh');
    assert.deepEqual(store.readSecretsFile(), {
        LEGACY_TOKEN: 'still-readable',
        NEW_TOKEN: 'fresh',
    });

    const newEnvelope = JSON.parse(readFileSync(path.join(ploinkyDir, '.secrets'), 'utf8'));
    assert.throws(
        () => tryDecryptWithRawMaster(newEnvelope),
        /unable to authenticate data|bad decrypt/i,
        'after migration the file must no longer decrypt with the raw master key',
    );
});

test('passwords.enc read-falls-back to raw master, then re-encrypts with derived subkey on next write', async () => {
    const legacyStorePayload = Buffer.from(JSON.stringify({
        version: 1,
        usersByVar: {
            PLOINKY_AUTH_TEST_USERS: {
                version: 1,
                users: [{
                    id: 'local:legacy',
                    username: 'legacy',
                    name: 'legacy',
                    email: null,
                    passwordHash: 'scrypt$legacy-hash',
                    roles: ['local'],
                    rev: 1,
                }],
            },
        },
    }), 'utf8');
    const legacyEnvelope = aesGcmEncrypt(Buffer.from(MASTER_HEX, 'hex'), legacyStorePayload);
    const passwordPath = path.join(ploinkyDir, 'passwords.enc');
    writeFileSync(passwordPath, `${JSON.stringify(legacyEnvelope, null, 2)}\n`);

    const nonce = Date.now();
    const store = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/encryptedPasswordStore.js')).href}?test=passwords-${nonce}`);

    const payload = store.getUsersPayload('PLOINKY_AUTH_TEST_USERS');
    assert.equal(payload.users[0].username, 'legacy');

    store.setUsersPayload('PLOINKY_AUTH_TEST_USERS', {
        version: 1,
        users: [
            ...payload.users,
            {
                id: 'local:added',
                username: 'added',
                name: 'added',
                email: null,
                passwordHash: 'scrypt$added-hash',
                roles: ['local'],
                rev: 1,
            },
        ],
    });

    const after = store.getUsersPayload('PLOINKY_AUTH_TEST_USERS');
    assert.equal(after.users.length, 2);

    const newEnvelope = JSON.parse(readFileSync(passwordPath, 'utf8'));
    assert.throws(
        () => tryDecryptWithRawMaster(newEnvelope),
        /unable to authenticate data|bad decrypt/i,
        'after migration the file must no longer decrypt with the raw master key',
    );
});
