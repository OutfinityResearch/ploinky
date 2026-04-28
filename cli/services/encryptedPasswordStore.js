import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { PLOINKY_DIR } from './config.js';
import { MASTER_KEY_VAR, resolveMasterKey as resolveConfiguredMasterKey } from './masterKey.js';

const PASSWORD_STORE_FILE = path.join(PLOINKY_DIR, 'passwords.enc');
const STORE_VERSION = 1;
const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function defaultStore() {
    return {
        version: STORE_VERSION,
        usersByVar: {},
    };
}

function resolveMasterKey() {
    return resolveConfiguredMasterKey({ purpose: 'local password storage' });
}

function normalizeStore(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const usersByVar = source.usersByVar && typeof source.usersByVar === 'object' && !Array.isArray(source.usersByVar)
        ? source.usersByVar
        : {};
    const normalized = defaultStore();
    for (const [usersVar, payload] of Object.entries(usersByVar)) {
        const key = String(usersVar || '').trim();
        if (!key) continue;
        const users = Array.isArray(payload?.users) ? payload.users : [];
        normalized.usersByVar[key] = {
            version: Number(payload?.version) || 1,
            users,
        };
    }
    return normalized;
}

function decryptEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new Error('Encrypted password store is malformed.');
    }
    if (envelope.alg !== ALGORITHM) {
        throw new Error(`Encrypted password store uses unsupported algorithm '${envelope.alg || ''}'.`);
    }
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== IV_BYTES || tag.length !== 16 || !ciphertext.length) {
        throw new Error('Encrypted password store envelope is incomplete.');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, resolveMasterKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
}

function encryptStore(store) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, resolveMasterKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(normalizeStore(store)), 'utf8');
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

function readPasswordStore() {
    if (!fs.existsSync(PASSWORD_STORE_FILE)) {
        return defaultStore();
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(PASSWORD_STORE_FILE, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read encrypted password store: ${error?.message || String(error)}`);
    }
    try {
        return normalizeStore(decryptEnvelope(parsed));
    } catch (error) {
        throw new Error(`Unable to decrypt encrypted password store: ${error?.message || String(error)}`);
    }
}

function writePasswordStore(store) {
    const envelope = encryptStore(store);
    fs.mkdirSync(path.dirname(PASSWORD_STORE_FILE), { recursive: true });
    const tempPath = `${PASSWORD_STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, PASSWORD_STORE_FILE);
    try {
        fs.chmodSync(PASSWORD_STORE_FILE, 0o600);
    } catch (_) { }
}

function getUsersPayload(usersVar) {
    const key = String(usersVar || '').trim();
    if (!key) return { version: 1, users: [] };
    resolveMasterKey();
    const store = readPasswordStore();
    const payload = store.usersByVar[key];
    return {
        version: Number(payload?.version) || 1,
        users: Array.isArray(payload?.users) ? payload.users : [],
    };
}

function setUsersPayload(usersVar, payload = {}) {
    const key = String(usersVar || '').trim();
    if (!key) {
        throw new Error('setUsersPayload requires usersVar.');
    }
    const store = readPasswordStore();
    store.usersByVar[key] = {
        version: Number(payload?.version) || 1,
        users: Array.isArray(payload?.users) ? payload.users : [],
    };
    writePasswordStore(store);
    return store.usersByVar[key];
}

function deleteUsersPayload(usersVar) {
    const key = String(usersVar || '').trim();
    if (!key) return false;
    const store = readPasswordStore();
    if (!Object.prototype.hasOwnProperty.call(store.usersByVar, key)) {
        return false;
    }
    delete store.usersByVar[key];
    writePasswordStore(store);
    return true;
}

export {
    MASTER_KEY_VAR,
    PASSWORD_STORE_FILE,
    deleteUsersPayload,
    getUsersPayload,
    readPasswordStore,
    resolveMasterKey,
    setUsersPayload,
    writePasswordStore,
};
