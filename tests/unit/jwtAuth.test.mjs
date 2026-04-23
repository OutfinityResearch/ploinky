import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    signHmacJwt,
    bodyHashForRequest,
    canonicalJson
} from '../../Agent/lib/jwtSign.mjs';
import {
    verifyInvocationToken,
    createMemoryReplayCache,
    verifyJws,
    MAX_TTL_SECONDS
} from '../../Agent/lib/jwtVerify.mjs';

const SECRET = crypto.randomBytes(32);
const EXAMPLE_BODY = { tool: 'secret_get', arguments: { key: 'X' } };

function mintInvocation(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        sub: 'user:local:admin',
        caller: 'router:first-party',
        tool: 'secret_get',
        scope: ['secret:read'],
        bh: bodyHashForRequest(EXAMPLE_BODY),
        usr: { id: 'local:admin', username: 'admin', roles: ['local'] },
        jti: crypto.randomBytes(12).toString('base64url'),
        iat: now,
        exp: now + 60,
        ...overrides
    };
    return { token: signHmacJwt({ payload, secret: SECRET }), payload };
}

test('signHmacJwt / verifyJws round-trip', () => {
    const { token, payload } = mintInvocation();
    const result = verifyJws(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    });
    assert.equal(result.payload.tool, 'secret_get');
    assert.equal(result.payload.caller, 'router:first-party');
    assert.equal(result.payload.usr.username, 'admin');
    assert.equal(result.header.alg, 'HS256');
});

test('verifyInvocationToken enforces audience', () => {
    const { token } = mintInvocation();
    verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    });
    assert.throws(() => verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:otherAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /audience mismatch/);
});

test('verifyInvocationToken enforces invocation type, issuer, and tool', () => {
    const wrongType = mintInvocation({ typ: 'session' }).token;
    assert.throws(() => verifyInvocationToken(wrongType, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        expectedTool: 'secret_get',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /token type is not invocation/);

    const wrongIssuer = mintInvocation({ iss: 'other-issuer' }).token;
    assert.throws(() => verifyInvocationToken(wrongIssuer, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        expectedTool: 'secret_get',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /issuer mismatch/);

    const wrongTool = mintInvocation({ tool: 'secret_put' }).token;
    assert.throws(() => verifyInvocationToken(wrongTool, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        expectedTool: 'secret_get',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /tool mismatch/);
});

test('buildFirstPartyInvocation embeds usr claim', () => {
    const { payload } = mintInvocation({
        usr: { id: 'local:bob', username: 'bob', roles: ['developer'] }
    });
    assert.equal(payload.usr.username, 'bob');
    assert.deepEqual(payload.usr.roles, ['developer']);
    assert.equal(payload.caller, 'router:first-party');
});

test('verifyInvocationToken rejects mutated body', () => {
    const { token } = mintInvocation();
    assert.throws(() => verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: { tool: 'secret_get', arguments: { key: 'Y' } },
        replayCache: createMemoryReplayCache()
    }), /body hash mismatch/);
});

test('verifyInvocationToken rejects replay within ttl window', () => {
    const { token } = mintInvocation({ jti: 'replay-test-1' });
    const cache = createMemoryReplayCache();
    verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: cache
    });
    assert.throws(() => verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: cache
    }), /jti has already been consumed/);
});

test('verifyInvocationToken rejects token without jti', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: 'agent:AssistOSExplorer/dpuAgent',
        tool: 'secret_get',
        bh: bodyHashForRequest(EXAMPLE_BODY),
        iat: now,
        exp: now + 60
    };
    const token = signHmacJwt({ payload, secret: SECRET });
    assert.throws(() => verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /jti missing/);
});

test('verifyInvocationToken rejects token with excessive lifetime', () => {
    const now = Math.floor(Date.now() / 1000);
    const { token } = mintInvocation({ iat: now, exp: now + MAX_TTL_SECONDS + 30 });
    assert.throws(() => verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY,
        replayCache: createMemoryReplayCache()
    }), /lifetime exceeds max/);
});

test('verifyJws rejects wrong secret', () => {
    const { token } = mintInvocation();
    const wrongSecret = crypto.randomBytes(32);
    assert.throws(() => verifyJws(token, {
        secret: wrongSecret,
        expectedAudience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: EXAMPLE_BODY
    }), /signature invalid/);
});

test('verifyJws rejects tampered payload', () => {
    const { token } = mintInvocation();
    const parts = token.split('.');
    const payloadBuf = Buffer.from(JSON.stringify({ iss: 'attacker' }));
    parts[1] = payloadBuf.toString('base64url');
    const tampered = parts.join('.');
    assert.throws(() => verifyJws(tampered, {
        secret: SECRET,
        bodyObject: EXAMPLE_BODY
    }), /signature invalid/);
});

test('canonicalJson sorts keys deterministically', () => {
    assert.equal(
        canonicalJson({ b: 1, a: 2, c: { y: 3, x: 4 } }),
        canonicalJson({ a: 2, c: { x: 4, y: 3 }, b: 1 })
    );
});
