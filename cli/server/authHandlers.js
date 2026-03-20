import fs from 'fs';
import path from 'path';

import { appendLog } from './utils/logger.js';
import { parseCookies, buildCookie, readJsonBody, appendSetCookie } from './handlers/common.js';
import { resolveVarValue } from '../services/secretVars.js';
import { resolveEnabledAgentRecord } from '../services/agents.js';
import { createAuthService } from './auth/service.js';
import { decodeJwt, verifySignature, validateClaims } from './auth/jwt.js';
import { createJwksCache } from './auth/jwksCache.js';
import { loadAuthConfig } from './auth/config.js';
import { createMetadataCache } from './auth/keycloakClient.js';
import { authenticateLocalUser, createExternalSession, getSession as getLocalSession, getSessionCookieMaxAge as getLocalSessionCookieMaxAge, resolveLocalAuthConfig, revokeSession as revokeLocalSession, updateLocalCredentials } from './auth/localService.js';
import { loadGithubAuthConfig, getGithubAuthStatus, beginGithubDeviceFlow, pollGithubDeviceFlow, beginGithubLogin, finishGithubLogin, saveGithubSession, disconnectGithubSession, clearGithubSession } from './auth/githubAuthService.js';
import { saveGithubAuthSetup } from '../services/githubAuth.js';

const SSO_AUTH_COOKIE_NAME = 'ploinky_sso';
const LOCAL_AUTH_COOKIE_NAME = 'ploinky_local';
const ROUTING_FILE = path.resolve('.ploinky/routing.json');
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

