import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { SECRETS_FILE } from './config.js';
import { parseKeyValueText, resolveMasterKey } from './masterKey.js';

const ENVELOPE_VERSION = 1;
const PAYLOAD_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function normalizeSecretsMap(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const normalized = {};
    for (const [name, value] of Object.entries(source)) {
        const key = String(name || '').trim();
        if (!key) continue;
        normalized[key] = String(value ?? '');
    }
    return normalized;
}

function isEncryptedSecretsEnvelope(value = null) {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.alg === ALGORITHM
        && value.ciphertext
        && value.iv
        && value.tag
    );
}

function parseEnvelope(raw = '') {
    try {
        const parsed = JSON.parse(String(raw || ''));
        return isEncryptedSecretsEnvelope(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function decryptEnvelope(envelope) {
    if (!isEncryptedSecretsEnvelope(envelope)) {
        throw new Error('Encrypted .secrets envelope is malformed.');
    }
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== IV_BYTES || tag.length !== 16 || !ciphertext.length) {
        throw new Error('Encrypted .secrets envelope is incomplete.');
    }
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        resolveMasterKey({ purpose: 'encrypted .secrets' }),
        iv,
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext);
    return normalizeSecretsMap(payload?.secrets);
}

function encryptSecretsMap(secrets = {}) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(
        ALGORITHM,
        resolveMasterKey({ purpose: 'encrypted .secrets' }),
        iv,
    );
    const plaintext = Buffer.from(JSON.stringify({
        version: PAYLOAD_VERSION,
        secrets: normalizeSecretsMap(secrets),
    }), 'utf8');
    const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
    ]);
    return {
        version: ENVELOPE_VERSION,
        alg: ALGORITHM,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}

function writeSecretsFile(secrets = {}) {
    fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
    const envelope = encryptSecretsMap(secrets);
    const tempPath = `${SECRETS_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, SECRETS_FILE);
    try {
        fs.chmodSync(SECRETS_FILE, 0o600);
    } catch (_) { }
}

function readSecretsFile() {
    if (!fs.existsSync(SECRETS_FILE)) {
        return {};
    }
    const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
    if (!raw.trim()) {
        writeSecretsFile({});
        return {};
    }
    const envelope = parseEnvelope(raw);
    if (envelope) {
        try {
            return decryptEnvelope(envelope);
        } catch (error) {
            throw new Error(`Unable to decrypt .ploinky/.secrets: ${error?.message || String(error)}`);
        }
    }
    const secrets = parseKeyValueText(raw);
    writeSecretsFile(secrets);
    return secrets;
}

function setSecretValue(name, value) {
    const key = String(name || '').trim();
    if (!key) {
        throw new Error('Missing variable name.');
    }
    const secrets = readSecretsFile();
    secrets[key] = String(value ?? '');
    writeSecretsFile(secrets);
}

function deleteSecretValue(name) {
    const key = String(name || '').trim();
    if (!key || !fs.existsSync(SECRETS_FILE)) return;
    const secrets = readSecretsFile();
    if (!Object.prototype.hasOwnProperty.call(secrets, key)) return;
    delete secrets[key];
    writeSecretsFile(secrets);
}

function ensureEncryptedSecretsFile() {
    if (!fs.existsSync(SECRETS_FILE)) {
        writeSecretsFile({});
        return;
    }
    readSecretsFile();
}

export {
    ALGORITHM,
    deleteSecretValue,
    ensureEncryptedSecretsFile,
    isEncryptedSecretsEnvelope,
    readSecretsFile,
    setSecretValue,
    writeSecretsFile,
};
