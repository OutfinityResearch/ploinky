import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-mkey-'));
const originalCwd = process.cwd();
process.chdir(tempDir);

const moduleSuffix = `?test=${Date.now()}`;
const { resolveMasterKey, MASTER_KEY_VAR } = await import(`../../cli/services/masterKey.js${moduleSuffix}`);

test.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(() => {
    delete process.env[MASTER_KEY_VAR];
});

test('resolveMasterKey throws and logs when env var is unset', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), `${MASTER_KEY_VAR}=${'a'.repeat(64)}\n`);

    const errors = [];
    const originalError = console.error;
    console.error = (msg) => { errors.push(String(msg)); };
    try {
        assert.throws(
            () => resolveMasterKey(),
            /PLOINKY_MASTER_KEY is required.*intentionally not loaded from on-disk/
        );
        assert.ok(
            errors.some((m) => m.includes('[ploinky]') && m.includes(MASTER_KEY_VAR)),
            'expected an error to be logged via console.error'
        );
    } finally {
        console.error = originalError;
        fs.rmSync(path.join(tempDir, '.env'), { force: true });
    }
});

test('resolveMasterKey reads from process.env when set', () => {
    process.env[MASTER_KEY_VAR] = 'b'.repeat(64);
    const key = resolveMasterKey();
    assert.equal(key.length, 32);
    assert.equal(key.toString('hex'), 'b'.repeat(64));
});

test('resolveMasterKey rejects malformed values', () => {
    process.env[MASTER_KEY_VAR] = 'not-hex';
    assert.throws(() => resolveMasterKey(), /must be exactly 64 hex characters/);
});
