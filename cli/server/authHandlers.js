import { appendLog } from './utils/logger.js';
import { parseCookies, buildCookie, readJsonBody, appendSetCookie } from './handlers/common.js';
import { resolveVarValue } from '../services/secretVars.js';
import { createAuthService } from './auth/service.js';
import { decodeJwt, verifySignature, validateClaims } from './auth/jwt.js';
import { createJwksCache } from './auth/jwksCache.js';
import { loadAuthConfig } from './auth/config.js';
import { createMetadataCache } from './auth/keycloakClient.js';

const AUTH_COOKIE_NAME = 'ploinky_sso';
const authService = createAuthService();
const jwksCache = createJwksCache();
const agentMetadataCache = createMetadataCache();

export function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body || {});
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(payload);
}

function getRequestBaseUrl(req) {
    const headers = req.headers || {};
    const forwardedProto = headers['x-forwarded-proto'];
    const forwardedHost = headers['x-forwarded-host'] || headers['host'];
    const proto = forwardedProto
        ? String(forwardedProto).split(',')[0].trim()
        : (req.socket && req.socket.encrypted ? 'https' : 'http');
    if (!forwardedHost) return null;
    return `${proto}://${forwardedHost}`;
}

function wantsJsonResponse(req, pathname) {
    const accept = String(req.headers?.accept || '').toLowerCase();
    if (accept.includes('application/json')) return true;
    if (accept.includes('text/event-stream')) return true;
    if (!pathname) return false;
    return pathname.startsWith('/apis/') || pathname.startsWith('/api/') || pathname.startsWith('/blobs');
}

function respondUnauthenticated(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    const returnTo = parsedUrl.path || pathname || '/';
    const loginUrl = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    const clearCookie = buildCookie(AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0 });
    const method = (req.method || 'GET').toUpperCase();
    const wantsJson = wantsJsonResponse(req, pathname) || method !== 'GET';
    if (wantsJson) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookie
        });
        res.end(JSON.stringify({ ok: false, error: 'not_authenticated', login: loginUrl }));
    } else {
        res.writeHead(302, {
            Location: loginUrl,
            'Set-Cookie': clearCookie
        });
        res.end('Authentication required');
    }
    return { ok: false };
}

export function buildIdentityHeaders(req) {
    if (!req || !req.user) return {};
    const headers = {};
    const user = req.user || {};
    if (user.id) headers['X-Ploinky-User-Id'] = String(user.id);
    const name = user.username || user.email || user.name || user.id;
    if (name) headers['X-Ploinky-User'] = String(name);
    if (user.email) headers['X-Ploinky-User-Email'] = String(user.email);
    if (Array.isArray(user.roles) && user.roles.length) {
        headers['X-Ploinky-User-Roles'] = user.roles.join(',');
    }
    if (req.sessionId) headers['X-Ploinky-Session-Id'] = String(req.sessionId);
    if (req.session?.tokens?.accessToken) {
        headers['Authorization'] = `Bearer ${req.session.tokens.accessToken}`;
    }
    return headers;
}

