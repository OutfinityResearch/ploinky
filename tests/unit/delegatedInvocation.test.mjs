import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { signHmacJwt, bodyHashForRequest } from '../../Agent/lib/jwtSign.mjs';
import { deriveDerivedMasterKey } from '../../cli/services/masterKey.js';

const MASTER = crypto.randomBytes(32);
const ORIGINAL_BODY = { tool: 'git_auth_status', arguments: {} };

function mintCallerInvocationJwt(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'invocation',
        iss: 'ploinky-router',
        aud: 'agent:AchillesIDE/gitAgent',
        sub: 'user:local:admin',
        caller: 'router:first-party',
        tool: 'git_auth_status',
        scope: ['secret:read'],
        bh: bodyHashForRequest(ORIGINAL_BODY),
        usr: { id: 'local:admin', username: 'admin', roles: ['local'] },
        jti: 'delegated-reuse-test',
        iat: now,
        exp: now + 60,
        ...overrides
    };
    // The router signs with the derived master key, so the caller JWT this
    // test feeds in must use the same derived subkey.
    return signHmacJwt({ payload, secret: deriveDerivedMasterKey() });
}

test('verifyDelegatedToolCall allows one caller invocation JWT to mint multiple delegated calls', async () => {
    const oldMasterKey = process.env.PLOINKY_MASTER_KEY;
    const oldDerivedMasterKey = process.env.PLOINKY_DERIVED_MASTER_KEY;
    process.env.PLOINKY_MASTER_KEY = MASTER.toString('hex');
    delete process.env.PLOINKY_DERIVED_MASTER_KEY;
    try {
        const { verifyDelegatedToolCall } = await import(`../../cli/server/mcp-proxy/invocationMinter.js?test=${Date.now()}`);
        const callerJwt = mintCallerInvocationJwt();
        const first = verifyDelegatedToolCall({
            providerPrincipal: 'agent:AchillesIDE/dpuAgent',
            callerJwt
        });
        const second = verifyDelegatedToolCall({
            providerPrincipal: 'agent:AchillesIDE/dpuAgent',
            callerJwt
        });
        assert.equal(first.providerPrincipal, 'agent:AchillesIDE/dpuAgent');
        assert.equal(first.callerPrincipal, 'agent:AchillesIDE/gitAgent');
        assert.equal(second.providerPrincipal, first.providerPrincipal);
        assert.equal(second.callerPrincipal, first.callerPrincipal);
        assert.deepEqual(second.user, first.user);
    } finally {
        if (oldMasterKey === undefined) {
            delete process.env.PLOINKY_MASTER_KEY;
        } else {
            process.env.PLOINKY_MASTER_KEY = oldMasterKey;
        }
        if (oldDerivedMasterKey === undefined) {
            delete process.env.PLOINKY_DERIVED_MASTER_KEY;
        } else {
            process.env.PLOINKY_DERIVED_MASTER_KEY = oldDerivedMasterKey;
        }
    }
});
