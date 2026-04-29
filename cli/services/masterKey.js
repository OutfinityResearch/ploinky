import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MASTER_KEY_VAR = 'PLOINKY_MASTER_KEY';

function parseKeyValueText(raw = '') {
    const result = {};
    const lines = String(raw || '').split(/\r?\n/);
    for (const line of lines) {
        let trimmed = String(line || '').trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (trimmed.startsWith('export ')) {
            trimmed = trimmed.slice('export '.length).trim();
        }
        const eqIndex = trimmed.indexOf('=');
        let key = '';
        let value = '';
        if (eqIndex >= 0) {
            key = trimmed.slice(0, eqIndex).trim();
            value = trimmed.slice(eqIndex + 1).trim();
        } else {
            const spaceMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/);
            if (!spaceMatch) {
                continue;
            }
            key = spaceMatch[1];
            value = spaceMatch[2].trim();
        }
        if ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key) {
            result[key] = value;
        }
    }
    return result;
}

function parseKeyValueFile(filePath) {
    try {
        return parseKeyValueText(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function findEnvFile(startDir = process.cwd()) {
    let current = path.resolve(startDir);
    const { root } = path.parse(current);
    while (true) {
        const candidate = path.join(current, '.env');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        if (current === root) {
            return null;
        }
        current = path.dirname(current);
    }
}

function loadEnvFile(startDir = process.cwd()) {
    const envPath = findEnvFile(startDir);
    return envPath ? parseKeyValueFile(envPath) : {};
}

function resolveMasterKey({ purpose = 'Ploinky encrypted storage' } = {}) {
    let raw = String(process.env[MASTER_KEY_VAR] || '').trim();
    if (!raw) {
        // Walk up from cwd looking for a .env that defines the master key.
        // Operators frequently keep a single .env in a parent directory that
        // shadows multiple workspaces, so this matches that workflow.
        raw = String(loadEnvFile()[MASTER_KEY_VAR] || '').trim();
    }
    if (!raw) {
        const message = `${MASTER_KEY_VAR} is required for ${purpose}. Set it in the process environment or define it in a .env walked upward from the current directory.`;
        console.error(`[ploinky] ${message}`);
        throw new Error(message);
    }
    // Backward compatible: a 64-hex-char value is still consumed as raw 32 key bytes
    // so existing encrypted stores keep decrypting. Anything else is treated as a
    // seed string and hashed to 32 bytes via SHA-256.
    if (/^[a-fA-F0-9]{64}$/.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

// HKDF-SHA256 subkey derivation. Every per-purpose secret in Ploinky must be
// derived from the master key via this function rather than using master bytes
// directly. Domain separation is carried in the `info` parameter so that
// rotating one purpose (by bumping its version segment) cannot collide with
// another. Empty salt is fine because the master key is already a
// uniformly-random 32-byte value (or the SHA-256 digest of an operator seed).
function deriveSubkey(purpose, length = 32) {
    const trimmedPurpose = String(purpose || '').trim();
    if (!trimmedPurpose) {
        throw new Error('deriveSubkey: purpose is required');
    }
    const ikm = resolveMasterKey({ purpose: `subkey:${trimmedPurpose}` });
    const salt = Buffer.alloc(0);
    const info = Buffer.from(`ploinky/${trimmedPurpose}/v1`, 'utf8');
    return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

export {
    deriveSubkey,
    findEnvFile,
    loadEnvFile,
    MASTER_KEY_VAR,
    parseKeyValueFile,
    parseKeyValueText,
    resolveMasterKey,
};