export async function ensureAgentAuthenticated(req, res, parsedUrl) {
    if (!authService.isConfigured()) {
        return { ok: false, error: 'sso_not_configured' };
    }
    
    const authHeader = req.headers?.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
        return { ok: false, error: 'missing_authorization_header' };
    }
    
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
        return { ok: false, error: 'invalid_authorization_header' };
    }
    
    const token = bearerMatch[1];
    
    try {
        // Decode token
        const decoded = decodeJwt(token);
        
        // Get Keycloak config and metadata
        const config = loadAuthConfig();
        if (!config) {
            return { ok: false, error: 'sso_not_configured' };
        }
        
        // Get metadata for JWKS URI
        const metadata = await agentMetadataCache.get(config);
        
        // Verify signature
        const jwk = await jwksCache.getKey(metadata.jwks_uri, decoded.header.kid);
        if (!jwk) {
            return { ok: false, error: 'unable_to_resolve_signing_key' };
        }
        
        const signatureValid = verifySignature(decoded, jwk);
        if (!signatureValid) {
            return { ok: false, error: 'invalid_token_signature' };
        }
        
        // Validate claims
        validateClaims(decoded.payload, {
            issuer: metadata.issuer
        });
        
        // Extract agent information
        const agentName = decoded.payload.agent_name || 'unknown';
        const allowedTargets = decoded.payload.allowed_targets || [];
        
        req.agent = {
            name: agentName,
            clientId: decoded.payload.client_id || decoded.payload.aud,
            allowedTargets: Array.isArray(allowedTargets) ? allowedTargets : []
        };
        
        return { ok: true, agent: req.agent };
    } catch (err) {
        appendLog('auth_agent_token_validation_error', { error: err?.message || String(err) });
        return { ok: false, error: 'token_validation_failed', detail: err?.message || String(err) };
    }
}

export async function ensureAuthenticated(req, res, parsedUrl) {
    if (!authService.isConfigured()) {
        return { ok: true };
    }
    const cookies = parseCookies(req);
    const sessionId = cookies.get(AUTH_COOKIE_NAME);
    if (!sessionId) {
        appendLog('auth_missing_cookie', { path: parsedUrl.pathname });
        return respondUnauthenticated(req, res, parsedUrl);
    }
    let session = authService.getSession(sessionId);
    if (!session || (session.expiresAt && Date.now() > session.expiresAt)) {
        try {
            await authService.refreshSession(sessionId);
        } catch (err) {
            appendLog('auth_refresh_failed', { error: err?.message || String(err) });
        }
        session = authService.getSession(sessionId);
    }
    if (!session) {
        appendLog('auth_session_invalid', { sessionId: '[redacted]' });
        return respondUnauthenticated(req, res, parsedUrl);
    }
    req.user = session.user;
    req.session = session;
    req.sessionId = sessionId;
    try {
        const cookie = buildCookie(AUTH_COOKIE_NAME, sessionId, req, '/', {
            maxAge: authService.getSessionCookieMaxAge()
        });
        appendSetCookie(res, cookie);
    } catch (_) { }
    return { ok: true, session };
}

