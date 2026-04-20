import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    signCallerAssertion,
    signRouterToken,
    bodyHashForRequest,
    canonicalJson
} from '../../Agent/lib/wireSign.mjs';
import {
    verifyCallerAssertion,
    verifyInvocationToken,
    createMemoryReplayCache,
    verifyJws,
    MAX_TTL_SECONDS
} from '../../Agent/lib/wireVerify.mjs';
import {
    issueUserContextToken,
    buildFirstPartyInvocation,
    getRouterPublicKeyJwk
} from '../../cli/server/mcp-proxy/secureWire.js';

function ed25519Pair() {
    return crypto.generateKeyPairSync('ed25519');
}

function pemPrivate(pair) {
    return pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function pemPublic(pair) {
    return pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

const EXAMPLE_BODY = { tool: 'secret_get', arguments: { key: 'X' } };

test('signCallerAssertion / verifyCallerAssertion round-trip', () => {
    const caller = ed25519Pair();
    const { token, payload } = signCallerAssertion({
        callerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        bindingId: 'gitAgent:secretStore',
        alias: 'secretStore',
        tool: 'secret_get',
        scope: ['secret:read'],
        bodyObject: EXAMPLE_BODY,
        privatePem: pemPrivate(caller)
    });
    assert.equal(payload.iss, 'agent:AssistOSExplorer/gitAgent');

    const replay = createMemoryReplayCache();
    const verified = verifyCallerAssertion(token, {
        resolveCallerPublicKey: () => ({ publicPem: pemPublic(caller) }),
        replayCache: replay,
        bodyObject: EXAMPLE_BODY
    });
    assert.equal(verified.payload.tool, 'secret_get');
});

test('verifyInvocationToken enforces audience', () => {
    const router = ed25519Pair();
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        scope: ['secret:read'],
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        jti: crypto.randomBytes(12).toString('base64url'),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60
    };
    const token = signRouterToken({ payload, privateKey: router.privateKey });

    // Correct audience OK
    verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    });

    // Wrong audience fails
    assert.throws(() => verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:otherAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /audience mismatch/);
});

test('issueUserContextToken pins delegated user context to the immediate caller agent', () => {
    const token = issueUserContextToken({
        user: {
            id: 'user-1',
            username: 'alice',
            email: 'alice@example.com',
            roles: ['developer']
        },
        sessionId: 'session-a',
        audience: 'agent:AssistOSExplorer/gitAgent'
    });

    verifyJws(token, {
        publicKeyJwk: getRouterPublicKeyJwk(),
        expectedAudience: 'agent:AssistOSExplorer/gitAgent'
    });

    assert.throws(() => verifyJws(token, {
        publicKeyJwk: getRouterPublicKeyJwk(),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent'
    }), /audience mismatch/);
});

test('buildFirstPartyInvocation embeds a user-context token scoped to the first-hop provider', () => {
    const { payload } = buildFirstPartyInvocation({
        providerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        tool: 'git_auth_status',
        bodyObject: { tool: 'git_auth_status', arguments: {} },
        delegatedUser: {
            id: 'user-2',
            username: 'bob',
            email: 'bob@example.com',
            roles: ['developer']
        },
        sessionId: 'session-b'
    });

    assert.ok(payload.user_context_token);
    verifyJws(payload.user_context_token, {
        publicKeyJwk: getRouterPublicKeyJwk(),
        expectedAudience: 'agent:AssistOSExplorer/gitAgent'
    });
});

test('verifyInvocationToken rejects mutated body', () => {
    const router = ed25519Pair();
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: crypto.randomBytes(12).toString('base64url')
    };
    const token = signRouterToken({ payload, privateKey: router.privateKey });
    assert.throws(() => verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: { tool: 'secret_get', arguments: { key: 'Y' } },
        replayCache: createMemoryReplayCache()
    }), /body_hash mismatch/);
});

test('verifyInvocationToken rejects replay within ttl window', () => {
    const router = ed25519Pair();
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: 'replay-test-1'
    };
    const token = signRouterToken({ payload, privateKey: router.privateKey });
    const cache = createMemoryReplayCache();
    verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: cache
    });
    assert.throws(() => verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: cache
    }), /jti has already been consumed/);
});