function normalizeRelativePath(value, fallback = '/') {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return fallback;
    try {
        const parsed = new URL(raw, 'http://localhost');
        if (parsed.origin !== 'http://localhost') {
            return fallback;
        }
        const normalized = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
        return normalized.startsWith('/') ? normalized : fallback;
    } catch (_) {
        return fallback;
    }
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderLoggedOutHtml(nextPath) {
    const safeNext = normalizeRelativePath(nextPath, '/webchat/');
    const loginUrl = `/auth/login?returnTo=${encodeURIComponent(safeNext)}&prompt=login`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed Out</title>
  <style>
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-kicker">Workspace Access</div>
      <h1>Signed out</h1>
      <p>Your session was closed. Sign in again to return to the workspace.</p>
      <a class="auth-btn" href="${escapeHtml(loginUrl)}">Sign in</a>
    </section>
  </main>
</body>
</html>`;
}


function renderExternalAccountHtml({
    providerLabel = 'GitHub',
    returnTo = '/',
    username = ''
} = {}) {
    const safeReturnTo = escapeHtml(normalizeRelativePath(returnTo, '/'));
    const safeUsername = escapeHtml(username || '');
    const safeProvider = escapeHtml(providerLabel || 'GitHub');
    const safeLogoutUrl = escapeHtml(`/auth/logout?returnTo=${encodeURIComponent(normalizeRelativePath(returnTo, '/'))}`);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Account</title>
  <style>
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-kicker">Workspace Access</div>
      <h1>${safeProvider}</h1>
      <p>${safeUsername ? `${safeUsername} is signed in with ${safeProvider}.` : `This workspace session uses ${safeProvider} sign-in.`}</p>
      <p>Local account settings are not available for this sign-in method.</p>
      <div class="auth-actions">
        <a class="auth-btn secondary" href="${safeReturnTo}">Back</a>
        <a class="auth-btn" href="${safeLogoutUrl}">Sign out</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function getAuthPageStyles() {
    return `
    :root {
      color-scheme: light;
      --auth-ink: #1f2933;
      --auth-ink-soft: #4b5563;
      --auth-line: rgba(31, 41, 51, 0.12);
      --auth-paper: rgba(255,255,255,0.94);
      --auth-accent: #2563eb;
      --auth-accent-strong: #1d4ed8;
      --auth-bg-a: #f4f5f7;
      --auth-bg-b: #dbeafe;
      --auth-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      color: var(--auth-ink);
      background:
        radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 30%),
        radial-gradient(circle at bottom right, rgba(147,197,253,0.28), transparent 32%),
        linear-gradient(135deg, var(--auth-bg-a), var(--auth-bg-b));
    }
    .auth-shell {
      min-height: 100vh;
      display: grid;
      gap: 28px;
      align-content: center;
      justify-content: center;
      padding: 32px;
    }
    .auth-card, .auth-side {
      border: 1px solid var(--auth-line);
      border-radius: 24px;
      backdrop-filter: blur(12px);
      background: var(--auth-paper);
      box-shadow: var(--auth-shadow);
    }
    .auth-card {
      padding: 32px;
    }
    .auth-side {
      padding: 28px;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.94)),
        linear-gradient(135deg, rgba(37,99,235,0.14), rgba(147,197,253,0.18));
    }
    .auth-kicker, .auth-side-label {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 11px;
      color: var(--auth-ink-soft);
      margin-bottom: 10px;
    }
    h1, .auth-side-title {
      margin: 0;
      line-height: 1.05;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    h1 {
      font-size: clamp(30px, 4vw, 40px);
      margin-bottom: 12px;
    }
    .auth-side-title {
      font-size: clamp(24px, 3vw, 32px);
      margin-bottom: 14px;
    }
    p {
      margin: 0 0 18px;
      color: var(--auth-ink-soft);
      line-height: 1.6;
      font-size: 15px;
    }
    label {
      display: block;
      margin: 14px 0 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--auth-ink-soft);
    }
    input {
      width: 100%;
      border: 1px solid rgba(31, 41, 51, 0.14);
      border-radius: 14px;
      padding: 13px 14px;
      font: inherit;
      color: var(--auth-ink);
      background: rgba(255,255,255,0.88);
      outline: none;
      transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    input:focus {
      border-color: rgba(37, 99, 235, 0.5);
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
      transform: translateY(-1px);
    }
    .auth-btn {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      margin-top: 20px;
      padding: 13px 16px;
      border: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--auth-accent), var(--auth-accent-strong));
      color: white;
      text-decoration: none;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 18px 38px rgba(37, 99, 235, 0.26);
    }
    .auth-btn.secondary {
      background: transparent;
      color: var(--auth-ink);
      box-shadow: none;
      border: 1px solid var(--auth-line);
    }
    .auth-error {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(198, 40, 40, 0.08);
      color: #b3261e;
      font-size: 14px;
    }
    .auth-notice {
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(37, 99, 235, 0.08);
      color: #1d4ed8;
      font-size: 14px;
    }
    .auth-meta {
      margin-top: 14px;
      font-size: 12px;
      color: var(--auth-ink-soft);
      word-break: break-word;
    }
    .auth-meta a {
      color: var(--auth-accent-strong);
    }
    .auth-actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }
    .auth-actions .auth-btn {
      margin-top: 0;
    }
    @media (max-width: 900px) {
      .auth-shell {
        grid-template-columns: 1fr;
        padding: 20px;
      }
      .auth-side {
        order: -1;
      }
    }`;
}

function renderLocalLoginHtml({ agentName, returnTo = '/', error = '', notice = '', userVar = '', passwordHashVar = '', githubLoginUrl = '' } = {}) {
    const safeAgent = escapeHtml(agentName || 'application');
    const safeReturnTo = escapeHtml(normalizeRelativePath(returnTo, '/'));
    const safeError = escapeHtml(error || '');
    const safeNotice = escapeHtml(notice || '');
    const safeUserVar = escapeHtml(userVar || '');
    const safePasswordVar = escapeHtml(passwordHashVar || '');
    const safeAccountUrl = escapeHtml(`/auth/account?agent=${encodeURIComponent(agentName || '')}&returnTo=${encodeURIComponent(normalizeRelativePath(returnTo, '/'))}`);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in</title>
  <style>
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-kicker">Workspace Access</div>
      <h1>Sign in</h1>
      <p>Local authentication is enabled for ${safeAgent}.</p>
      ${safeNotice ? `<div class="auth-notice">${safeNotice}</div>` : ''}
      ${safeError ? `<div class="auth-error">${safeError}</div>` : ''}
      <form method="post" action="/auth/login">
        <input type="hidden" name="agent" value="${safeAgent}" />
        <input type="hidden" name="returnTo" value="${safeReturnTo}" />
        <label for="username">Username</label>
        <input id="username" name="username" type="text" autocomplete="username" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button class="auth-btn" type="submit">Sign in</button>
      </form>
      ${githubLoginUrl ? `<div class="auth-actions"><a class="auth-btn secondary" href="${escapeHtml(githubLoginUrl)}">Continue with GitHub</a></div>` : ''}
      <div class="auth-meta">After signing in, you can change the username or password in <a href="${safeAccountUrl}">account settings</a>.</div>
      ${(safeUserVar || safePasswordVar) ? `<div class="auth-meta">Workspace variables: ${safeUserVar}${safeUserVar && safePasswordVar ? ', ' : ''}${safePasswordVar}</div>` : ''}
    </section>
  </main>
</body>
</html>`;
}

