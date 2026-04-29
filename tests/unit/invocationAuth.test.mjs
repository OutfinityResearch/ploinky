import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { signHmacJwt, bodyHashForRequest } from '../../Agent/lib/jwtSign.mjs';
import { createMemoryReplayCache } from '../../Agent/lib/jwtVerify.mjs';
import { verifyInvocationFromHeaders } from '../../Agent/lib/invocationAuth.mjs';

// Agents only ever see the router-derived wire secret. Tests treat that
// derived secret as opaque random bytes — the JWT signing test is unrelated to
// the derivation scheme.
const WIRE_SECRET = crypto.randomBytes(32);
const WIRE_SECRET_HEX = WIRE_SECRET.toString('hex');

const PROVIDER_PRINCIPAL = 'agent:AssistOSExplorer/dpuAgent';
const EXAMPLE_BODY = { tool: 'secret_put', arguments: { key: 'GIT_GITHUB_TOKEN', value: 'x' } };

function mintInvocationJwt(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: PROVIDER_PRINCIPAL,
        sub: 'user:local:admin',
        caller: 'agent:AssistOSExplorer/gitAgent',
        tool: 'secret_put',
        scope: ['secret:write'],
        bh: bodyHashForRequest(EXAMPLE_BODY),
        usr: { id: 'local:admin', username: 'admin', roles: ['local'] },
        jti: crypto.randomBytes(12).toString('base64url'),
        iat: now,
        exp: now + 60,
        ...overrides
    };
    return signHmacJwt({ payload, secret: WIRE_SECRET });
}

function makeEnv() {
    return {
        PLOINKY_AGENT_PRINCIPAL: PROVIDER_PRINCIPAL,
        PLOINKY_WIRE_SECRET: WIRE_SECRET_HEX
    };
}

test('verifyInvocationFromHeaders accepts valid HS256 invocation JWT', () => {
    const token = mintInvocationJwt();
    const result = verifyInvocationFromHeaders(
        { authorization: `Bearer ${token}` },
        EXAMPLE_BODY,
        { env: makeEnv(), replayCache: createMemoryReplayCache() }
    );
    assert.equal(result.ok, true);
    assert.equal(result.payload.caller, 'agent:AssistOSExplorer/gitAgent');
    assert.equal(result.payload.usr.username, 'admin');
    assert.deepEqual(result.payload.scope, ['secret:write']);
});

test('verifyInvocationFromHeaders rejects tampered body', () => {
    const token = mintInvocationJwt();
    const result = verifyInvocationFromHeaders(
        { authorization: `Bearer ${token}` },
        { tool: 'secret_put', arguments: { key: 'DIFFERENT', value: 'y' } },
        { env: makeEnv(), replayCache: createMemoryReplayCache() }
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /body hash mismatch/);
});

test('verifyInvocationFromHeaders rejects wrong audience', () => {
    const token = mintInvocationJwt({ aud: 'agent:AssistOSExplorer/otherAgent' });
    const result = verifyInvocationFromHeaders(
        { authorization: `Bearer ${token}` },
        EXAMPLE_BODY,
        { env: makeEnv(), replayCache: createMemoryReplayCache() }
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /audience mismatch/);
});

test('verifyInvocationFromHeaders rejects missing agent audience configuration', () => {
    const token = mintInvocationJwt();
    const result = verifyInvocationFromHeaders(
        { authorization: `Bearer ${token}` },
        EXAMPLE_BODY,
        { env: { PLOINKY_WIRE_SECRET: WIRE_SECRET_HEX }, replayCache: createMemoryReplayCache() }
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /PLOINKY_AGENT_PRINCIPAL or AGENT_NAME not configured/);
});

test('verifyInvocationFromHeaders rejects wrong tool when expectedTool is supplied', () => {
    const token = mintInvocationJwt();
    const result = verifyInvocationFromHeaders(
        { authorization: `Bearer ${token}` },
        EXAMPLE_BODY,
        { env: makeEnv(), replayCache: createMemoryReplayCache(), expectedTool: 'secret_get' }
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /tool mismatch/);
});
