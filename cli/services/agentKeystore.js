import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { PLOINKY_DIR } from './config.js';
import { registerAgentPublicKey, unregisterAgentPublicKey } from './capabilityRegistry.js';

/**
 * agentKeystore.js
 *
 * Manages the Ed25519 keypairs that agents use to sign caller-assertions on
 * the secure wire, and the router's own session signing key that it uses to
 * mint invocation_tokens.
 *
 * Layout on disk:
 *
 *   <workspace>/.ploinky/keys/router/session.key         (PKCS8 PEM, router)
 *   <workspace>/.ploinky/keys/router/session.pub         (SPKI PEM, router)
 *   <workspace>/.ploinky/keys/agents/<principal>.key     (PKCS8 PEM, private)
 *   <workspace>/.ploinky/keys/agents/<principal>.pub     (SPKI PEM, public)
 *
 * Public keys are also registered into the workspace registry via
 * registerAgentPublicKey for quick lookup at verify time.
 */

const KEYS_DIR = path.join(PLOINKY_DIR, 'keys');
const AGENT_KEYS_DIR = path.join(KEYS_DIR, 'agents');
const ROUTER_KEYS_DIR = path.join(KEYS_DIR, 'router');
const ROUTER_SESSION_PRIVATE = path.join(ROUTER_KEYS_DIR, 'session.key');
const ROUTER_SESSION_PUBLIC = path.join(ROUTER_KEYS_DIR, 'session.pub');

function ensureDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (_) {}
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
}

function encodePrincipalForFilename(principalId) {
    return encodeURIComponent(String(principalId || '').trim());
}

function legacySanitizePrincipal(principalId) {
    return String(principalId || '').replace(/[^a-zA-Z0-9:_\-]/g, '_');
}

function generateEd25519Keypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKeyJwk: publicKey.export({ format: 'jwk' }),
        fingerprint: fingerprintForPublicKey(publicKey)
    };
}

function fingerprintForPublicKey(publicKey) {
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('base64url');
}