function renderLocalAccountHtml({
    agentName,
    returnTo = '/',
    error = '',
    notice = '',
    username = '',
    userVar = '',
    passwordHashVar = ''
} = {}) {
    const safeAgent = escapeHtml(agentName || 'application');
    const safeReturnTo = escapeHtml(normalizeRelativePath(returnTo, '/'));
    const safeError = escapeHtml(error || '');
    const safeNotice = escapeHtml(notice || '');
    const safeUsername = escapeHtml(username || '');
    const safeUserVar = escapeHtml(userVar || '');
    const safePasswordVar = escapeHtml(passwordHashVar || '');
    const safeLogoutUrl = escapeHtml(`/auth/logout?returnTo=${encodeURIComponent(normalizeRelativePath(returnTo, '/'))}`);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Account settings</title>
  <style>
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-kicker">Workspace Access</div>
      <h1>Account settings</h1>
      <p>Update the local credentials for ${safeAgent}. Confirm the current password before saving any change.</p>
      ${safeNotice ? `<div class="auth-notice">${safeNotice}</div>` : ''}
      ${safeError ? `<div class="auth-error">${safeError}</div>` : ''}
      <form method="post" action="/auth/account">
        <input type="hidden" name="returnTo" value="${safeReturnTo}" />
        <label for="newUsername">Username</label>
        <input id="newUsername" name="newUsername" type="text" autocomplete="username" value="${safeUsername}" required />
        <label for="newPassword">New password</label>
        <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" />
        <label for="confirmPassword">Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" />
        <label for="currentPassword">Current password</label>
        <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required />
        <button class="auth-btn" type="submit">Save changes</button>
      </form>
      <div class="auth-actions">
        <a class="auth-btn secondary" href="${safeReturnTo}">Back</a>
        <a class="auth-btn secondary" href="${safeLogoutUrl}">Sign out</a>
      </div>
      <div class="auth-meta">Leave the new password fields empty if you only want to change the username.</div>
      ${(safeUserVar || safePasswordVar) ? `<div class="auth-meta">Workspace variables: ${safeUserVar}${safeUserVar && safePasswordVar ? ', ' : ''}${safePasswordVar}</div>` : ''}
    </section>
  </main>
</body>
</html>`;
}

function renderSsoLoginHtml({ agentName, returnTo = '/', redirectUrl = '' } = {}) {
    const safeAgent = escapeHtml(agentName || 'application');
    const safeReturnTo = escapeHtml(normalizeRelativePath(returnTo, '/'));
    const safeRedirectUrl = escapeHtml(redirectUrl || '#');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in</title>
  <style>
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-kicker">Workspace Access</div>
      <h1>Continue with Single Sign-On</h1>
      <p>You are signing in to ${safeAgent}. Redirecting to the identity provider now.</p>
      <div class="auth-actions">
        <a class="auth-btn" href="${safeRedirectUrl}">Continue</a>
        <a class="auth-btn secondary" href="${safeReturnTo}">Back</a>
      </div>
      <div class="auth-meta">If nothing happens, use Continue to open the sign-in page.</div>
    </section>
    <aside class="auth-side">
      <div class="auth-side-label">Workspace</div>
      <div class="auth-side-title">Centralized identity for workspace apps</div>
      <p>Single Sign-On protects routed applications and MCP endpoints under the same workspace policy.</p>
    </aside>
  </main>
  <script>
    window.setTimeout(function () {
      window.location.replace(${JSON.stringify(redirectUrl || '/')});
    }, 120);
  </script>
</body>
</html>`;
}