export async function handleAuthRoutes(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    if (!pathname.startsWith('/auth/')) return false;
    if (!authService.isConfigured()) {
        sendJson(res, 503, { ok: false, error: 'sso_disabled' });
        return true;
    }
    const method = (req.method || 'GET').toUpperCase();
    const baseUrl = getRequestBaseUrl(req);
    try {
        if (pathname === '/auth/login') {
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            const returnTo = parsedUrl.searchParams.get('returnTo') || '/';
            const prompt = parsedUrl.searchParams.get('prompt') || undefined;
            const { redirectUrl } = await authService.beginLogin({ baseUrl, returnTo, prompt });
            res.writeHead(302, { Location: redirectUrl });
            res.end('Redirecting to identity provider...');
            appendLog('auth_login_redirect', { returnTo });
            return true;
        }
        if (pathname === '/auth/callback') {
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            const code = parsedUrl.searchParams.get('code') || '';
            const state = parsedUrl.searchParams.get('state') || '';
            if (!code || !state) {
                sendJson(res, 400, { ok: false, error: 'missing_parameters' });
                return true;
            }
            const result = await authService.handleCallback({ code, state, baseUrl });
            const cookie = buildCookie(AUTH_COOKIE_NAME, result.sessionId, req, '/', {
                maxAge: authService.getSessionCookieMaxAge()
            });
            res.writeHead(302, {
                Location: result.redirectTo || '/',
                'Set-Cookie': cookie
            });
            res.end('Login successful');
            appendLog('auth_callback_success', { user: result.user?.id });
            return true;
        }
        if (pathname === '/auth/logout') {
            if (method !== 'GET' && method !== 'POST') {
                res.writeHead(405); res.end(); return true;
            }
            const cookies = parseCookies(req);
            const sessionId = cookies.get(AUTH_COOKIE_NAME) || '';
            const outcome = await authService.logout(sessionId, { baseUrl });
            const clearCookie = buildCookie(AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0 });
            const redirectTarget = parsedUrl.searchParams.get('returnTo') || outcome.redirect;
            if (method === 'GET' || redirectTarget) {
                res.writeHead(302, {
                    Location: redirectTarget || '/',
                    'Set-Cookie': clearCookie
                });
                res.end('Logged out');
            } else {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': clearCookie
                });
                res.end(JSON.stringify({ ok: true }));
            }
            appendLog('auth_logout', { sessionId: sessionId ? '[redacted]' : null });
            return true;
        }
        if (pathname === '/auth/token') {
            if (method !== 'GET' && method !== 'POST') {
                res.writeHead(405); res.end(); return true;
            }
            const cookies = parseCookies(req);
            const sessionId = cookies.get(AUTH_COOKIE_NAME);
            if (!sessionId) {
                sendJson(res, 401, { ok: false, error: 'not_authenticated' });
                return true;
            }
            const session = authService.getSession(sessionId);
            if (!session) {
                const clearCookie = buildCookie(AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0 });
                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': clearCookie
                });
                res.end(JSON.stringify({ ok: false, error: 'session_expired' }));
                return true;
            }
            let refreshRequested = false;
            if (method === 'POST') {
                try {
                    const body = await readJsonBody(req);
                    refreshRequested = Boolean(body?.refresh);
                } catch (_) { }
            }
            let tokenInfo;
            if (refreshRequested) {
                tokenInfo = await authService.refreshSession(sessionId);
            } else {
                tokenInfo = {
                    accessToken: session.tokens.accessToken,
                    expiresAt: session.expiresAt,
                    scope: session.tokens.scope,
                    tokenType: session.tokens.tokenType
                };
            }
            const cookie = buildCookie(AUTH_COOKIE_NAME, sessionId, req, '/', {
                maxAge: authService.getSessionCookieMaxAge()
            });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': cookie
            });
            res.end(JSON.stringify({ ok: true, token: tokenInfo, user: session.user }));
            return true;
        }
        if (pathname === '/auth/agent-token') {
            if (method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
                res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                return true;
            }
            try {
                const body = await readJsonBody(req);
                const clientId = body?.client_id || body?.clientId;
                const clientSecret = body?.client_secret || body?.clientSecret;
                
                if (!clientId || !clientSecret) {
                    sendJson(res, 400, { ok: false, error: 'missing_parameters', detail: 'client_id and client_secret required' });
                    return true;
                }
                
                const result = await authService.authenticateAgent(clientId, clientSecret);
                appendLog('auth_agent_token_success', { agent: result.agent.name });
                
                sendJson(res, 200, {
                    ok: true,
                    access_token: result.tokens.accessToken,
                    expires_in: result.tokens.expiresIn,
                    token_type: result.tokens.tokenType
                });
                return true;
            } catch (err) {
                appendLog('auth_agent_token_error', { error: err?.message || String(err) });
                sendJson(res, 401, { ok: false, error: 'invalid_credentials', detail: err?.message || String(err) });
                return true;
            }
        }
    } catch (err) {
        appendLog('auth_error', { error: err?.message || String(err) });
        sendJson(res, 500, { ok: false, error: 'auth_failure', detail: err?.message || String(err) });
        return true;
    }
    res.writeHead(404); res.end('Not Found');
    return true;
}

export function getAppName() {
    const secretName = resolveVarValue('APP_NAME');
    const fromSecrets = secretName && String(secretName).trim();
    if (fromSecrets) return fromSecrets;
    const raw = process.env.APP_NAME;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed.length ? trimmed : null;
}

export { AUTH_COOKIE_NAME, authService };
