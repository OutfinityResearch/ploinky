import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-mkey-'));
const originalCwd = process.cwd();
process.chdir(tempDir);

const moduleSuffix = `?test=${Date.now()}`;
const { deriveSubkey, resolveMasterKey, MASTER_KEY_VAR } = await import(`../../cli/services/masterKey.js${moduleSuffix}`);

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(() => {
    delete process.env[MASTER_KEY_VAR];
});

test('resolveMasterKey throws and logs when neither process.env nor .env defines the key', () => {
    const errors = [];
    const originalError = console.error;
    console.error = (msg) => { errors.push(String(msg)); };
    try {
        assert.throws(
            () => resolveMasterKey(),
            /PLOINKY_MASTER_KEY is required.*\.env walked upward/
        );
        assert.ok(
            errors.some((m) => m.includes('[ploinky]') && m.includes(MASTER_KEY_VAR)),
            'expected an error to be logged via console.error'
        );
    } finally {
        console.error = originalError;
    }
});

test('resolveMasterKey falls back to a .env walked up from the current directory', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), `${MASTER_KEY_VAR}=${'a'.repeat(64)}\n`);
    try {
        const key = resolveMasterKey();
        assert.equal(key.length, 32);
        assert.equal(key.toString('hex'), 'a'.repeat(64));
    } finally {
        fs.rmSync(path.join(tempDir, '.env'), { force: true });
    }
});

test('process.env value takes precedence over .env value when both define the key', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), `${MASTER_KEY_VAR}=${'a'.repeat(64)}\n`);
    process.env[MASTER_KEY_VAR] = 'b'.repeat(64);
    try {
        assert.equal(resolveMasterKey().toString('hex'), 'b'.repeat(64));
    } finally {
        fs.rmSync(path.join(tempDir, '.env'), { force: true });
    }
});

test('resolveMasterKey reads 64-hex values as raw key bytes', () => {
    process.env[MASTER_KEY_VAR] = 'b'.repeat(64);
    const key = resolveMasterKey();
    assert.equal(key.length, 32);
    assert.equal(key.toString('hex'), 'b'.repeat(64));
});

test('resolveMasterKey accepts arbitrary strings as seeds and derives via SHA-256', () => {
    process.env[MASTER_KEY_VAR] = 'an-operator-passphrase';
    const key = resolveMasterKey();
    assert.equal(key.length, 32);
    // Deterministic: same seed always produces the same key
    process.env[MASTER_KEY_VAR] = 'an-operator-passphrase';
    assert.deepEqual(resolveMasterKey(), key);
});

test('deriveSubkey produces distinct, deterministic 32-byte subkeys per purpose', () => {
    process.env[MASTER_KEY_VAR] = 'c'.repeat(64);
    const invocation = deriveSubkey('invocation');
    const session = deriveSubkey('session');
    const storageSecrets = deriveSubkey('storage/secrets');
    const storagePasswords = deriveSubkey('storage/passwords');
    assert.equal(invocation.length, 32);
    // Each purpose yields a distinct subkey (domain separation via HKDF info)
    assert.notDeepEqual(invocation, session);
    assert.notDeepEqual(invocation, storageSecrets);
    assert.notDeepEqual(storageSecrets, storagePasswords);
    // None of them equals the master key itself
    assert.notDeepEqual(invocation, resolveMasterKey());
    // Deterministic per (master, purpose) pair
    assert.deepEqual(deriveSubkey('invocation'), invocation);
});
