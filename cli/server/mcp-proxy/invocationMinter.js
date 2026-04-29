import crypto from 'node:crypto';

import { signHmacJwt, bodyHashForRequest } from '../../../Agent/lib/jwtSign.mjs';
import { verifyInvocationToken } from '../../../Agent/lib/jwtVerify.mjs';
import { deriveSubkey } from '../../services/masterKey.js';
import { resolveAgentDescriptor } from '../../services/capabilityRegistry.js';

/**
 * invocationMinter.js (router side)
 *
 * Mints HS256 invocation JWTs for agents. The router is the sole token
 * issuer. Two entry points:
 *
 *   - buildFirstPartyInvocation: browser/core calls an agent.
 *     The router acts as caller = "router:first-party".
 *
 *   - verifyDelegatedToolCall: an agent calls another agent.
 *     The calling agent presents its own invocation JWT as identity proof.
 *     The router verifies it and mints a fresh invocation JWT for the target.
 */

const DEFAULT_INVOCATION_TTL_SECONDS = 60;

function getWireSecretBuffer() {
    return deriveSubkey('invocation');
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function normalizeScopeList(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of input) {
        const v = String(entry || '').trim().toLowerCase();
        if (v && !seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    }
    return out;
}

function normalizeDelegatedUser(user) {
    if (!user || typeof user !== 'object') return null;
    return {
        sub: String(user.id || user.sub || ''),
        id: String(user.id || user.sub || ''),
        email: String(user.email || ''),
        username: String(user.username || user.preferred_username || user.name || ''),
        roles: Array.isArray(user.roles) ? [...user.roles] : []
    };
}

function resolveProviderPrincipal({ providerAgentRef, providerPrincipal }) {
    if (providerPrincipal) return String(providerPrincipal).trim();
    const descriptor = resolveAgentDescriptor(providerAgentRef);
    if (!descriptor) {
        throw new Error(`invocationMinter: could not resolve provider '${providerAgentRef}'`);
    }
    return descriptor.principalId;
}

const FIRST_PARTY_DEFAULT_SCOPES = [
    'secret:read', 'secret:write', 'secret:access',
    'secret:grant', 'secret:revoke'
];

export function buildFirstPartyInvocation({
    providerAgentRef,
    providerPrincipal,
    tool,
    scope,
    bodyObject,
    delegatedUser,
    ttlSeconds
}) {
    const resolvedScope = Array.isArray(scope) && scope.length ? scope : FIRST_PARTY_DEFAULT_SCOPES;
    const resolvedProvider = resolveProviderPrincipal({ providerAgentRef, providerPrincipal });
    if (!tool) throw new Error('invocationMinter: tool required');
    const iat = nowSec();
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: String(resolvedProvider),
        sub: String(delegatedUser?.id || delegatedUser?.sub || ''),
        caller: 'router:first-party',
        tool: String(tool),
        scope: normalizeScopeList(resolvedScope),
        bh: bodyHashForRequest(bodyObject ?? {}),
        usr: normalizeDelegatedUser(delegatedUser),
        jti: crypto.randomBytes(16).toString('base64url'),
        iat,
        exp: iat + Math.max(5, Math.min(Number(ttlSeconds) || DEFAULT_INVOCATION_TTL_SECONDS, 120))
    };
    const token = signHmacJwt({ payload, secret: getWireSecretBuffer() });
    return { token, payload };
}

export function buildDelegatedInvocation({
    providerPrincipal,
    callerPrincipal,
    tool,
    scope,
    bodyObject,
    delegatedUser,
    ttlSeconds
}) {
    if (!providerPrincipal) throw new Error('invocationMinter: providerPrincipal required');
    if (!tool) throw new Error('invocationMinter: tool required');
    const resolvedScope = Array.isArray(scope) && scope.length ? scope : FIRST_PARTY_DEFAULT_SCOPES;
    const iat = nowSec();
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: String(providerPrincipal),
        sub: String(delegatedUser?.id || delegatedUser?.sub || ''),
        caller: String(callerPrincipal),
        tool: String(tool),
        scope: normalizeScopeList(resolvedScope),
        bh: bodyHashForRequest(bodyObject ?? {}),
        usr: normalizeDelegatedUser(delegatedUser),
        jti: crypto.randomBytes(16).toString('base64url'),
        iat,
        exp: iat + Math.max(5, Math.min(Number(ttlSeconds) || DEFAULT_INVOCATION_TTL_SECONDS, 120))
    };
    const token = signHmacJwt({ payload, secret: getWireSecretBuffer() });
    return { token, payload };
}

export function verifyDelegatedToolCall({
    providerAgentRef,
    providerPrincipal,
    callerJwt
}) {
    const resolvedProvider = resolveProviderPrincipal({ providerAgentRef, providerPrincipal });
    if (!callerJwt) {
        throw new Error('invocationMinter: caller JWT required');
    }
    const { payload } = verifyInvocationToken(callerJwt, {
        secret: getWireSecretBuffer(),
        maxTtlSeconds: 120
    });
    const callerPrincipal = String(payload.aud || '').trim();
    if (!callerPrincipal) {
        throw new Error('invocationMinter: caller token missing audience (caller identity)');
    }
    return {
        providerPrincipal: resolvedProvider,
        callerPrincipal,
        user: payload.usr || null
    };
}

export default {
    buildFirstPartyInvocation,
    buildDelegatedInvocation,
    verifyDelegatedToolCall
};
