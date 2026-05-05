import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlainAuthInfoHeader } from '../../cli/server/routerHandlers.js';

test('protected HTTP service auth info carries router invocation token', () => {
    const headers = buildPlainAuthInfoHeader({
        user: {
            id: 'local:admin',
            username: 'admin',
            email: 'admin@example.com',
            roles: ['admin']
        },
        sessionId: 'session-1'
    }, {
        token: 'router-issued-invocation'
    });

    const authInfo = JSON.parse(headers['x-ploinky-auth-info']);

    assert.deepEqual(authInfo.user, {
        id: 'local:admin',
        username: 'admin',
        email: 'admin@example.com',
        roles: ['admin']
    });
    assert.equal(authInfo.sessionId, 'session-1');
    assert.equal(authInfo.invocationToken, 'router-issued-invocation');
});
