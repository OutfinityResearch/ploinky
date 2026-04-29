import { verifyInvocationToken } from './jwtVerify.mjs';

export function readHeaderValue(headers = {}, headerName) {
    const direct = headers?.[headerName];
    if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
    }
    const lower = headers?.[String(headerName).toLowerCase()];
    return typeof lower === 'string' && lower.trim() ? lower.trim() : '';
}

export function hasInvocationTokenHeader(headers = {}) {
    const auth = readHeaderValue(headers, 'authorization');
    return auth.toLowerCase().startsWith('bearer ');
}

export function expectedAudienceForSelf(env = process.env) {
    const principal = String(env?.PLOINKY_AGENT_PRINCIPAL || '').trim();
    if (principal) return principal;
    const agentName = String(env?.AGENT_NAME || '').trim();
    return agentName ? `agent:${agentName}` : '';
}

export function readWireSecret(env = process.env) {
    // Agents must only see the router-derived wire secret. Falling back to
    // PLOINKY_MASTER_KEY would let an agent process verify (and, via the same
    // bytes, mint) JWTs with the workspace root key — violating the invariant
    // that every secret is derived per-purpose from the master.
    const hex = String(env?.PLOINKY_WIRE_SECRET || '').trim();
    return hex ? Buffer.from(hex, 'hex') : null;
}

export function verifyInvocationFromHeaders(headers = {}, bodyObject, {
    env = process.env,
    replayCache,
    expectedTool
} = {}) {
    const auth = readHeaderValue(headers, 'authorization');
    if (!auth.toLowerCase().startsWith('bearer ')) {
        return { ok: false, reason: 'missing invocation token' };
    }
    const rawToken = auth.slice(7).trim();
    if (!rawToken) {
        return { ok: false, reason: 'empty invocation token' };
    }
    const secret = readWireSecret(env);
    if (!secret) {
        return { ok: false, reason: 'PLOINKY_WIRE_SECRET not configured' };
    }
    const audience = expectedAudienceForSelf(env);
    if (!audience) {
        return { ok: false, reason: 'PLOINKY_AGENT_PRINCIPAL or AGENT_NAME not configured' };
    }
    try {
        const { payload } = verifyInvocationToken(rawToken, {
            secret,
            expectedAudience: audience,
            expectedTool,
            bodyObject,
            replayCache
        });
        return { ok: true, payload, rawToken };
    } catch (err) {
        return { ok: false, reason: err?.message || String(err) };
    }
}

export default {
    readHeaderValue,
    hasInvocationTokenHeader,
    expectedAudienceForSelf,
    readWireSecret,
    verifyInvocationFromHeaders
};
