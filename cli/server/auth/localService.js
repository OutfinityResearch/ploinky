import crypto from 'node:crypto';

import { resolveVarValue } from '../../services/secretVars.js';
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

function verifyPasswordHash(password, storedHash) {
    const raw = String(storedHash || '').trim();
    if (!raw) return false;

    if (raw.startsWith('sha256:')) {
        const expected = raw.slice('sha256:'.length).trim().toLowerCase();
        const actual = crypto.createHash('sha256').update(String(password || ''), 'utf8').digest('hex');
        return safeEqual(actual, expected);
    }

    if (raw.startsWith('scrypt:')) {
        const [, saltHex = '', keyHex = ''] = raw.split(':');
        if (!saltHex || !keyHex) return false;
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(keyHex, 'hex');
        const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
        return crypto.timingSafeEqual(actual, expected);
    }

    return false;
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

function authenticateLocalUser({ username, password, policy }) {
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
        tokens: null,
        expiresAt: now + sessionStore.sessionTtlMs
    });
    return { sessionId, user };
}

function getSession(sessionId) {
    return sessionStore.getSession(sessionId);
}

function revokeSession(sessionId) {
    sessionStore.deleteSession(sessionId);
}

function getSessionCookieMaxAge() {
    return Math.floor(sessionStore.sessionTtlMs / 1000);
}

export {
    authenticateLocalUser,
    getSession,
    getSessionCookieMaxAge,
    resolveLocalAuthConfig,
    revokeSession
};
