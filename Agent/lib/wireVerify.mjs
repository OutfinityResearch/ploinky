import crypto from 'node:crypto';
import fs from 'node:fs';

import { canonicalJson, bodyHashForRequest } from './wireSign.mjs';

/**
 * wireVerify.mjs
 *
 * Router invocation verification. Used by both the router (to verify incoming
 * caller assertions) and by provider agents (to verify the router-issued
 * invocation_token before exposing caller context to tools).
 *
 * Properties enforced:
 *   - signature valid against resolved public key
 *   - aud matches expected audience
 *   - iat / exp inside allowed window
 *   - max TTL <= MAX_TTL_SECONDS
 *   - body_hash matches canonical body (if `bodyObject` provided)
 *   - jti not already seen within its lifetime (via injected replay cache)
 *
 * Replay cache is injected so that the same implementation can be used for:
 *   - router-global replay cache (process in-memory Map)
 *   - per-provider cache (file-backed or in-memory)
 */

export const MAX_TTL_SECONDS = 120;
export const DEFAULT_CLOCK_SKEW_SECONDS = 30;

function base64urlDecode(segment) {
    const padding = '==='.slice((segment.length + 3) % 4);
    const base64 = (segment + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
}

function decodeJws(token) {
    if (typeof token !== 'string' || !token) {
        throw new Error('wireVerify: token must be a non-empty string');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('wireVerify: malformed token');
    }
    const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
    const signature = base64urlDecode(parts[2]);
    const signingInput = `${parts[0]}.${parts[1]}`;
    return { header, payload, signature, signingInput };
}

function loadPublicKey({ publicPem, publicKeyJwk, publicKeyPath }) {
    if (publicKeyJwk && typeof publicKeyJwk === 'object') {
        return crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });
    }
    if (publicPem && typeof publicPem === 'string') {
        return crypto.createPublicKey(publicPem);
    }
    if (publicKeyPath) {
        const pem = fs.readFileSync(publicKeyPath, 'utf8');
        return crypto.createPublicKey(pem);
    }
    throw new Error('wireVerify: public key material required');
}

function assertSignatureMatches({ algorithm, signingInput, signature, publicKey }) {
    if (algorithm !== 'EdDSA') {
        throw new Error(`wireVerify: unsupported alg ${algorithm}`);
    }
    const ok = crypto.verify(null, Buffer.from(signingInput, 'utf8'), publicKey, signature);
    if (!ok) {
        throw new Error('wireVerify: signature invalid');
    }
}

function assertTimeValid(payload, { clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS, maxTtlSeconds = MAX_TTL_SECONDS, now }) {
    const nowSec = Math.floor((now ?? Date.now()) / 1000);
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    if (!Number.isFinite(iat) || !Number.isFinite(exp)) {
        throw new Error('wireVerify: iat/exp missing or invalid');
    }
    if (exp - iat > maxTtlSeconds) {
        throw new Error(`wireVerify: token lifetime exceeds max (${exp - iat}s > ${maxTtlSeconds}s)`);
    }
    if (iat > nowSec + clockSkewSeconds) {
        throw new Error('wireVerify: token used before its issued-at time');
    }
    if (exp + clockSkewSeconds < nowSec) {
        throw new Error('wireVerify: token expired');
    }
}

function assertAudience(payload, expectedAudience) {
    if (!expectedAudience) return;
    const aud = payload.aud;
    if (Array.isArray(aud)) {
        if (!aud.includes(expectedAudience)) {
            throw new Error(`wireVerify: audience mismatch (want ${expectedAudience}, got ${aud.join(',')})`);
        }
    } else if (String(aud || '') !== String(expectedAudience)) {
        throw new Error(`wireVerify: audience mismatch (want ${expectedAudience}, got ${aud})`);
    }
}

function assertBodyHash(payload, bodyObject) {
    if (bodyObject === undefined) return;
    const expected = bodyHashForRequest(bodyObject ?? {});
    if (payload.body_hash !== expected) {
        throw new Error('wireVerify: body_hash mismatch');
    }
}

