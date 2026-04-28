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
    const raw = String(process.env[MASTER_KEY_VAR] || loadEnvFile()[MASTER_KEY_VAR] || '').trim();
    if (!raw) {
        throw new Error(`${MASTER_KEY_VAR} is required for ${purpose}.`);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
        throw new Error(`${MASTER_KEY_VAR} must be exactly 64 hex characters.`);
    }
    return Buffer.from(raw, 'hex');
}

export {
    findEnvFile,
    loadEnvFile,
    MASTER_KEY_VAR,
    parseKeyValueFile,
    parseKeyValueText,
    resolveMasterKey,
};
