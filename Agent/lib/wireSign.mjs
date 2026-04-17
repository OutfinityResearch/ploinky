import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * wireSign.mjs
 *
 * Caller-assertion signer. Agents use this to prove their identity when
 * requesting a delegated capability call through the router.
 *
 * A caller assertion is a compact JWS (Ed25519 / `EdDSA`) over the payload:
 *
 *   {
 *     iss: <caller agent principal>,
 *     aud: "ploinky-router",
 *     iat: <seconds>,
 *     exp: <seconds>,   // <= 60
 *     jti: <random>,
 *     user_context_token: <string | undefined>,
 *     body_hash: <base64url sha-256 of canonical request body>,
 *     binding_id: <string | undefined>,
 *     alias: <string | undefined>,
 *     tool: <string>,
 *     scope: <string[]>
 *   }
 *
 * The router verifies this assertion using the public key registered for the
 * caller's principal. It then mints the router-signed invocation_token that
 * the provider agent trusts.
 */

const DEFAULT_LIFETIME_SECONDS = 45;

function base64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function base64urlJson(obj) {
    return base64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${parts.join(',')}}`;
}

export function bodyHashForRequest(bodyObject) {
    const str = canonicalJson(bodyObject ?? {});
    return crypto.createHash('sha256').update(str, 'utf8').digest('base64url');
}

function loadPrivateKey({ privatePem, privateKeyPath }) {
    if (privatePem && typeof privatePem === 'string') {
        return crypto.createPrivateKey(privatePem);
    }
    if (privateKeyPath) {
        const pem = fs.readFileSync(privateKeyPath, 'utf8');
        return crypto.createPrivateKey(pem);
    }
    throw new Error('wireSign: privatePem or privateKeyPath required');
}

export function signCallerAssertion({
    callerPrincipal,
    bindingId,
    alias,
    tool,
    scope = [],
    bodyObject,
    userContextToken = null,
    lifetimeSeconds = DEFAULT_LIFETIME_SECONDS,
    privatePem,
    privateKeyPath,
    audience = 'ploinky-router'
}) {
    if (!callerPrincipal) throw new Error('signCallerAssertion: callerPrincipal required');
    if (!tool) throw new Error('signCallerAssertion: tool required');
    const privateKey = loadPrivateKey({ privatePem, privateKeyPath });

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Math.max(5, Math.min(Number(lifetimeSeconds) || DEFAULT_LIFETIME_SECONDS, 120));
    const jti = crypto.randomBytes(12).toString('base64url');

    const payload = {
        iss: String(callerPrincipal),
        aud: audience,
        iat,
        exp,
        tool: String(tool),
        scope: Array.isArray(scope) ? [...scope] : [],
        body_hash: bodyHashForRequest(bodyObject),
        jti
    };
    if (bindingId) {
        payload.binding_id = String(bindingId);
    }
    if (alias) {
        payload.alias = String(alias);
    }
    if (userContextToken) {
        payload.user_context_token = String(userContextToken);
    }

    const header = { alg: 'EdDSA', typ: 'JWT', kid: String(callerPrincipal) };

    const headerB64 = base64urlJson(header);
    const payloadB64 = base64urlJson(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
    const token = `${signingInput}.${base64url(signature)}`;
    return {
        token,
        header,
        payload
    };
}

/**
 * Sign a router session token. Core uses this to mint user_context_token
 * and invocation_token. `alg` is always EdDSA. The payload is provided
 * verbatim (core is expected to have normalized it).
 */
export function signRouterToken({ payload, privateKey, kid = 'ploinky-router' }) {
    if (!privateKey) throw new Error('signRouterToken: privateKey required');
    const header = { alg: 'EdDSA', typ: 'JWT', kid };
    const headerB64 = base64urlJson(header);
    const payloadB64 = base64urlJson(payload);
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
    return `${signingInput}.${base64url(signature)}`;
}

export default { signCallerAssertion, signRouterToken, bodyHashForRequest, canonicalJson };
