import fs from 'node:fs';

import {
    verifyInvocationToken,
    verifyCallerAssertion,
    verifyJws
} from './wireVerify.mjs';

export const INVOCATION_TOKEN_HEADER = 'x-ploinky-invocation';
export const CALLER_ASSERTION_HEADER = 'x-ploinky-caller-assertion';
export const USER_CONTEXT_HEADER = 'x-ploinky-user-context';

export function readHeaderValue(headers = {}, headerName) {
    const direct = headers?.[headerName];
    if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
    }
    const lower = headers?.[String(headerName).toLowerCase()];
    return typeof lower === 'string' && lower.trim() ? lower.trim() : '';
}

export function hasInvocationTokenHeader(headers = {}) {
    return Boolean(readHeaderValue(headers, INVOCATION_TOKEN_HEADER));
}

export function hasDirectAgentHeaders(headers = {}) {
    return Boolean(
        readHeaderValue(headers, CALLER_ASSERTION_HEADER)
        || readHeaderValue(headers, USER_CONTEXT_HEADER)
    );
}

export function expectedAudienceForSelf(env = process.env) {
    const principal = String(env?.PLOINKY_AGENT_PRINCIPAL || '').trim();
    if (principal) return principal;
    const agentName = String(env?.AGENT_NAME || '').trim();
    return agentName ? `agent:${agentName}` : '';
}

export function readRouterPublicKeyMaterial(env = process.env) {
    const jwkEnv = String(env?.PLOINKY_ROUTER_PUBLIC_KEY_JWK || '').trim();
    if (jwkEnv) {
        try {
            return { publicKeyJwk: JSON.parse(jwkEnv) };
        } catch (err) {
            console.warn('[runtimeWire] invalid PLOINKY_ROUTER_PUBLIC_KEY_JWK:', err.message);
        }
    }
    const pemPath = String(env?.PLOINKY_ROUTER_PUBLIC_KEY_PATH || '').trim();
    if (pemPath) {
        try {
            return { publicPem: fs.readFileSync(pemPath, 'utf8') };
        } catch (err) {
            console.warn('[runtimeWire] cannot read router public key at', pemPath, err.message);
        }
    }
    for (const candidate of ['/Agent/router-session.pub', '/shared/router-session.pub']) {
        try {
            if (fs.existsSync(candidate)) {
                return { publicPem: fs.readFileSync(candidate, 'utf8') };
            }
        } catch (_) {}
    }
    return null;
}

export function readAgentPublicKeys(env = process.env) {
    const raw = String(env?.PLOINKY_AGENT_PUBLIC_KEYS_JSON || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export function buildDirectInvocationPayload({
    callerAssertionPayload,
    userContextPayload,
    expectedAudience
}) {
    const delegatedUser = userContextPayload?.user && typeof userContextPayload.user === 'object'
        ? userContextPayload.user
        : null;
    return {
        iss: 'direct-agent-wire',
        sub: String(callerAssertionPayload?.iss || ''),
        aud: String(expectedAudience || ''),
        tool: String(callerAssertionPayload?.tool || ''),
        scope: Array.isArray(callerAssertionPayload?.scope) ? [...callerAssertionPayload.scope] : [],
        body_hash: String(callerAssertionPayload?.body_hash || ''),
        jti: String(callerAssertionPayload?.jti || ''),
        iat: Number(callerAssertionPayload?.iat || 0),
        exp: Number(callerAssertionPayload?.exp || 0),
        user: delegatedUser ? { ...delegatedUser } : null,
        user_context_token: ''
    };
}

export function verifyInvocationFromHeaders(headers = {}, bodyObject, {
    env = process.env,
    replayCache
} = {}) {
    const rawToken = readHeaderValue(headers, INVOCATION_TOKEN_HEADER);
    if (!rawToken) {
        return { ok: false, reason: 'missing invocation token' };
    }
    const keyMaterial = readRouterPublicKeyMaterial(env);
    if (!keyMaterial) {
        return { ok: false, reason: 'router public key not configured' };
    }
    const audience = expectedAudienceForSelf(env);
    try {
        const { payload } = verifyInvocationToken(rawToken, {
            routerPublicPem: keyMaterial.publicPem,
            routerPublicKeyJwk: keyMaterial.publicKeyJwk,
            expectedAudience: audience || undefined,
            bodyObject,
            replayCache
        });
        return { ok: true, payload };
    } catch (err) {
        return { ok: false, reason: err?.message || String(err) };
    }
}

export function verifyDirectAgentRequest(headers = {}, bodyObject, {
    env = process.env,
    callerReplayCache
} = {}) {
    const callerAssertionToken = readHeaderValue(headers, CALLER_ASSERTION_HEADER);
    if (!callerAssertionToken) {
        return { ok: false, reason: 'missing caller assertion' };
    }
    const userContextToken = readHeaderValue(headers, USER_CONTEXT_HEADER);
    if (!userContextToken) {
        return { ok: false, reason: 'missing user context token' };
    }

    const callerPublicKeys = readAgentPublicKeys(env);
    const expectedAudience = expectedAudienceForSelf(env) || undefined;

    try {
        const callerAssertion = verifyCallerAssertion(callerAssertionToken, {
            resolveCallerPublicKey: (principalId) => {
                const entry = callerPublicKeys[String(principalId || '').trim()];
                return entry?.publicKeyJwk ? { publicKeyJwk: entry.publicKeyJwk } : null;
            },
            replayCache: callerReplayCache,
            expectedAudience,
            bodyObject
        });

        const keyMaterial = readRouterPublicKeyMaterial(env);
        if (!keyMaterial) {
            return { ok: false, reason: 'router public key not configured' };
        }

        const callerPrincipal = String(callerAssertion?.payload?.iss || '').trim();
        if (!callerPrincipal) {
            return { ok: false, reason: 'caller assertion missing issuer' };
        }
        const userContext = verifyJws(userContextToken, {
            publicPem: keyMaterial.publicPem,
            publicKeyJwk: keyMaterial.publicKeyJwk,
            expectedAudience: callerPrincipal
        });

        const payload = buildDirectInvocationPayload({
            callerAssertionPayload: callerAssertion.payload,
            userContextPayload: userContext.payload,
            expectedAudience
        });
        payload.user_context_token = userContextToken;
        return { ok: true, payload };
    } catch (err) {
        return { ok: false, reason: err?.message || String(err) };
    }
}

export default {
    INVOCATION_TOKEN_HEADER,
    CALLER_ASSERTION_HEADER,
    USER_CONTEXT_HEADER,
    readHeaderValue,
    hasInvocationTokenHeader,
    hasDirectAgentHeaders,
    expectedAudienceForSelf,
    readRouterPublicKeyMaterial,
    readAgentPublicKeys,
    buildDirectInvocationPayload,
    verifyInvocationFromHeaders,
    verifyDirectAgentRequest
};
