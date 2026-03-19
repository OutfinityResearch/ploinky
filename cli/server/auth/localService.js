import crypto from 'node:crypto';

import { resolveVarValue, setEnvVar } from '../../services/secretVars.js';
import { hashPassword, verifyPasswordHash } from '../../services/localAuthPasswords.js';
import { createSessionStore } from './sessionStore.js';

const sessionStore = createSessionStore();

function readConfigValue(name) {
    if (!name) return '';
    const secret = resolveVarValue(name);
    if (secret && String(secret).trim()) return String(secret).trim();
    const env = process.env[name];
    if (env && String(env).trim()) return String(env).trim();
    return '';
}

function safeEqual(left, right) {
    const leftBuf = Buffer.from(String(left || ''), 'utf8');
    const rightBuf = Buffer.from(String(right || ''), 'utf8');
    if (leftBuf.length !== rightBuf.length) return false;
    return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function resolveLocalAuthConfig(policy = {}) {
    const usernameVar = String(policy.userVar || '').trim();
    const passwordHashVar = String(policy.passwordHashVar || '').trim();
    return {
        usernameVar,
        passwordHashVar,
        username: readConfigValue(usernameVar),
        passwordHash: readConfigValue(passwordHashVar)
    };
}

function authenticateLocalUser({ username, password, policy, routeKey = '' }) {
    const config = resolveLocalAuthConfig(policy);
    if (!config.username || !config.passwordHash) {
        throw new Error('local_auth_not_configured');
    }
    if (!safeEqual(username, config.username) || !verifyPasswordHash(password, config.passwordHash)) {
        throw new Error('invalid_credentials');
    }

    const now = Date.now();
    const user = {
        id: `local:${config.username}`,
        username: config.username,
        name: config.username,
        email: null,
        roles: ['local']
    };
    const { id: sessionId } = sessionStore.createSession({
        user,
        localAuth: {
            routeKey: String(routeKey || '').trim(),
            userVar: config.usernameVar,
            passwordHashVar: config.passwordHashVar
        },
        tokens: null,
        expiresAt: now + sessionStore.sessionTtlMs
    });
    return { sessionId, user };
}

function createExternalSession({ user, routeKey = '', provider = 'external' } = {}) {
    const now = Date.now();
    const safeProvider = String(provider || 'external').trim() || 'external';
    const sourceUser = user && typeof user === 'object' ? user : {};
    const login = String(sourceUser.login || sourceUser.username || sourceUser.name || '').trim();
    const email = String(sourceUser.email || '').trim() || null;
    const safeUser = {
        id: String(sourceUser.id || `${safeProvider}:${login || 'user'}`).trim(),
        username: login || String(sourceUser.name || sourceUser.id || 'user').trim(),
        name: String(sourceUser.name || login || sourceUser.id || 'User').trim(),
        email,
        roles: [safeProvider]
    };
    const { id: sessionId } = sessionStore.createSession({
        user: safeUser,
        externalAuth: {
            provider: safeProvider,
            routeKey: String(routeKey || '').trim()
        },
        tokens: null,
        expiresAt: now + sessionStore.sessionTtlMs
    });
    return { sessionId, user: safeUser };
}

function getSession(sessionId) {
    return sessionStore.getSession(sessionId);
}

function revokeSession(sessionId) {
    sessionStore.deleteSession(sessionId);
}

function revokeSessionsForLocalPolicy(policy = {}) {
    const usernameVar = String(policy.userVar || '').trim();
    const passwordHashVar = String(policy.passwordHashVar || '').trim();
    sessionStore.deleteSessionsWhere((session) => {
        const localAuth = session?.localAuth || {};
        return localAuth.userVar === usernameVar && localAuth.passwordHashVar === passwordHashVar;
    });
}

function updateLocalCredentials({
    currentPassword,
    nextUsername,
    nextPassword = '',
    policy,
    sessionUser = null
}) {
    const config = resolveLocalAuthConfig(policy);
    if (!config.username || !config.passwordHash) {
        throw new Error('local_auth_not_configured');
    }

    const normalizedCurrentPassword = String(currentPassword || '');
    if (!normalizedCurrentPassword) {
        throw new Error('current_password_required');
    }

    const requestedUsername = String(
        nextUsername === undefined || nextUsername === null ? config.username : nextUsername
    ).trim();
    if (!requestedUsername) {
        throw new Error('username_required');
    }

    if (sessionUser?.username && !safeEqual(sessionUser.username, config.username)) {
        throw new Error('session_stale');
    }

    if (!verifyPasswordHash(normalizedCurrentPassword, config.passwordHash)) {
        throw new Error('invalid_credentials');
    }

    const normalizedNextPassword = String(nextPassword || '');
    const usernameChanged = !safeEqual(requestedUsername, config.username);
    const passwordChanged = normalizedNextPassword.length > 0;

    if (!usernameChanged && !passwordChanged) {
        throw new Error('no_changes_requested');
    }

    if (usernameChanged) {
        setEnvVar(config.usernameVar, requestedUsername);
    }
    if (passwordChanged) {
        setEnvVar(config.passwordHashVar, hashPassword(normalizedNextPassword));
    }

    revokeSessionsForLocalPolicy(policy);

    return {
        username: requestedUsername,
        usernameChanged,
        passwordChanged
    };
}

function getSessionCookieMaxAge() {
    return Math.floor(sessionStore.sessionTtlMs / 1000);
}

export {
    authenticateLocalUser,
    createExternalSession,
    getSession,
    getSessionCookieMaxAge,
    resolveLocalAuthConfig,
    revokeSession,
    revokeSessionsForLocalPolicy,
    updateLocalCredentials
};
