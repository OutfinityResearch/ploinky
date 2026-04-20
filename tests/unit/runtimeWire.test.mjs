import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    signCallerAssertion,
    signRouterToken
} from '../../Agent/lib/wireSign.mjs';
import { createMemoryReplayCache } from '../../Agent/lib/wireVerify.mjs';
import {
    verifyDirectAgentRequest,
    USER_CONTEXT_HEADER,
    CALLER_ASSERTION_HEADER
} from '../../Agent/lib/runtimeWire.mjs';

function ed25519Pair() {
    return crypto.generateKeyPairSync('ed25519');
}

function privatePem(pair) {
    return pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function publicJwk(pair) {
    return pair.publicKey.export({ format: 'jwk' });
}

test('verifyDirectAgentRequest accepts signed delegated agent call', () => {
    const caller = ed25519Pair();
    const router = ed25519Pair();
    const bodyObject = { tool: 'secret_put', arguments: { key: 'GIT_GITHUB_TOKEN', value: 'x' } };
    const userPayload = {
        iss: 'ploinky-router',
        aud: 'agent:AssistOSExplorer/gitAgent',
        sid: 'session-1',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: crypto.randomBytes(12).toString('base64url'),
        user: {
            id: 'user-1',
            username: 'alice',
            email: 'alice@example.com',
            roles: ['developer']
        }
    };
    const userContextToken = signRouterToken({
        payload: userPayload,
        privateKey: router.privateKey
    });
    const { token: callerAssertion } = signCallerAssertion({
        callerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        tool: 'secret_put',
        scope: ['secret:write'],
        audience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject,
        userContextToken,
        privatePem: privatePem(caller)
    });

    const env = {
        PLOINKY_AGENT_PRINCIPAL: 'agent:AssistOSExplorer/dpuAgent',
        PLOINKY_ROUTER_PUBLIC_KEY_JWK: JSON.stringify(publicJwk(router)),
        PLOINKY_AGENT_PUBLIC_KEYS_JSON: JSON.stringify({
            'agent:AssistOSExplorer/gitAgent': { publicKeyJwk: publicJwk(caller) }
        })
    };
    const result = verifyDirectAgentRequest({
        [CALLER_ASSERTION_HEADER]: callerAssertion,
        [USER_CONTEXT_HEADER]: userContextToken
    }, bodyObject, {
        env,
        callerReplayCache: createMemoryReplayCache()
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload.sub, 'agent:AssistOSExplorer/gitAgent');
    assert.deepEqual(result.payload.scope, ['secret:write']);
    assert.equal(result.payload.user.username, 'alice');
    assert.equal(result.payload.user_context_token, userContextToken);
});

test('verifyDirectAgentRequest rejects tampered body', () => {
    const caller = ed25519Pair();
    const router = ed25519Pair();
    const signedBody = { tool: 'secret_get', arguments: { key: 'GIT_GITHUB_TOKEN' } };
    const actualBody = { tool: 'secret_get', arguments: { key: 'OTHER_TOKEN' } };
    const userPayload = {
        iss: 'ploinky-router',
        aud: 'agent:AssistOSExplorer/gitAgent',
        sid: 'session-2',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: crypto.randomBytes(12).toString('base64url'),
        user: {
            id: 'user-2',
            username: 'bob',
            email: 'bob@example.com',
            roles: ['developer']
        }
    };
    const userContextToken = signRouterToken({
        payload: userPayload,
        privateKey: router.privateKey
    });
    const { token: callerAssertion } = signCallerAssertion({
        callerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        tool: 'secret_get',
        scope: ['secret:read'],
        audience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject: signedBody,
        userContextToken,
        privatePem: privatePem(caller)
    });

    const env = {
        PLOINKY_AGENT_PRINCIPAL: 'agent:AssistOSExplorer/dpuAgent',
        PLOINKY_ROUTER_PUBLIC_KEY_JWK: JSON.stringify(publicJwk(router)),
        PLOINKY_AGENT_PUBLIC_KEYS_JSON: JSON.stringify({
            'agent:AssistOSExplorer/gitAgent': { publicKeyJwk: publicJwk(caller) }
        })
    };
    const result = verifyDirectAgentRequest({
        [CALLER_ASSERTION_HEADER]: callerAssertion,
        [USER_CONTEXT_HEADER]: userContextToken
    }, actualBody, {
        env,
        callerReplayCache: createMemoryReplayCache()
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /body_hash mismatch/);
});

test('verifyDirectAgentRequest rejects user context minted for a different caller agent', () => {
    const caller = ed25519Pair();
    const router = ed25519Pair();
    const bodyObject = { tool: 'secret_get', arguments: { key: 'GIT_GITHUB_TOKEN' } };
    const userPayload = {
        iss: 'ploinky-router',
        aud: 'agent:otherAgent',
        sid: 'session-3',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        jti: crypto.randomBytes(12).toString('base64url'),
        user: {
            id: 'user-3',
            username: 'charlie',
            email: 'charlie@example.com',
            roles: ['developer']
        }
    };
    const userContextToken = signRouterToken({
        payload: userPayload,
        privateKey: router.privateKey
    });
    const { token: callerAssertion } = signCallerAssertion({
        callerPrincipal: 'agent:AssistOSExplorer/gitAgent',
        tool: 'secret_get',
        scope: ['secret:read'],
        audience: 'agent:AssistOSExplorer/dpuAgent',
        bodyObject,
        userContextToken,
        privatePem: privatePem(caller)
    });

    const env = {
        PLOINKY_AGENT_PRINCIPAL: 'agent:AssistOSExplorer/dpuAgent',
        PLOINKY_ROUTER_PUBLIC_KEY_JWK: JSON.stringify(publicJwk(router)),
        PLOINKY_AGENT_PUBLIC_KEYS_JSON: JSON.stringify({
            'agent:AssistOSExplorer/gitAgent': { publicKeyJwk: publicJwk(caller) }
        })
    };
    const result = verifyDirectAgentRequest({
        [CALLER_ASSERTION_HEADER]: callerAssertion,
        [USER_CONTEXT_HEADER]: userContextToken
    }, bodyObject, {
        env,
        callerReplayCache: createMemoryReplayCache()
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /audience mismatch/);
});