function writePrivate(filePath, pem) {
    fs.writeFileSync(filePath, pem, { mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

function writePublic(filePath, pem) {
    fs.writeFileSync(filePath, pem, { mode: 0o644 });
}

function agentKeyPaths(principalId) {
    const safe = encodePrincipalForFilename(principalId);
    return {
        privatePath: path.join(AGENT_KEYS_DIR, `${safe}.key`),
        publicPath: path.join(AGENT_KEYS_DIR, `${safe}.pub`)
    };
}

function legacyAgentKeyPaths(principalId) {
    const safe = legacySanitizePrincipal(principalId);
    return {
        privatePath: path.join(AGENT_KEYS_DIR, `${safe}.key`),
        publicPath: path.join(AGENT_KEYS_DIR, `${safe}.pub`)
    };
}

function migrateLegacyAgentKeypair(principalId) {
    const current = agentKeyPaths(principalId);
    if (fs.existsSync(current.privatePath) || fs.existsSync(current.publicPath)) {
        return current;
    }

    const legacy = legacyAgentKeyPaths(principalId);
    let migrated = false;
    for (const [fromPath, toPath] of [
        [legacy.privatePath, current.privatePath],
        [legacy.publicPath, current.publicPath]
    ]) {
        if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) {
            continue;
        }
        fs.renameSync(fromPath, toPath);
        migrated = true;
    }

    return migrated ? current : current;
}

function loadKeyObjectFromPem(pem, kind /* 'private' | 'public' */) {
    if (kind === 'private') {
        return crypto.createPrivateKey(pem);
    }
    return crypto.createPublicKey(pem);
}

export function ensureRouterSigningKey() {
    ensureDir(ROUTER_KEYS_DIR);
    if (fs.existsSync(ROUTER_SESSION_PRIVATE) && fs.existsSync(ROUTER_SESSION_PUBLIC)) {
        const privatePem = fs.readFileSync(ROUTER_SESSION_PRIVATE, 'utf8');
        const publicPem = fs.readFileSync(ROUTER_SESSION_PUBLIC, 'utf8');
        const publicKey = crypto.createPublicKey(publicPem);
        return {
            privatePem,
            publicPem,
            privateKey: crypto.createPrivateKey(privatePem),
            publicKey,
            publicKeyJwk: publicKey.export({ format: 'jwk' }),
            fingerprint: fingerprintForPublicKey(publicKey)
        };
    }
    const { publicKeyPem, privateKeyPem, publicKeyJwk, fingerprint } = generateEd25519Keypair();
    writePrivate(ROUTER_SESSION_PRIVATE, privateKeyPem);
    writePublic(ROUTER_SESSION_PUBLIC, publicKeyPem);
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return {
        privatePem: privateKeyPem,
        publicPem: publicKeyPem,
        privateKey: crypto.createPrivateKey(privateKeyPem),
        publicKey,
        publicKeyJwk,
        fingerprint
    };
}

export function getRouterPublicKey() {
    ensureRouterSigningKey();
    const publicPem = fs.readFileSync(ROUTER_SESSION_PUBLIC, 'utf8');
    const publicKey = crypto.createPublicKey(publicPem);
    return {
        publicPem,
        publicKey,
        publicKeyJwk: publicKey.export({ format: 'jwk' }),
        fingerprint: fingerprintForPublicKey(publicKey)
    };
}

export function rotateRouterSigningKey() {
    ensureDir(ROUTER_KEYS_DIR);
    const { publicKeyPem, privateKeyPem, publicKeyJwk, fingerprint } = generateEd25519Keypair();
    writePrivate(ROUTER_SESSION_PRIVATE, privateKeyPem);
    writePublic(ROUTER_SESSION_PUBLIC, publicKeyPem);
    return { fingerprint, publicKeyJwk };
}

export function ensureAgentKeypair(principalId) {
    const clean = String(principalId || '').trim();
    if (!clean) throw new Error('ensureAgentKeypair: principalId required');
    ensureDir(AGENT_KEYS_DIR);
    const { privatePath, publicPath } = migrateLegacyAgentKeypair(clean);
    if (fs.existsSync(privatePath) && fs.existsSync(publicPath)) {
        const publicPem = fs.readFileSync(publicPath, 'utf8');
        const publicKey = crypto.createPublicKey(publicPem);
        const publicKeyJwk = publicKey.export({ format: 'jwk' });
        const fingerprint = fingerprintForPublicKey(publicKey);
        registerAgentPublicKey(clean, { publicKeyJwk, fingerprint });
        return {
            principalId: clean,
            privatePath,
            publicPath,
            publicKeyJwk,
            fingerprint,
            created: false
        };
    }
    const generated = generateEd25519Keypair();
    writePrivate(privatePath, generated.privateKeyPem);
    writePublic(publicPath, generated.publicKeyPem);
    registerAgentPublicKey(clean, {
        publicKeyJwk: generated.publicKeyJwk,
        fingerprint: generated.fingerprint
    });
    return {
        principalId: clean,
        privatePath,
        publicPath,
        publicKeyJwk: generated.publicKeyJwk,
        fingerprint: generated.fingerprint,
        created: true
    };
}

export function rotateAgentKeypair(principalId) {
    const clean = String(principalId || '').trim();
    if (!clean) throw new Error('rotateAgentKeypair: principalId required');
    ensureDir(AGENT_KEYS_DIR);
    migrateLegacyAgentKeypair(clean);
    const { privatePath, publicPath } = agentKeyPaths(clean);
    const generated = generateEd25519Keypair();
    writePrivate(privatePath, generated.privateKeyPem);
    writePublic(publicPath, generated.publicKeyPem);
    registerAgentPublicKey(clean, {
        publicKeyJwk: generated.publicKeyJwk,
        fingerprint: generated.fingerprint
    });
    return {
        principalId: clean,
        fingerprint: generated.fingerprint,
        publicKeyJwk: generated.publicKeyJwk
    };
}

export function removeAgentKeypair(principalId) {
    const clean = String(principalId || '').trim();
    if (!clean) return false;
    const { privatePath, publicPath } = agentKeyPaths(clean);
    const legacy = legacyAgentKeyPaths(clean);
    let removed = false;
    for (const p of [privatePath, publicPath, legacy.privatePath, legacy.publicPath]) {
        try {
            if (fs.existsSync(p)) { fs.unlinkSync(p); removed = true; }
        } catch (_) {}
    }
    unregisterAgentPublicKey(clean);
    return removed;
}

export function loadAgentPrivateKey(principalId) {
    const { privatePath } = migrateLegacyAgentKeypair(principalId);
    if (!fs.existsSync(privatePath)) {
        throw new Error(`agentKeystore: no private key on disk for ${principalId}`);
    }
    const pem = fs.readFileSync(privatePath, 'utf8');
    return { privatePem: pem, privateKey: crypto.createPrivateKey(pem) };
}

export function loadAgentPublicKey(principalId) {
    const { publicPath } = migrateLegacyAgentKeypair(principalId);
    if (!fs.existsSync(publicPath)) {
        return null;
    }
    const pem = fs.readFileSync(publicPath, 'utf8');
    const publicKey = crypto.createPublicKey(pem);
    return {
        publicPem: pem,
        publicKey,
        publicKeyJwk: publicKey.export({ format: 'jwk' }),
        fingerprint: fingerprintForPublicKey(publicKey)
    };
}

export function publicKeyFromJwk(jwk) {
    if (!jwk || typeof jwk !== 'object') {
        throw new Error('publicKeyFromJwk: jwk required');
    }
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

export function listAgentKeypairs() {
    if (!fs.existsSync(AGENT_KEYS_DIR)) return [];
    const out = [];
    const entries = fs.readdirSync(AGENT_KEYS_DIR);
    const principals = new Set();
    for (const entry of entries) {
        if (entry.endsWith('.pub')) principals.add(entry.slice(0, -4));
        else if (entry.endsWith('.key')) principals.add(entry.slice(0, -4));
    }
    for (const p of principals) {
        const publicPath = path.join(AGENT_KEYS_DIR, `${p}.pub`);
        if (!fs.existsSync(publicPath)) continue;
        try {
            const pem = fs.readFileSync(publicPath, 'utf8');
            const publicKey = crypto.createPublicKey(pem);
            out.push({
                principalId: decodeURIComponent(p),
                fingerprint: fingerprintForPublicKey(publicKey),
                publicPath
            });
        } catch (_) {}
    }
    return out;
}

export const __internal = {
    agentKeyPaths,
    loadKeyObjectFromPem
};
