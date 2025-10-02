import { loadAuthConfig } from './config.js';
import { createPkcePair } from './pkce.js';
import { decodeJwt, verifySignature, validateClaims } from './jwt.js';
import { createJwksCache } from './jwksCache.js';
import { createSessionStore } from './sessionStore.js';
import { createMetadataCache, buildAuthUrl, exchangeCodeForTokens, refreshTokens, buildLogoutUrl } from './keycloakClient.js';
import { randomId } from './utils.js';

function createAuthService(options = {}) {
    const sessionStore = createSessionStore(options.sessionOptions);
    const metadataCache = createMetadataCache();
    const jwksCache = createJwksCache();
    let config = loadAuthConfig();

    function reloadConfig() {
        config = loadAuthConfig();
        metadataCache.clear();
        jwksCache.clear();
    }

    function assertConfigured() {
        if (!config) {
            reloadConfig();
        }
        if (!config) {
            throw new Error('SSO is not configured');
        }
        return config;
    }

    async function ensureMetadata() {
        const cfg = assertConfigured();
        return metadataCache.get(cfg);
    }

    function resolveRedirectUri(baseUrl) {
        const cfg = assertConfigured();
        if (cfg.redirectUri) return cfg.redirectUri;
        if (!baseUrl) throw new Error('Redirect URI missing');
        return `${baseUrl.replace(/\/$/, '')}/auth/callback`;
    }

    function resolvePostLogoutUri(baseUrl) {
        const cfg = assertConfigured();
        if (cfg.postLogoutRedirectUri) return cfg.postLogoutRedirectUri;
        if (!baseUrl) return undefined;
        return `${baseUrl.replace(/\/$/, '')}/`;
    }

    async function beginLogin({ baseUrl, returnTo = '/', prompt } = {}) {
        const cfg = assertConfigured();
        const metadata = await ensureMetadata();
        const { verifier, challenge } = createPkcePair();
        const nonce = randomId(16);
        const redirectUri = resolveRedirectUri(baseUrl);
        const state = sessionStore.createPendingAuth({
            codeVerifier: verifier,
            redirectUri,
            returnTo,
            nonce
        });
        const authUrl = buildAuthUrl(metadata, cfg, {
            state,
            codeChallenge: challenge,
            redirectUri,
            scope: cfg.scope,
            nonce,
            prompt
        });
        return { redirectUrl: authUrl, state };
    }

    async function handleCallback({ code, state, baseUrl }) {
        const cfg = assertConfigured();
        const pending = sessionStore.consumePendingAuth(state);
        if (!pending) {
            throw new Error('Invalid or expired authorization state');
        }
        const metadata = await ensureMetadata();
        const tokens = await exchangeCodeForTokens(metadata, cfg, {
            code,
            redirectUri: pending.redirectUri,
            codeVerifier: pending.codeVerifier
        });
        if (!tokens || !tokens.id_token) {
            throw new Error('Token response missing id_token');
        }
        const decoded = decodeJwt(tokens.id_token);
        const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
        if (!jwk) {
            throw new Error('Unable to resolve signing key');
        }
        const signatureValid = verifySignature(decoded, jwk);
        if (!signatureValid) {
            throw new Error('Invalid token signature');
        }
        validateClaims(decoded.payload, {
            issuer: metadata.issuer,
            clientId: cfg.clientId,
            nonce: pending.nonce
        });
        const now = Date.now();
        const accessExpires = tokens.expires_in ? now + Number(tokens.expires_in) * 1000 : now + sessionStore.sessionTtlMs;
        const refreshExpires = tokens.refresh_expires_in ? now + Number(tokens.refresh_expires_in) * 1000 : null;
        const user = {
            id: decoded.payload.sub,
            username: decoded.payload.preferred_username || decoded.payload.username || decoded.payload.email || '',
            name: decoded.payload.name || decoded.payload.preferred_username || decoded.payload.email || '',
            email: decoded.payload.email || null,
            roles: decoded.payload.realm_access?.roles || [],
            raw: decoded.payload
        };
        const { id: sessionId } = sessionStore.createSession({
            user,
            tokens: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                idToken: tokens.id_token,
                scope: tokens.scope,
                tokenType: tokens.token_type
            },
            expiresAt: accessExpires,
            refreshExpiresAt: refreshExpires
        });
        const redirectTo = pending.returnTo || '/';
        const postLogoutRedirectUri = resolvePostLogoutUri(baseUrl);
        return { sessionId, user, redirectTo, postLogoutRedirectUri, tokens: {
            accessToken: tokens.access_token,
            expiresAt: accessExpires
        }};
    }

    function getSession(sessionId) {
        return sessionStore.getSession(sessionId);
    }

    async function refreshSession(sessionId) {
        const cfg = assertConfigured();
        const metadata = await ensureMetadata();
        const session = sessionStore.getSession(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        if (!session.tokens.refreshToken) {
            throw new Error('Refresh token not available');
        }
        const tokens = await refreshTokens(metadata, cfg, session.tokens.refreshToken);
        const now = Date.now();
        const accessExpires = tokens.expires_in ? now + Number(tokens.expires_in) * 1000 : now + sessionStore.sessionTtlMs;
        const refreshExpires = tokens.refresh_expires_in ? now + Number(tokens.refresh_expires_in) * 1000 : session.refreshExpiresAt;
        sessionStore.updateSession(sessionId, {
            tokens: {
                accessToken: tokens.access_token || session.tokens.accessToken,
                refreshToken: tokens.refresh_token || session.tokens.refreshToken,
                idToken: tokens.id_token || session.tokens.idToken,
                scope: tokens.scope || session.tokens.scope,
                tokenType: tokens.token_type || session.tokens.tokenType
            },
            expiresAt: accessExpires,
            refreshExpiresAt: refreshExpires
        });
        return {
            accessToken: tokens.access_token || session.tokens.accessToken,
            expiresAt: accessExpires,
            scope: tokens.scope || session.tokens.scope,
            tokenType: tokens.token_type || session.tokens.tokenType
        };
    }

    async function logout(sessionId, { baseUrl } = {}) {
        const cfg = assertConfigured();
        const metadata = await ensureMetadata();
        const session = sessionStore.getSession(sessionId);
        if (session) {
            sessionStore.deleteSession(sessionId);
        }
        if (!session) {
            return { redirect: resolvePostLogoutUri(baseUrl) };
        }
        const logoutUrl = buildLogoutUrl(metadata, cfg, {
            idTokenHint: session.tokens.idToken,
            postLogoutRedirectUri: resolvePostLogoutUri(baseUrl)
        });
        return { redirect: logoutUrl || resolvePostLogoutUri(baseUrl) };
    }

    function revokeSession(sessionId) {
        sessionStore.deleteSession(sessionId);
    }

    function isConfigured() {
        if (!config) {
            config = loadAuthConfig();
        }
        return Boolean(config);
    }

    function getSessionCookieMaxAge() {
        return Math.floor(sessionStore.sessionTtlMs / 1000);
    }

    return {
        isConfigured,
        reloadConfig,
        beginLogin,
        handleCallback,
        getSession,
        refreshSession,
        logout,
        revokeSession,
        getSessionCookieMaxAge
    };
}

export { createAuthService };
