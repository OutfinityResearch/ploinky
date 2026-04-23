import crypto from 'node:crypto';

import { resolveVarValue, setEnvVar, ensurePersistentSecret } from '../../services/secretVars.js';
import { hashPassword, verifyPasswordHash } from '../../services/localAuthPasswords.js';
import { signHmacJwt } from '../../../Agent/lib/jwtSign.mjs';
import { verifyJws } from '../../../Agent/lib/jwtVerify.mjs';
import { createSessionStore } from './sessionStore.js';

const sessionStore = createSessionStore();

const SESSION_TTL_SECONDS = 4 * 60 * 60;

function getWireSecretBuffer() {
    return Buffer.from(ensurePersistentSecret('PLOINKY_WIRE_SECRET'), 'hex');
}

function mintSessionJwt(user, rev = 1, options = {}) {
    const usersVar = String(options?.usersVar || options?.policy?.usersVar || '').trim();
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'session',
        iss: 'ploinky-router',
        sub: String(user.id || ''),
        usr: {
            id: String(user.id || ''),
            username: String(user.username || ''),
            name: String(user.name || user.username || ''),
            email: String(user.email || ''),
            roles: Array.isArray(user.roles) ? [...user.roles] : ['local']
        },
        rev: Number(rev) || 1,
        uvar: usersVar || undefined,
        iat,
        exp: iat + SESSION_TTL_SECONDS,
        jti: crypto.randomBytes(16).toString('base64url')
    };
    return signHmacJwt({ payload, secret: getWireSecretBuffer() });
}

function verifySessionJwt(token) {
    const { payload } = verifyJws(token, {
        secret: getWireSecretBuffer(),
        maxTtlSeconds: SESSION_TTL_SECONDS + 1
    });
    if (payload.typ !== 'session') {
        throw new Error('Not a session JWT');
    }
    if (payload.iss !== 'ploinky-router') {
        throw new Error('Session JWT not issued by router');
    }
    return payload;
}

const GUEST_SESSION_TTL_SECONDS = 60 * 60;

function mintGuestSessionJwt() {
    const guestId = crypto.randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'session',
        iss: 'ploinky-router',
        sub: `user:guest:${guestId}`,
        usr: {
            id: `guest:${guestId}`,
            username: 'visitor',
            name: 'Guest',
            email: '',
            roles: ['guest']
        },
        rev: 0,
        iat,
        exp: iat + GUEST_SESSION_TTL_SECONDS,
        jti: crypto.randomBytes(16).toString('base64url')
    };
    return signHmacJwt({ payload, secret: getWireSecretBuffer() });
}

let revCache = null;
let revCacheTime = 0;
const REV_CACHE_TTL_MS = 30_000;

function resolveUserRev(usersVar, username) {
    const now = Date.now();
    if (!revCache || now - revCacheTime > REV_CACHE_TTL_MS) {
        revCache = new Map();
        revCacheTime = now;
    }
    const cacheKey = `${usersVar}:${username}`;
    if (revCache.has(cacheKey)) return revCache.get(cacheKey);
    const raw = readConfigValue(usersVar);
    if (!raw) return 1;
    try {
        const parsed = JSON.parse(raw);
        const users = Array.isArray(parsed?.users) ? parsed.users : [];
        const matched = users.find((u) => String(u.username || '').trim() === username);
        if (!matched) {
            revCache.set(cacheKey, 0);
            return 0;
        }
        const rev = Number(matched?.rev) || 1;
        revCache.set(cacheKey, rev);
        return rev;
    } catch {
        return 1;
    }
}

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

function normalizeRoles(input) {
    const raw = Array.isArray(input) ? input : [];
    const values = [];
    for (const entry of raw) {
        const normalized = String(entry || '').trim();
        if (normalized && !values.includes(normalized)) {
            values.push(normalized);
        }
    }
    if (!values.includes('local')) {
        values.unshift('local');
    }
    return values;
}

function normalizeLocalUserRecord(entry = {}) {
    const username = String(entry.username || entry.login || '').trim();
    const passwordHash = String(entry.passwordHash || '').trim();
    if (!username || !passwordHash) {
        return null;
    }
    const name = String(entry.name || username).trim() || username;
    const email = String(entry.email || '').trim() || null;
    return {
        id: String(entry.id || `local:${username}`).trim() || `local:${username}`,
        username,
        name,
        email,
        passwordHash,
        roles: normalizeRoles(entry.roles),
        rev: Number(entry.rev) || 1
    };
}

