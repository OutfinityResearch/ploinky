import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

test('local auth credentials can update username and password and revoke the old session', async (t) => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'ploinky-local-auth-'));
    const ploinkyDir = path.join(workspace, '.ploinky');
    mkdirSync(ploinkyDir, { recursive: true });
    writeFileSync(path.join(ploinkyDir, '.secrets'), '');

    const previousCwd = process.cwd();
    process.chdir(workspace);
    t.after(() => {
        process.chdir(previousCwd);
        rmSync(workspace, { recursive: true, force: true });
    });

    const localService = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/server/auth/localService.js')).href}?test=${Date.now()}`);
    const secretVars = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/secretVars.js')).href}?test=${Date.now() + 1}`);
    const passwords = await import(`${pathToFileURL(path.join(REPO_ROOT, 'cli/services/localAuthPasswords.js')).href}?test=${Date.now() + 2}`);

    const policy = {
        usersVar: 'PLOINKY_AUTH_TEST_USERS'
    };

    secretVars.setEnvVar(policy.usersVar, JSON.stringify({
        version: 1,
        users: [
            {
                id: 'local:admin',
                username: 'admin',
                name: 'admin',
                email: null,
                passwordHash: passwords.hashPassword('adminpass'),
                roles: ['local']
            },
            {
                id: 'local:reviewer',
                username: 'reviewer',
                name: 'reviewer',
                email: null,
                passwordHash: passwords.hashPassword('reviewpass'),
                roles: ['local']
            }
        ]
    }));

    const login = localService.authenticateLocalUser({
        username: 'admin',
        password: 'adminpass',
        policy,
        routeKey: 'explorer'
    });

    assert.ok(login.sessionId, 'expected a local auth session id');
    assert.equal(localService.getSession(login.sessionId)?.user?.username, 'admin');

    const update = localService.updateLocalCredentials({
        currentPassword: 'adminpass',
        nextUsername: 'maintainer',
        nextPassword: 'newpass123',
        policy,
        sessionUser: login.user
    });

    assert.equal(update.username, 'maintainer');
    assert.equal(update.usernameChanged, true);
    assert.equal(update.passwordChanged, true);
    assert.equal(localService.getSession(login.sessionId), null, 'old session should be revoked');

    const secretsText = readFileSync(path.join(ploinkyDir, '.secrets'), 'utf8');
    assert.match(secretsText, /PLOINKY_AUTH_TEST_USERS=/);
    const storedUsers = JSON.parse(secretVars.resolveVarValue(policy.usersVar));
    const maintainer = storedUsers.users.find((entry) => entry.username === 'maintainer');
    const reviewer = storedUsers.users.find((entry) => entry.username === 'reviewer');
    assert.ok(maintainer);
    assert.ok(reviewer);
    assert.equal(passwords.verifyPasswordHash('newpass123', maintainer.passwordHash), true);
    assert.equal(passwords.verifyPasswordHash('adminpass', maintainer.passwordHash), false);
    assert.equal(passwords.verifyPasswordHash('reviewpass', reviewer.passwordHash), true);

    const relogin = localService.authenticateLocalUser({
        username: 'maintainer',
        password: 'newpass123',
        policy,
        routeKey: 'explorer'
    });
    assert.ok(relogin.sessionId, 'expected login with updated credentials to succeed');
});