test('verifyInvocationToken rejects token without jti', () => {
    const router = ed25519Pair();
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60
    };
    const token = signRouterToken({ payload, privateKey: router.privateKey });
    assert.throws(() => verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /jti missing/);
});

test('verifyInvocationToken rejects token with excessive lifetime', () => {
    const router = ed25519Pair();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        iat: now,
        exp: now + MAX_TTL_SECONDS + 30,
        jti: 'ttl-check'
    };
    const token = signRouterToken({ payload, privateKey: router.privateKey });
    assert.throws(() => verifyInvocationToken(token, {
        routerPublicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /lifetime exceeds max/);
});

test('verifyJws rejects invalid signature', () => {
    const router = ed25519Pair();
    const other = ed25519Pair();
    const payload = {
        iss: 'ploinky-router',
        sub: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        tool: 'secret_get',
        body_hash: bodyHashForRequest(EXAMPLE_BODY),
        jti: 'sigfail'
    };
    const tokenSignedByOther = signRouterToken({ payload, privateKey: other.privateKey });
    assert.throws(() => verifyJws(tokenSignedByOther, {
        publicPem: pemPublic(router),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY
    }), /signature invalid/);
});

test('verifyCallerAssertion rejects unknown issuer', () => {
    const caller = ed25519Pair();
    const { token } = signCallerAssertion({
        callerPrincipal: 'agent:unknownAgent',
        bindingId: 'unknownAgent:secretStore',
        alias: 'secretStore',
        tool: 'secret_get',
        scope: ['secret:read'],
        bodyObject: EXAMPLE_BODY,
        privatePem: pemPrivate(caller)
    });
    assert.throws(() => verifyCallerAssertion(token, {
        resolveCallerPublicKey: () => null,
        replayCache: createMemoryReplayCache(),
        bodyObject: EXAMPLE_BODY
    }), /unknown caller principal/);
});

test('signCallerAssertion / verifyCallerAssertion work without binding metadata for direct agent calls', () => {
    const caller = ed25519Pair();
    const replay = createMemoryReplayCache();
    const { token, payload } = signCallerAssertion({
        callerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        tool: 'secret_get',
        scope: ['secret:read'],
        bodyObject: EXAMPLE_BODY,
        privatePem: pemPrivate(caller),
        audience: 'agent:AssistOSExplorer/dpuAgent'
    });

    assert.equal(payload.binding_id, undefined);
    assert.equal(payload.alias, undefined);
    assert.ok(payload.jti);

    const verified = verifyCallerAssertion(token, {
        resolveCallerPublicKey: () => ({ publicPem: pemPublic(caller) }),
        replayCache: replay,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY
    });

    assert.equal(verified.payload.iss, 'agent:AssistOSExplorer/gitAgent');
    assert.equal(verified.payload.tool, 'secret_get');

    assert.throws(() => verifyCallerAssertion(token, {
        resolveCallerPublicKey: () => ({ publicPem: pemPublic(caller) }),
        replayCache: replay,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY
    }), /jti has already been consumed/);
});

test('verifyCallerAssertion rejects assertion without jti', () => {
    const caller = ed25519Pair();
    const payload = {
        iss: 'agent:AssistOSExplorer/gitAgent',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        tool: 'secret_get',
        scope: ['secret:read'],
        body_hash: bodyHashForRequest(EXAMPLE_BODY)
    };
    const token = signRouterToken({ payload, privateKey: caller.privateKey, kid: 'agent:AssistOSExplorer/gitAgent' });
    assert.throws(() => verifyCallerAssertion(token, {
        resolveCallerPublicKey: () => ({ publicPem: pemPublic(caller) }),
        replayCache: createMemoryReplayCache(),
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY
    }), /jti missing/);
});

test('canonicalJson sorts keys deterministically', () => {
    assert.equal(
        canonicalJson({ b: 1, a: 2, c: { y: 3, x: 4 } }),
        canonicalJson({ a: 2, c: { x: 4, y: 3 }, b: 1 })
    );
});
