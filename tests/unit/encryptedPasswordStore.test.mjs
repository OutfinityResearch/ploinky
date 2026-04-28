import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const ENV_KEY = '1'.repeat(64);
const FILE_KEY = '2'.repeat(64);

test('encrypted password store round-trips and enforces the master key', async (t) => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'ploinky-password-store-'));
    const previousCwd = process.cwd();
    const previousMasterKey = process.env.PLOINKY_MASTER_KEY;
    process.chdir(workspace);
    writeFileSync(path.join(workspace, '.env'), `PLOINKY_MASTER_KEY=${FILE_KEY}\n`);
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

    const store = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/encryptedPasswordStore.js')).href}?test=${Date.now()}`);
    store.setUsersPayload('PLOINKY_AUTH_ALPHA_USERS', {
        version: 1,
        users: [
            {
                id: 'local:alice',
                username: 'alice',
                name: 'Alice',
                email: 'alice@example.com',
                passwordHash: 'scrypt$secret-hash',
                roles: ['local'],
                rev: 3,
            },
        ],
    });

    const payload = store.getUsersPayload('PLOINKY_AUTH_ALPHA_USERS');
    assert.equal(payload.version, 1);
    assert.equal(payload.users[0].username, 'alice');
    assert.equal(payload.users[0].rev, 3);

    const encryptedText = readFileSync(store.PASSWORD_STORE_FILE, 'utf8');
    assert.match(encryptedText, /"alg": "aes-256-gcm"/);
    assert.doesNotMatch(encryptedText, /alice|alice@example\.com|scrypt\$secret-hash|PLOINKY_AUTH_ALPHA_USERS/);

    delete process.env.PLOINKY_MASTER_KEY;
    assert.throws(
        () => store.getUsersPayload('PLOINKY_AUTH_ALPHA_USERS'),
        /Unable to decrypt encrypted password store/,
        '.env uses a different key, so process env must have taken precedence while writing',
    );

    writeFileSync(path.join(workspace, '.env'), `PLOINKY_MASTER_KEY=${ENV_KEY}\n`);
    assert.equal(store.getUsersPayload('PLOINKY_AUTH_ALPHA_USERS').users[0].username, 'alice');

    writeFileSync(path.join(workspace, '.env'), '');
    assert.throws(
        () => store.getUsersPayload('PLOINKY_AUTH_ALPHA_USERS'),
        /PLOINKY_MASTER_KEY is required/,
    );

    process.env.PLOINKY_MASTER_KEY = 'abc';
    assert.throws(
        () => store.getUsersPayload('PLOINKY_AUTH_ALPHA_USERS'),
        /PLOINKY_MASTER_KEY must be exactly 64 hex characters/,
    );
});
