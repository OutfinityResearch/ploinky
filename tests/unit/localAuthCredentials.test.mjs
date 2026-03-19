import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = '/Users/adrianganga/Desktop/devWork/ploinky';

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
        userVar: 'PLOINKY_AUTH_TEST_USER',
        passwordHashVar: 'PLOINKY_AUTH_TEST_PASSWORD_HASH'
    };

    secretVars.setEnvVar(policy.userVar, 'admin');
    secretVars.setEnvVar(policy.passwordHashVar, passwords.hashPassword('adminpass'));

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
    assert.match(secretsText, /PLOINKY_AUTH_TEST_USER=maintainer/);
    const storedHash = secretVars.resolveVarValue(policy.passwordHashVar);
    assert.equal(passwords.verifyPasswordHash('newpass123', storedHash), true);
    assert.equal(passwords.verifyPasswordHash('adminpass', storedHash), false);

    const relogin = localService.authenticateLocalUser({
        username: 'maintainer',
        password: 'newpass123',
        policy,
        routeKey: 'explorer'
    });
    assert.ok(relogin.sessionId, 'expected login with updated credentials to succeed');
});
