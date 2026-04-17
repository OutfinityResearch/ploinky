import crypto from 'node:crypto';

import { signRouterToken, bodyHashForRequest } from '../../../Agent/lib/wireSign.mjs';
import { verifyCallerAssertion, createMemoryReplayCache, verifyJws } from '../../../Agent/lib/wireVerify.mjs';
import { ensureRouterSigningKey, getRouterPublicKey } from '../../services/agentKeystore.js';
import {
    getRegisteredAgentPublicKey,
    getCapabilityBinding,
    getAgentDescriptorByPrincipal,
    resolveAgentDescriptor,
    resolveAliasForConsumer
} from '../../services/capabilityRegistry.js';

/**
 * secureWire.js (router side)
 *
 * Central place where the router turns a verified authenticated caller into
 * a router-signed invocation_token that a provider agent will trust. Two
 * entry points:
 *
 *   - buildFirstPartyInvocation: the browser / core route handler is the
 *     caller. The router itself acts as `sub = router:first-party`.
 *   - buildDelegatedInvocation: an agent presents a caller-assertion. The
 *     router verifies it, then mints an invocation_token with
 *     `sub = <caller agent principal>`.
 *
 * Also exposes issueUserContextToken for agents that want to forward the
 * authenticated user context to the provider via the router.
 *
 * Replay protection is per-router-process via createMemoryReplayCache.
 */

const ROUTER_AUDIENCE = 'ploinky-router';
const DEFAULT_INVOCATION_TTL_SECONDS = 60;

const assertionReplayCache = createMemoryReplayCache({ maxSize: 4096 });

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

function delegatedUserFromUserContextToken(userContextToken) {
    if (!userContextToken) return null;
    const routerKey = getRouterPublicKey();
    const { payload } = verifyJws(String(userContextToken), {
        publicKeyJwk: routerKey.publicKeyJwk,
        expectedAudience: 'ploinky-agents'
    });
    return normalizeDelegatedUser(payload?.user || null);
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

export function buildDelegatedInvocation({
    callerAssertionToken,
    bodyObject,
    providerAgentRef,
    providerPrincipal,
    contract,
    tool,
    scope = [],
    workspaceId,
    delegatedUser,
    ttlSeconds
}) {
    if (!callerAssertionToken) {
        throw new Error('secureWire: callerAssertionToken required for delegated invocation');
    }
    const verified = verifyCallerAssertion(callerAssertionToken, {
        resolveCallerPublicKey: (principalId) => {
            const entry = getRegisteredAgentPublicKey(principalId);
            if (!entry || !entry.publicKeyJwk) return null;
            return { publicKeyJwk: entry.publicKeyJwk };
        },
        replayCache: assertionReplayCache,
        expectedAudience: ROUTER_AUDIENCE,
        bodyObject
    });
    const claimedBindingId = String(verified.payload.binding_id || '');
    const claimedTool = String(verified.payload.tool || '');
    if (tool && claimedTool && claimedTool !== tool) {
        throw new Error('secureWire: assertion tool does not match invocation tool');
    }
    if (!tool && claimedTool) {
        tool = claimedTool;
    }
    const callerDescriptor = getAgentDescriptorByPrincipal(verified.payload.iss);
    if (!callerDescriptor) {
        throw new Error(`secureWire: caller '${verified.payload.iss}' is not a registered installed agent`);
    }
    const alias = String(verified.payload.alias || '').trim();
    if (!alias) {
        throw new Error('secureWire: caller assertion missing capability alias');
    }
    const requestedScopes = Array.isArray(verified.payload.scope) ? verified.payload.scope : (scope || []);
    const resolvedBinding = resolveAliasForConsumer({
        consumerAgentRef: callerDescriptor.agentRef,
        alias,
        requestedScopes
    });
    if (!resolvedBinding) {
        throw new Error(`secureWire: no binding resolved for ${callerDescriptor.agentRef}:${alias}`);
    }
    if (resolvedBinding.deniedScopes.length) {
        throw new Error(`secureWire: requested scopes denied for ${callerDescriptor.agentRef}:${alias} (${resolvedBinding.deniedScopes.join(', ')})`);
    }
    if (claimedBindingId && claimedBindingId !== resolvedBinding.binding.id) {
        throw new Error('secureWire: assertion binding_id does not match the live workspace binding');
    }
    if (!tool) {
        throw new Error('secureWire: delegated invocation missing tool name');
    }
    if (Array.isArray(resolvedBinding.providerContract?.operations) && resolvedBinding.providerContract.operations.length) {
        if (!resolvedBinding.providerContract.operations.includes(tool)) {
            throw new Error(`secureWire: tool '${tool}' is not allowed by contract ${resolvedBinding.binding.contract}`);
        }
    }
    const resolvedProviderRef = resolvedBinding.binding.provider;
    if (providerAgentRef) {
        const explicitProvider = resolveAgentDescriptor(providerAgentRef);
        if (!explicitProvider || explicitProvider.agentRef !== resolvedProviderRef) {
            throw new Error(`secureWire: route provider '${providerAgentRef}' does not match bound provider '${resolvedProviderRef}'`);
        }
    }
    const resolvedProviderPrincipal = resolvedBinding.provider.principalId;
    if (providerPrincipal && providerPrincipal !== resolvedProviderPrincipal) {
        throw new Error(`secureWire: explicit provider principal '${providerPrincipal}' does not match binding '${resolvedProviderPrincipal}'`);
    }
    if (!claimedBindingId && !workspaceId) {
        workspaceId = 'default';
    }
    const router = ensureRouterSigningKey();
    const resolvedProvider = resolveProviderPrincipal({
        providerAgentRef: resolvedProviderRef,
        providerPrincipal: resolvedProviderPrincipal
    });
    const delegatedUserFromToken = delegatedUserFromUserContextToken(verified.payload.user_context_token);
    const forwardedUserContextToken = typeof verified.payload.user_context_token === 'string'
        ? verified.payload.user_context_token
        : null;
    const payload = buildInvocationPayload({
        callerPrincipal: verified.payload.iss,
        workspaceId,
        bindingId: resolvedBinding.binding.id,
        contract: contract || resolvedBinding.binding.contract,
        providerPrincipal: resolvedProvider,
        tool,
        scope: resolvedBinding.grantedScopes,
        bodyObject,
        delegatedUser: delegatedUserFromToken || delegatedUser,
        userContextToken: forwardedUserContextToken,
        ttlSeconds
    });
    const token = signRouterToken({ payload, privateKey: router.privateKey, kid: 'ploinky-router' });
    return { token, payload, callerAssertionPayload: verified.payload };
}

export function getRouterPublicKeyJwk() {
    return getRouterPublicKey().publicKeyJwk;
}

export function resolveProviderForConsumerAlias({ consumerPrincipal, alias }) {
    const descriptor = consumerPrincipal
        ? getAgentDescriptorByPrincipal(consumerPrincipal)
        : null;
    if (!descriptor) return null;
    const binding = getCapabilityBinding({ consumer: descriptor.agentRef, alias });
    return binding || null;
}

export const __invocationReplayCache = assertionReplayCache;

export default {
    issueUserContextToken,
    buildFirstPartyInvocation,
    buildDelegatedInvocation,
    getRouterPublicKeyJwk,
    resolveProviderForConsumerAlias
};