function readRouting() {
    try {
        return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

function resolveAuthRouteKey(parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    const parts = pathname.split('/').filter(Boolean);
    const routing = readRouting();
    const routes = routing.routes || {};
    const explicit = String(parsedUrl.searchParams.get('agent') || '').trim();
    const staticAgent = String(routing.static?.agent || '').trim();
    if (pathname.startsWith('/mcps/') || pathname.startsWith('/mcp/')) {
        if (explicit) return explicit;
        if (staticAgent) return staticAgent;
        if (parts.length >= 2) {
            return parts[1];
        }
    }
    if (parts.length >= 1 && routes[parts[0]]) {
        return parts[0];
    }
    if (explicit) return explicit;
    return staticAgent || null;
}

function resolveAuthContext(parsedUrl) {
    const routeKey = resolveAuthRouteKey(parsedUrl);
    if (!routeKey) {
        return { routeKey: null, mode: 'none', policy: { mode: 'none' }, record: null };
    }
    const resolved = resolveEnabledAgentRecord(routeKey);
    const record = resolved?.record || null;
    const policy = record?.auth || { mode: 'none' };
    const mode = String(policy.mode || 'none').trim().toLowerCase() || 'none';
    return { routeKey, mode, policy, record };
}

function getLocalRouteKey(parsedUrl, session = null, fallback = '') {
    const fromSession = String(session?.localAuth?.routeKey || session?.externalAuth?.routeKey || '').trim();
    if (fromSession) return fromSession;
    const fromQuery = String(parsedUrl.searchParams.get('agent') || '').trim();
    if (fromQuery) return fromQuery;
    return String(fallback || '').trim();
}

function getLocalAuthPolicyFromSession(session = null, fallbackPolicy = null) {
    const localAuth = session?.localAuth || {};
    if (localAuth.userVar && localAuth.passwordHashVar) {
        return {
            mode: 'local',
            userVar: localAuth.userVar,
            passwordHashVar: localAuth.passwordHashVar
        };
    }
    if (session?.externalAuth?.provider) {
        return null;
    }
    return fallbackPolicy;
}

async function resolveSessionForAuthContext(authContext, sessionId) {
    if (!sessionId) return null;
    let session = authContext.mode === 'local'
        ? getLocalSession(sessionId)
        : authService.getSession(sessionId);
    if (authContext.mode === 'sso' && (!session || (session.expiresAt && Date.now() > session.expiresAt))) {
        try {
            await authService.refreshSession(sessionId);
        } catch (_) {
            // ignore refresh failures; caller will treat as unauthenticated
        }
        session = authService.getSession(sessionId);
    }
    return session;
}

function getGithubAuthErrorMessage(code = '') {
    switch (String(code || '').trim()) {
        case 'github_auth_not_configured':
            return 'GitHub auth is not configured for this workspace.';
        case 'github_client_id_required':
            return 'Enter a GitHub OAuth client ID.';
        case 'github_device_flow_not_started':
            return 'GitHub sign-in has not started yet.';
        case 'github_device_flow_expired':
            return 'The GitHub sign-in code expired. Start again.';
        case 'github_device_flow_access_denied':
            return 'GitHub sign-in was cancelled.';
        case 'github_oauth_client_secret_required':
            return 'GitHub sign-in is not fully configured for this workspace.';
        case 'github_oauth_state_invalid':
            return 'GitHub sign-in expired. Start again.';
        case 'missing_base_url':
            return 'GitHub sign-in is not available from this request.';
        case 'missing_session':
            return 'Authentication required.';
        default:
            return code ? 'GitHub authentication failed.' : '';
    }
}

function getLocalAccountErrorMessage(code = '') {
    switch (String(code || '').trim()) {
        case 'current_password_required':
            return 'Enter the current password to apply changes.';
        case 'username_required':
            return 'Username cannot be empty.';
        case 'password_too_short':
            return 'New password must be at least 8 characters.';
        case 'password_confirmation_required':
            return 'Confirm the new password.';
        case 'password_confirmation_mismatch':
            return 'The new password and confirmation do not match.';
        case 'invalid_credentials':
            return 'Current password is incorrect.';
        case 'local_auth_not_configured':
            return 'Local auth is not configured for this account.';
        case 'no_changes_requested':
            return 'No changes were submitted.';
        case 'session_stale':
            return 'Your session is out of date. Sign in again and retry.';
        default:
            return code ? 'Unable to update credentials.' : '';
    }
}

function readTextBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function readLoginBody(req) {
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
        return readJsonBody(req);
    }
    const raw = await readTextBody(req);
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
}

function getCookieNameForMode(mode) {
    return mode === 'local' ? LOCAL_AUTH_COOKIE_NAME : SSO_AUTH_COOKIE_NAME;
}

function respondUnauthenticated(req, res, parsedUrl, authContext = resolveAuthContext(parsedUrl)) {
    const pathname = parsedUrl.pathname || '/';
    const returnTo = parsedUrl.path || pathname || '/';
    const query = new URLSearchParams({ returnTo });
    if (authContext?.routeKey) query.set('agent', authContext.routeKey);
    const loginUrl = `/auth/login?${query.toString()}`;
    const cookieName = getCookieNameForMode(authContext?.mode);
    const clearCookie = buildCookie(cookieName, '', req, '/', { maxAge: 0, sameSite: 'Lax' });
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
    const authContext = resolveAuthContext(parsedUrl);
    if (authContext.mode === 'none') {
        return { ok: true };
    }
    if (authContext.mode === 'sso' && !authService.isConfigured()) {
        sendJson(res, 503, { ok: false, error: 'sso_not_configured' });
        return { ok: false, error: 'sso_not_configured' };
    }
    const cookies = parseCookies(req);
    const cookieName = getCookieNameForMode(authContext.mode);
    const sessionId = cookies.get(cookieName);
    if (!sessionId) {
        appendLog('auth_missing_cookie', { path: parsedUrl.pathname });
        return respondUnauthenticated(req, res, parsedUrl, authContext);
    }
    let session = authContext.mode === 'local'
        ? getLocalSession(sessionId)
        : authService.getSession(sessionId);
    if (authContext.mode === 'sso' && (!session || (session.expiresAt && Date.now() > session.expiresAt))) {
        try {
            await authService.refreshSession(sessionId);
        } catch (err) {
            appendLog('auth_refresh_failed', { error: err?.message || String(err) });
        }
        session = authService.getSession(sessionId);
    }
    if (!session) {
        appendLog('auth_session_invalid', { sessionId: '[redacted]', mode: authContext.mode });
        return respondUnauthenticated(req, res, parsedUrl, authContext);
    }
    req.user = session.user;
    req.session = session;
    req.sessionId = sessionId;
    req.authMode = authContext.mode;
    try {
        const cookie = buildCookie(cookieName, sessionId, req, '/', {
            maxAge: authContext.mode === 'local'
                ? getLocalSessionCookieMaxAge()
                : authService.getSessionCookieMaxAge(),
            sameSite: 'Lax'
        });
        appendSetCookie(res, cookie);
    } catch (_) { }
    return { ok: true, session };
}

export async function handleAuthRoutes(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    if (!pathname.startsWith('/auth/')) return false;
    const method = (req.method || 'GET').toUpperCase();
    const baseUrl = getRequestBaseUrl(req);
    const authContext = resolveAuthContext(parsedUrl);
    try {
        if (pathname === '/auth/logged-out') {
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            const nextPath = normalizeRelativePath(parsedUrl.searchParams.get('next') || '/webchat/', '/webchat/');
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(renderLoggedOutHtml(nextPath));
            return true;
        }
        if (pathname === '/auth/login') {
            if (authContext.mode === 'none') {
                sendJson(res, 404, { ok: false, error: 'auth_disabled' });
                return true;
            }
            if (authContext.mode === 'local') {
                if (method === 'GET') {
                    const returnTo = parsedUrl.searchParams.get('returnTo') || '/';
                    const localCfg = resolveLocalAuthConfig(authContext.policy);
                    const githubCfg = loadGithubAuthConfig();
                    const githubLoginUrl = githubCfg?.clientId && githubCfg?.clientSecret
                        ? `/auth/github/login?agent=${encodeURIComponent(authContext.routeKey || '')}&returnTo=${encodeURIComponent(returnTo)}`
                        : '';
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store'
                    });
                    res.end(renderLocalLoginHtml({
                        agentName: authContext.routeKey,
                        returnTo,
                        error: parsedUrl.searchParams.get('error') || '',
                        notice: parsedUrl.searchParams.get('notice') || '',
                        userVar: localCfg.usernameVar,
                        passwordHashVar: localCfg.passwordHashVar,
                        githubLoginUrl
                    }));
                    return true;
                }
                if (method !== 'POST') {
                    res.writeHead(405); res.end(); return true;
                }
                const body = await readLoginBody(req);
                const username = String(body?.username || '').trim();
                const password = String(body?.password || '');
                const returnTo = normalizeRelativePath(body?.returnTo || '/', '/');
                const agent = String(body?.agent || authContext.routeKey || '').trim();
                try {
                    const result = authenticateLocalUser({ username, password, policy: authContext.policy, routeKey: agent });
                    const cookie = buildCookie(LOCAL_AUTH_COOKIE_NAME, result.sessionId, req, '/', {
                        maxAge: getLocalSessionCookieMaxAge(),
                        sameSite: 'Lax'
                    });
                    res.writeHead(302, {
                        Location: returnTo,
                        'Set-Cookie': cookie
                    });
                    res.end('Login successful');
                    appendLog('auth_local_login_success', { user: result.user?.username, agent });
                    return true;
                } catch (err) {
                    appendLog('auth_local_login_failure', { error: err?.message || String(err), agent });
                    const params = new URLSearchParams({
                        agent,
                        returnTo,
                        error: err?.message === 'local_auth_not_configured'
                            ? 'Local auth is not configured for this agent.'
                            : 'Invalid username or password.'
                    });
                    res.writeHead(302, { Location: `/auth/login?${params.toString()}` });
                    res.end('Login failed');
                    return true;
                }
            }
            if (!authService.isConfigured()) {
                sendJson(res, 503, { ok: false, error: 'sso_disabled' });
                return true;
            }
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            const returnTo = parsedUrl.searchParams.get('returnTo') || '/';
            const prompt = parsedUrl.searchParams.get('prompt') || undefined;
            const { redirectUrl } = await authService.beginLogin({ baseUrl, returnTo, prompt });
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(renderSsoLoginHtml({
                agentName: authContext.routeKey,
                returnTo,
                redirectUrl
            }));
            appendLog('auth_login_redirect', { returnTo });
            return true;
        }
        if (pathname === '/auth/account') {
            if (method !== 'GET' && method !== 'POST') {
                res.writeHead(405); res.end(); return true;
            }
            const cookies = parseCookies(req);
            const sessionId = cookies.get(LOCAL_AUTH_COOKIE_NAME) || '';
            const session = getLocalSession(sessionId);
            const routeKey = getLocalRouteKey(parsedUrl, session, authContext.routeKey);
            const returnToFromQuery = normalizeRelativePath(parsedUrl.searchParams.get('returnTo') || '/', '/');

            if (!session) {
                const params = new URLSearchParams({ returnTo: returnToFromQuery });
                if (routeKey) params.set('agent', routeKey);
                res.writeHead(302, { Location: `/auth/login?${params.toString()}` });
                res.end('Authentication required');
                return true;
            }

            req.user = session.user;
            req.session = session;
            req.sessionId = sessionId;
            req.authMode = 'local';

            const policy = getLocalAuthPolicyFromSession(session, authContext.policy);
            if (!policy) {
                if (method === 'GET') {
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store'
                    });
                    res.end(renderExternalAccountHtml({
                        providerLabel: session?.externalAuth?.provider === 'github' ? 'GitHub' : 'External sign-in',
                        returnTo: returnToFromQuery,
                        username: req.user?.username || req.user?.name || ''
                    }));
                    return true;
                }
                sendJson(res, 400, {
                    ok: false,
                    error: 'external_account_readonly',
                    message: 'Account settings are not available for this sign-in method.'
                });
                return true;
            }

            if (method === 'GET') {
                const localCfg = resolveLocalAuthConfig(policy);
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store'
                });
                res.end(renderLocalAccountHtml({
                    agentName: routeKey,
                    returnTo: returnToFromQuery,
                    error: getLocalAccountErrorMessage(parsedUrl.searchParams.get('error') || ''),
                    notice: parsedUrl.searchParams.get('notice') || '',
                    username: localCfg.username || req.user?.username || '',
                    userVar: localCfg.usernameVar,
                    passwordHashVar: localCfg.passwordHashVar
                }));
                return true;
            }

            const body = await readLoginBody(req);
            const returnTo = normalizeRelativePath(body?.returnTo || '/', '/');
            const nextUsername = String(body?.newUsername || '').trim();
            const currentPassword = String(body?.currentPassword || '');
            const newPassword = String(body?.newPassword || '');
            const confirmPassword = String(body?.confirmPassword || '');
            const wantsJson = String(req.headers?.accept || '').toLowerCase().includes('application/json');
            let errorCode = '';

            if (!currentPassword) {
                errorCode = 'current_password_required';
            } else if (!nextUsername) {
                errorCode = 'username_required';
            } else if ((newPassword || confirmPassword) && !confirmPassword) {
                errorCode = 'password_confirmation_required';
            } else if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
                errorCode = 'password_confirmation_mismatch';
            } else if (newPassword && newPassword.length < 8) {
                errorCode = 'password_too_short';
            }

            if (!errorCode) {
                try {
                    const result = updateLocalCredentials({
                        currentPassword,
                        nextUsername,
                        nextPassword: newPassword,
                        policy,
                        sessionUser: req.user
                    });
                    const clearCookie = buildCookie(LOCAL_AUTH_COOKIE_NAME, '', req, '/', { maxAge: 0, sameSite: 'Lax' });
                    const notice = result.passwordChanged
                        ? 'Credentials updated. Sign in again with the new username and password.'
                        : 'Username updated. Sign in again with the new username.';
                    appendLog('auth_local_account_updated', {
                        user: req.user?.username || null,
                        agent: routeKey || null,
                        usernameChanged: result.usernameChanged,
                        passwordChanged: result.passwordChanged
                    });
                    clearGithubSession({ sessionId, authMode: 'local' });
                    if (wantsJson) {
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Set-Cookie': clearCookie
                        });
                        res.end(JSON.stringify({ ok: true, notice }));
                        return true;
                    }
                    const params = new URLSearchParams({ returnTo, notice });
                    if (routeKey) params.set('agent', routeKey);
                    res.writeHead(302, {
                        Location: `/auth/login?${params.toString()}`,
                        'Set-Cookie': clearCookie
                    });
                    res.end('Credentials updated');
                    return true;
                } catch (err) {
                    errorCode = err?.message || 'local_account_update_failed';
                    appendLog('auth_local_account_update_failure', {
                        error: errorCode,
                        agent: routeKey || null
                    });
                }
            }

            if (wantsJson) {
                sendJson(res, 400, {
                    ok: false,
                    error: errorCode,
                    message: getLocalAccountErrorMessage(errorCode)
                });
                return true;
            }

            const params = new URLSearchParams({ returnTo });
            if (errorCode) params.set('error', errorCode);
            res.writeHead(302, { Location: `/auth/account?${params.toString()}` });
            res.end('Unable to update credentials');
            return true;
        }

        if (pathname === '/auth/github/login') {
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            if (authContext.mode !== 'local') {
                sendJson(res, 404, { ok: false, error: 'github_login_not_supported' });
                return true;
            }
            const returnTo = normalizeRelativePath(parsedUrl.searchParams.get('returnTo') || '/', '/');
            const agent = String(parsedUrl.searchParams.get('agent') || authContext.routeKey || '').trim();
            try {
                const { redirectUrl } = beginGithubLogin({
                    baseUrl,
                    authMode: 'local',
                    routeKey: agent,
                    returnTo
                });
                res.writeHead(302, { Location: redirectUrl });
                res.end('Redirecting to GitHub');
                return true;
            } catch (err) {
                const errorCode = err?.message || 'github_login_start_failed';
                const params = new URLSearchParams({
                    returnTo,
                    error: getGithubAuthErrorMessage(errorCode) || 'GitHub sign-in failed.'
                });
                if (agent) params.set('agent', agent);
                res.writeHead(302, { Location: `/auth/login?${params.toString()}` });
                res.end('GitHub sign-in unavailable');
                return true;
            }
        }
        if (pathname === '/auth/github/callback') {
            if (method !== 'GET') {
                res.writeHead(405); res.end(); return true;
            }
            const code = String(parsedUrl.searchParams.get('code') || '').trim();
            const stateParam = String(parsedUrl.searchParams.get('state') || '').trim();
            const oauthError = String(parsedUrl.searchParams.get('error') || '').trim();
            try {
                if (oauthError) {
                    throw new Error(oauthError === 'access_denied' ? 'github_device_flow_access_denied' : oauthError);
                }
                if (!code || !stateParam) {
                    throw new Error('missing_parameters');
                }
                const result = await finishGithubLogin({ code, state: stateParam, baseUrl });
                if (result.authMode !== 'local') {
                    throw new Error('github_login_not_supported');
                }
                const created = createExternalSession({
                    user: {
                        id: result.user?.id ? `github:${result.user.id}` : 'github:user',
                        login: result.user?.login || '',
                        name: result.user?.name || result.user?.login || 'GitHub',
                        email: result.user?.email || ''
                    },
                    routeKey: result.routeKey || authContext.routeKey || '',
                    provider: 'github'
                });
                saveGithubSession({ sessionId: created.sessionId, authMode: 'local' }, result.connection);
                const cookie = buildCookie(LOCAL_AUTH_COOKIE_NAME, created.sessionId, req, '/', {
                    maxAge: getLocalSessionCookieMaxAge(),
                    sameSite: 'Lax'
                });
                res.writeHead(302, {
                    Location: normalizeRelativePath(result.returnTo || '/', '/'),
                    'Set-Cookie': cookie
                });
                res.end('GitHub login successful');
                appendLog('auth_github_login_success', {
                    user: created.user?.username || created.user?.id || null,
                    agent: result.routeKey || null
                });
                return true;
            } catch (err) {
                const errorCode = err?.message || 'github_login_callback_failed';
                appendLog('auth_github_login_failure', { error: errorCode });
                const params = new URLSearchParams({
                    error: getGithubAuthErrorMessage(errorCode) || 'GitHub sign-in failed.'
                });
                res.writeHead(302, { Location: `/auth/login?${params.toString()}` });
                res.end('GitHub login failed');
                return true;
            }
        }
        if (pathname.startsWith('/auth/github/')) {
            const cookieName = getCookieNameForMode(authContext.mode);
            if (authContext.mode === 'none') {
                sendJson(res, 404, { ok: false, error: 'auth_disabled' });
                return true;
            }
            if (method !== 'GET' && method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                return true;
            }
            const cookies = parseCookies(req);
            const sessionId = cookies.get(cookieName) || '';
            const session = await resolveSessionForAuthContext(authContext, sessionId);
            if (!session) {
                const clearCookie = buildCookie(cookieName, '', req, '/', { maxAge: 0, sameSite: 'Lax' });
                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': clearCookie
                });
                res.end(JSON.stringify({ ok: false, error: 'not_authenticated' }));
                return true;
            }

            req.user = session.user;
            req.session = session;
            req.sessionId = sessionId;
            req.authMode = authContext.mode;

            const sessionRef = { sessionId, authMode: authContext.mode };
            const refreshCookie = buildCookie(cookieName, sessionId, req, '/', {
                maxAge: authContext.mode === 'local'
                    ? getLocalSessionCookieMaxAge()
                    : authService.getSessionCookieMaxAge(),
                sameSite: 'Lax'
            });
            appendSetCookie(res, refreshCookie);

            if (pathname === '/auth/github/status') {
                if (method !== 'GET') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                    return true;
                }
                sendJson(res, 200, { ok: true, github: getGithubAuthStatus(sessionRef) });
                return true;
            }

            if (pathname === '/auth/github/config') {
                if (method === 'GET') {
                    sendJson(res, 200, { ok: true, github: getGithubAuthStatus(sessionRef) });
                    return true;
                }
                if (method !== 'POST') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                    return true;
                }
                try {
                    const body = await readJsonBody(req);
                    saveGithubAuthSetup({
                        clientId: body?.clientId,
                        clientSecret: Object.prototype.hasOwnProperty.call(body || {}, 'clientSecret') ? body.clientSecret : undefined,
                        scope: body?.scope
                    });
                    appendLog('auth_github_config_saved', { user: req.user?.username || req.user?.email || req.user?.id || null });
                    sendJson(res, 200, { ok: true, github: getGithubAuthStatus(sessionRef) });
                } catch (err) {
                    const errorCode = err?.message || 'github_config_save_failed';
                    appendLog('auth_github_config_save_failure', { error: errorCode });
                    sendJson(res, 400, {
                        ok: false,
                        error: errorCode,
                        message: getGithubAuthErrorMessage(errorCode)
                    });
                }
                return true;
            }


            if (pathname === '/auth/github/device/start') {
                if (method !== 'POST') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                    return true;
                }
                try {
                    const result = await beginGithubDeviceFlow(sessionRef);
                    appendLog('auth_github_device_start', { user: req.user?.username || req.user?.email || req.user?.id || null });
                    sendJson(res, 200, { ok: true, github: result });
                } catch (err) {
                    const errorCode = err?.message || 'github_device_flow_start_failed';
                    appendLog('auth_github_device_start_failure', { error: errorCode });
                    sendJson(res, 400, {
                        ok: false,
                        error: errorCode,
                        message: getGithubAuthErrorMessage(errorCode)
                    });
                }
                return true;
            }

            if (pathname === '/auth/github/device/poll') {
                if (method !== 'POST') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                    return true;
                }
                try {
                    const result = await pollGithubDeviceFlow(sessionRef);
                    if (result?.connected) {
                        appendLog('auth_github_device_connected', {
                            user: req.user?.username || req.user?.email || req.user?.id || null,
                            github: result.connection?.user?.login || null
                        });
                    }
                    sendJson(res, 200, { ok: true, github: result });
                } catch (err) {
                    const errorCode = err?.message || 'github_device_flow_poll_failed';
                    appendLog('auth_github_device_poll_failure', { error: errorCode });
                    sendJson(res, 400, {
                        ok: false,
                        error: errorCode,
                        message: getGithubAuthErrorMessage(errorCode)
                    });
                }
                return true;
            }

            if (pathname === '/auth/github/disconnect') {
                if (method !== 'POST') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                    return true;
                }
                try {
                    const result = await disconnectGithubSession(sessionRef);
                    appendLog('auth_github_disconnect', {
                        user: req.user?.username || req.user?.email || req.user?.id || null
                    });
                    sendJson(res, 200, { ok: true, github: result });
                } catch (err) {
                    const errorCode = err?.message || 'github_disconnect_failed';
                    appendLog('auth_github_disconnect_failure', { error: errorCode });
                    sendJson(res, 400, {
                        ok: false,
                        error: errorCode,
                        message: getGithubAuthErrorMessage(errorCode)
                    });
                }
                return true;
            }

            sendJson(res, 404, { ok: false, error: 'not_found' });
            return true;
        }
        if (pathname === '/auth/callback') {
            if (authContext.mode !== 'sso') {
                sendJson(res, 404, { ok: false, error: 'callback_not_supported' });
                return true;
            }
            if (!authService.isConfigured()) {
                sendJson(res, 503, { ok: false, error: 'sso_disabled' });
                return true;
            }
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
            const cookie = buildCookie(SSO_AUTH_COOKIE_NAME, result.sessionId, req, '/', {
                maxAge: authService.getSessionCookieMaxAge(),
                sameSite: 'Lax'
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
            const cookieName = getCookieNameForMode(authContext.mode);
            const sessionId = cookies.get(cookieName) || '';
            const requestedReturnTo = normalizeRelativePath(parsedUrl.searchParams.get('returnTo') || '/', '/');
            clearGithubSession({ sessionId, authMode: authContext.mode });
            const outcome = authContext.mode === 'local'
                ? (revokeLocalSession(sessionId), { redirect: requestedReturnTo || '/' })
                : await authService.logout(sessionId, {
                    baseUrl,
                    postLogoutRedirectUri: requestedReturnTo
                });
            const clearCookie = buildCookie(cookieName, '', req, '/', { maxAge: 0, sameSite: 'Lax' });
            const redirectTarget = outcome.redirect || requestedReturnTo || '/';
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
            if (authContext.mode === 'none') {
                sendJson(res, 404, { ok: false, error: 'auth_disabled' });
                return true;
            }
            if (method !== 'GET' && method !== 'POST') {
                res.writeHead(405); res.end(); return true;
            }
            const cookies = parseCookies(req);
            const cookieName = getCookieNameForMode(authContext.mode);
            const sessionId = cookies.get(cookieName);
            if (!sessionId) {
                sendJson(res, 401, { ok: false, error: 'not_authenticated' });
                return true;
            }
            const session = authContext.mode === 'local'
                ? getLocalSession(sessionId)
                : authService.getSession(sessionId);
            if (!session) {
                const clearCookie = buildCookie(cookieName, '', req, '/', { maxAge: 0, sameSite: 'Lax' });
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
            if (authContext.mode === 'sso' && refreshRequested) {
                tokenInfo = await authService.refreshSession(sessionId);
            } else {
                tokenInfo = {
                    accessToken: session.tokens?.accessToken || null,
                    expiresAt: session.expiresAt,
                    scope: session.tokens?.scope || null,
                    tokenType: session.tokens?.tokenType || null
                };
            }
            const cookie = buildCookie(cookieName, sessionId, req, '/', {
                maxAge: authContext.mode === 'local'
                    ? getLocalSessionCookieMaxAge()
                    : authService.getSessionCookieMaxAge(),
                sameSite: 'Lax'
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

export { SSO_AUTH_COOKIE_NAME as AUTH_COOKIE_NAME, SSO_AUTH_COOKIE_NAME, LOCAL_AUTH_COOKIE_NAME, authService };