function parseUsersPayload(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        const users = Array.isArray(parsed?.users) ? parsed.users : [];
        return users
            .map((entry) => normalizeLocalUserRecord(entry))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function serializeUsersPayload(users = []) {
    return JSON.stringify({
        version: 1,
        users: users.map((entry) => ({
            id: entry.id,
            username: entry.username,
            name: entry.name,
            email: entry.email,
            passwordHash: entry.passwordHash,
            roles: normalizeRoles(entry.roles),
            rev: Number(entry.rev) || 1
        }))
    });
}

function resolveLocalAuthConfig(policy = {}) {
    const usersVar = String(policy.usersVar || '').trim();
    return {
        usersVar,
        users: parseUsersPayload(readConfigValue(usersVar))
    };
}

function serializeUserSummary(entry = {}) {
    return {
        id: String(entry.id || '').trim(),
        username: String(entry.username || '').trim(),
        name: String(entry.name || '').trim(),
        email: String(entry.email || '').trim() || null
    };
}

function authenticateLocalUser({ username, password, policy, routeKey = '' }) {
    const config = resolveLocalAuthConfig(policy);
    if (!config.usersVar || !config.users.length) {
        throw new Error('local_auth_not_configured');
    }
    const normalizedUsername = String(username || '').trim();
    const matchedUser = config.users.find((entry) => (
        safeEqual(entry.username, normalizedUsername)
        && verifyPasswordHash(password, entry.passwordHash)
    ));
    if (!matchedUser) {
        throw new Error('invalid_credentials');
    }

    const user = {
        id: matchedUser.id,
        username: matchedUser.username,
        name: matchedUser.name,
        email: matchedUser.email,
        roles: normalizeRoles(matchedUser.roles)
    };
    const sessionJwt = mintSessionJwt(user, matchedUser.rev || 1, { usersVar: config.usersVar });
    return { sessionId: sessionJwt, user };
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

function getSession(sessionId, options = {}) {
    if (!sessionId) return null;
    try {
        const payload = verifySessionJwt(sessionId);
        const usersVar = String(options?.usersVar || options?.policy?.usersVar || payload.uvar || '').trim();
        if (usersVar && payload.usr?.username) {
            const currentRev = resolveUserRev(usersVar, payload.usr.username);
            if (currentRev !== (payload.rev || 1)) {
                return null;
            }
        }
        return {
            id: sessionId,
            user: payload.usr ? {
                id: payload.usr.id || payload.sub,
                username: payload.usr.username,
                name: payload.usr.name || payload.usr.username,
                email: payload.usr.email || null,
                roles: Array.isArray(payload.usr.roles) ? payload.usr.roles : ['local']
            } : null,
            localAuth: { usersVar, username: payload.usr?.username || '' },
            createdAt: payload.iat * 1000,
            expiresAt: payload.exp * 1000,
            _jwtPayload: payload
        };
    } catch {
        return null;
    }
}

function revokeSession(sessionId) {
    sessionStore.deleteSession(sessionId);
}

function revokeSessionsForLocalPolicy(policy = {}) {
    const usersVar = String(policy.usersVar || '').trim();
    sessionStore.deleteSessionsWhere((session) => {
        const localAuth = session?.localAuth || {};
        return localAuth.usersVar === usersVar;
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
    if (!config.usersVar || !config.users.length) {
        throw new Error('local_auth_not_configured');
    }

    const normalizedCurrentPassword = String(currentPassword || '');
    if (!normalizedCurrentPassword) {
        throw new Error('current_password_required');
    }

    const sessionUsername = String(sessionUser?.username || '').trim();
    const currentUser = config.users.find((entry) => safeEqual(entry.username, sessionUsername));
    if (!currentUser) {
        throw new Error('session_stale');
    }

    const requestedUsername = String(
        nextUsername === undefined || nextUsername === null ? currentUser.username : nextUsername
    ).trim();
    if (!requestedUsername) {
        throw new Error('username_required');
    }

    if (!verifyPasswordHash(normalizedCurrentPassword, currentUser.passwordHash)) {
        throw new Error('invalid_credentials');
    }

    const normalizedNextPassword = String(nextPassword || '');
    const usernameChanged = !safeEqual(requestedUsername, currentUser.username);
    const passwordChanged = normalizedNextPassword.length > 0;

    if (!usernameChanged && !passwordChanged) {
        throw new Error('no_changes_requested');
    }

    if (usernameChanged && config.users.some((entry) => !safeEqual(entry.username, currentUser.username) && safeEqual(entry.username, requestedUsername))) {
        throw new Error('username_taken');
    }

    const nextUsers = config.users.map((entry) => {
        if (!safeEqual(entry.username, currentUser.username)) {
            return entry;
        }
        const nextRecord = {
            ...entry,
            username: requestedUsername,
            id: String(entry.id || `local:${requestedUsername}`).trim() || `local:${requestedUsername}`,
            name: safeEqual(String(entry.name || '').trim(), currentUser.username) ? requestedUsername : entry.name
        };
        if (safeEqual(String(nextRecord.id || '').trim(), `local:${currentUser.username}`)) {
            nextRecord.id = `local:${requestedUsername}`;
        }
        if (passwordChanged) {
            nextRecord.passwordHash = hashPassword(normalizedNextPassword);
            nextRecord.rev = (Number(entry.rev) || 1) + 1;
        }
        return nextRecord;
    });

    setEnvVar(config.usersVar, serializeUsersPayload(nextUsers));
    revCache = null;
    revCacheTime = 0;

    revokeSessionsForLocalPolicy(policy);

    return {
        username: requestedUsername,
        usernameChanged,
        passwordChanged
    };
}

function getSessionCookieMaxAge() {
    return SESSION_TTL_SECONDS;
}

function listLocalAuthUsers(policy = {}) {
    const config = resolveLocalAuthConfig(policy);
    if (!config.usersVar || !config.users.length) {
        return [];
    }
    return config.users.map((entry) => serializeUserSummary(entry));
}

export {
    authenticateLocalUser,
    createExternalSession,
    GUEST_SESSION_TTL_SECONDS,
    getSession,
    getSessionCookieMaxAge,
    listLocalAuthUsers,
    mintGuestSessionJwt,
    mintSessionJwt,
    resolveLocalAuthConfig,
    resolveUserRev,
    revokeSession,
    revokeSessionsForLocalPolicy,
    updateLocalCredentials,
    verifySessionJwt
};