function assertReplayProtected(payload, replayCache) {
    const jti = String(payload?.jti || '').trim();
    if (!jti) {
        throw new Error('wireVerify: jti missing');
    }
    if (!replayCache) return;
    if (typeof replayCache.seen === 'function') {
        if (replayCache.seen(jti)) {
            throw new Error('wireVerify: jti has already been consumed');
        }
        if (typeof replayCache.remember === 'function') {
            const ttlMs = Math.max(1, (Number(payload.exp) * 1000) - Date.now()) + 1000;
            replayCache.remember(jti, ttlMs);
        }
    }
}

/**
 * Low-level: verify a JWS token against a specific public key and expected
 * claims. Used by both the router (to verify caller assertions it is given)
 * and by providers (to verify invocation_token).
 */
export function verifyJws(token, {
    publicPem,
    publicKeyJwk,
    publicKeyPath,
    expectedAudience,
    bodyObject,
    replayCache,
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
    maxTtlSeconds = MAX_TTL_SECONDS,
    now
} = {}) {
    const { header, payload, signature, signingInput } = decodeJws(token);
    const publicKey = loadPublicKey({ publicPem, publicKeyJwk, publicKeyPath });
    assertSignatureMatches({
        algorithm: header.alg,
        signingInput,
        signature,
        publicKey
    });
    assertTimeValid(payload, { clockSkewSeconds, maxTtlSeconds, now });
    assertAudience(payload, expectedAudience);
    assertBodyHash(payload, bodyObject);
    assertReplayProtected(payload, replayCache);
    return { header, payload };
}

/**
 * Verify a caller assertion token submitted to the router.
 *
 * `resolveCallerPublicKey` is an injected callback invoked with the claimed
 * `iss` (caller principal) so that the router can look up the agent's public
 * key. This keeps wireVerify free of any concrete workspace dependency.
 */
export function verifyCallerAssertion(token, {
    resolveCallerPublicKey,
    replayCache,
    expectedAudience = 'ploinky-router',
    bodyObject,
    clockSkewSeconds,
    maxTtlSeconds
}) {
    const { header, payload, signature, signingInput } = decodeJws(token);
    if (!payload.iss) throw new Error('wireVerify: caller assertion missing iss');
    const keyMaterial = resolveCallerPublicKey(payload.iss);
    if (!keyMaterial) {
        throw new Error(`wireVerify: unknown caller principal '${payload.iss}'`);
    }
    const publicKey = loadPublicKey(keyMaterial);
    assertSignatureMatches({
        algorithm: header.alg,
        signingInput,
        signature,
        publicKey
    });
    assertTimeValid(payload, { clockSkewSeconds, maxTtlSeconds });
    assertAudience(payload, expectedAudience);
    assertBodyHash(payload, bodyObject);
    assertReplayProtected(payload, replayCache);
    return { header, payload };
}

/**
 * Verify a router-minted invocation_token. The provider calls this to decide
 * whether to accept the request.
 *
 * `expectedAudience` must equal the provider's principal id.
 */
export function verifyInvocationToken(token, {
    routerPublicPem,
    routerPublicKeyJwk,
    expectedAudience,
    bodyObject,
    replayCache,
    clockSkewSeconds,
    maxTtlSeconds
}) {
    return verifyJws(token, {
        publicPem: routerPublicPem,
        publicKeyJwk: routerPublicKeyJwk,
        expectedAudience,
        bodyObject,
        replayCache,
        clockSkewSeconds,
        maxTtlSeconds
    });
}

/**
 * Simple in-memory replay cache. Suitable for tests and for processes that
 * stay alive long enough to span at least the max token lifetime.
 */
export function createMemoryReplayCache({ maxSize = 2048 } = {}) {
    const entries = new Map();
    function prune() {
        const now = Date.now();
        for (const [jti, expiresAt] of entries) {
            if (expiresAt <= now) entries.delete(jti);
        }
        while (entries.size > maxSize) {
            const firstKey = entries.keys().next().value;
            if (firstKey === undefined) break;
            entries.delete(firstKey);
        }
    }
    return {
        seen(jti) {
            prune();
            return entries.has(jti);
        },
        remember(jti, ttlMs) {
            prune();
            entries.set(jti, Date.now() + Math.max(1, Number(ttlMs) || 1));
        },
        reset() { entries.clear(); }
    };
}

export { canonicalJson, bodyHashForRequest };

export default {
    verifyJws,
    verifyCallerAssertion,
    verifyInvocationToken,
    createMemoryReplayCache,
    MAX_TTL_SECONDS
};
