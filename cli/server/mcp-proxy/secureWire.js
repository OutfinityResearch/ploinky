import crypto from 'node:crypto';

import { signRouterToken, bodyHashForRequest } from '../../../Agent/lib/wireSign.mjs';
import { verifyJws } from '../../../Agent/lib/wireVerify.mjs';
import { ensureRouterSigningKey, getRouterPublicKey } from '../../services/agentKeystore.js';
import { resolveAgentDescriptor } from '../../services/capabilityRegistry.js';

/**
 * secureWire.js (router side)
 *
 * Central place where the router turns a verified authenticated caller into
 * a router-signed invocation_token that a provider agent will trust. Two
 * entry points:
 *
 *   - buildFirstPartyInvocation: the browser / core route handler is the
 *     caller. The router itself acts as `sub = router:first-party`.
 *
 * Also exposes issueUserContextToken for agents that want to forward the
 * authenticated user context to the provider via the router.
 *
 */

const ROUTER_AUDIENCE = 'ploinky-router';
const DEFAULT_INVOCATION_TTL_SECONDS = 60;

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

export function issueUserContextToken({ user, sessionId, extraClaims }) {
    const key = ensureRouterSigningKey();
    const iat = nowSec();
    const payload = {
        iss: 'ploinky-router',
        aud: 'ploinky-agents',
        sid: String(sessionId || ''),
        iat,
        exp: iat + 60,
        jti: crypto.randomBytes(16).toString('base64url'),
        user: normalizeDelegatedUser(user),
        ...extraClaims
    };
    return signRouterToken({ payload, privateKey: key.privateKey, kid: 'ploinky-router' });
}

function resolveProviderPrincipal({ providerAgentRef, providerPrincipal }) {
    if (providerPrincipal) return String(providerPrincipal).trim();
    const descriptor = resolveAgentDescriptor(providerAgentRef);
    if (!descriptor) {
        throw new Error(`secureWire: could not resolve provider '${providerAgentRef}'`);
    }
    return descriptor.principalId;
}

function buildInvocationPayload({
    callerPrincipal,
    workspaceId = 'default',
    bindingId,
    contract,
    providerPrincipal,
    tool,
    scope,
    bodyObject,
    delegatedUser,
    userContextToken,
    ttlSeconds = DEFAULT_INVOCATION_TTL_SECONDS
}) {
    if (!providerPrincipal) {
        throw new Error('secureWire: providerPrincipal required');
    }
    if (!tool) throw new Error('secureWire: tool required');
    const iat = nowSec();
    const payload = {
        iss: ROUTER_AUDIENCE,
        sub: String(callerPrincipal),
        aud: String(providerPrincipal),
        workspace_id: String(workspaceId),
        binding_id: String(bindingId || ''),
        contract: String(contract || ''),
        scope: normalizeScopeList(scope),
        tool: String(tool),
        body_hash: bodyHashForRequest(bodyObject ?? {}),
        jti: crypto.randomBytes(16).toString('base64url'),
        iat,
        exp: iat + Math.max(5, Math.min(Number(ttlSeconds) || DEFAULT_INVOCATION_TTL_SECONDS, 120))
    };
    if (delegatedUser) {
        payload.user = normalizeDelegatedUser(delegatedUser);
    }
    if (userContextToken) {
        payload.user_context_token = String(userContextToken);
    }
    return payload;
}

export function buildFirstPartyInvocation({
    providerAgentRef,
    providerPrincipal,
    bindingId,
    contract,
    tool,
    scope = [],
    bodyObject,
    delegatedUser,
    sessionId,
    userContextToken,
    workspaceId,
    ttlSeconds
}) {
    const router = ensureRouterSigningKey();
    const resolvedProvider = resolveProviderPrincipal({ providerAgentRef, providerPrincipal });
    const forwardedUserContextToken = userContextToken
        || (delegatedUser ? issueUserContextToken({ user: delegatedUser, sessionId }) : null);
    const payload = buildInvocationPayload({
        callerPrincipal: 'router:first-party',
        workspaceId,
        bindingId,
        contract,
        providerPrincipal: resolvedProvider,
        tool,
        scope,
        bodyObject,
        delegatedUser,
        userContextToken: forwardedUserContextToken,
        ttlSeconds
    });
    const token = signRouterToken({ payload, privateKey: router.privateKey, kid: 'ploinky-router' });
    return { token, payload };
}

export function getRouterPublicKeyJwk() {
    return getRouterPublicKey().publicKeyJwk;
}

export default {
    issueUserContextToken,
    buildFirstPartyInvocation,
    getRouterPublicKeyJwk
};
