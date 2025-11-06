import { loadAuthConfig } from './config.js';
import { createPkcePair } from './pkce.js';
import { decodeJwt, verifySignature, validateClaims } from './jwt.js';
import { createJwksCache } from './jwksCache.js';
import { createSessionStore } from './sessionStore.js';
import { createMetadataCache, buildAuthUrl, exchangeCodeForTokens, exchangeClientCredentials, refreshTokens, buildLogoutUrl } from './keycloakClient.js';
import { randomId } from './utils.js';

function createAuthService(options = {}) {
    const sessionStore = createSessionStore(options.sessionOptions);
    const metadataCache = createMetadataCache();
    const jwksCache = createJwksCache();
    let config = loadAuthConfig();
    let lastConfigHash = null;

    function getConfigHash(cfg) {
        if (!cfg) return null;
        return JSON.stringify({
            baseUrl: cfg.baseUrl,
            realm: cfg.realm,
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret, // CRITICAL: Must include to detect changes
            redirectUri: cfg.redirectUri,
            postLogoutRedirectUri: cfg.postLogoutRedirectUri,
            scope: cfg.scope
        });
    }

    function reloadConfig() {
        config = loadAuthConfig();
        metadataCache.clear();
        jwksCache.clear();
        lastConfigHash = getConfigHash(config);
    }

    function assertConfigured() {
        // Check if config needs reload (on first call or if env vars changed)
        const freshConfig = loadAuthConfig();
        const freshHash = getConfigHash(freshConfig);
        
        if (freshHash !== lastConfigHash) {
            config = freshConfig;
            metadataCache.clear();
            jwksCache.clear();
            lastConfigHash = freshHash;
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
        
        // Extract roles from ACCESS token (not ID token) - roles are in the access token
        const accessDecoded = tokens.access_token ? decodeJwt(tokens.access_token) : decoded;
        
        if (process.env.PLOINKY_DEBUG === '1' || process.env.WEBTTY_DEBUG === '1') {
            console.log('[auth] Token decoded:', {
                hasAccessToken: !!tokens.access_token,
                realmAccessExists: !!accessDecoded.payload.realm_access,
                resourceAccessExists: !!accessDecoded.payload.resource_access
            });
        }
        
        const realmRoles = accessDecoded.payload.realm_access?.roles || [];
        const resourceRoles = [];
        
        // Check for client-specific roles in resource_access
        if (accessDecoded.payload.resource_access) {
            for (const [clientId, clientData] of Object.entries(accessDecoded.payload.resource_access)) {
                if (Array.isArray(clientData.roles)) {
                    resourceRoles.push(...clientData.roles);
                }
            }
        }
        
        // Combine realm and client roles, removing duplicates
        const allRoles = [...new Set([...realmRoles, ...resourceRoles])];
        
        const user = {
            id: decoded.payload.sub,
            username: decoded.payload.preferred_username || decoded.payload.username || decoded.payload.email || '',
            name: decoded.payload.name || decoded.payload.preferred_username || decoded.payload.email || '',
            email: decoded.payload.email || null,
            roles: allRoles,
            raw: decoded.payload
        };
        
        // Debug: Log what roles we found
        if (process.env.PLOINKY_DEBUG === '1' || process.env.WEBTTY_DEBUG === '1') {
            console.log('[auth] SSO user roles:', {
                username: user.username,
                realmRoles: realmRoles.length,
                clientRoles: resourceRoles.length,
                totalRoles: allRoles.length,
                roles: allRoles
            });
        }
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

    async function authenticateAgent(clientId, clientSecret) {
        const cfg = assertConfigured();
        const metadata = await ensureMetadata();
        
        // Exchange client credentials for token
        const tokens = await exchangeClientCredentials(metadata, cfg, {
            clientId,
            clientSecret,
            scope: cfg.scope
        });
        
        if (!tokens || !tokens.access_token) {
            throw new Error('Token response missing access_token');
        }
        
        // Decode and validate token
        const decoded = decodeJwt(tokens.access_token);
        const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
        if (!jwk) {
            throw new Error('Unable to resolve signing key');
        }
        
        const signatureValid = verifySignature(decoded, jwk);
        if (!signatureValid) {
            throw new Error('Invalid token signature');
        }
        
        // Validate claims
        validateClaims(decoded.payload, {
            issuer: metadata.issuer
        });
        
        // Extract agent information from token claims
        const agentName = decoded.payload.agent_name || clientId.replace(/^agent-/, '');
        const allowedTargets = decoded.payload.allowed_targets || [];
        
        const now = Date.now();
        const expiresAt = decoded.payload.exp ? decoded.payload.exp * 1000 : (now + 3600000);
        
        return {
            agent: {
                name: agentName,
                clientId,
                allowedTargets: Array.isArray(allowedTargets) ? allowedTargets : []
            },
            tokens: {
                accessToken: tokens.access_token,
                tokenType: tokens.token_type || 'Bearer',
                expiresIn: tokens.expires_in
            },
            expiresAt
        };
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
        getSessionCookieMaxAge,
        authenticateAgent
    };
}

export { createAuthService };
