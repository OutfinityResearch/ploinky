import { resolveVarValue } from '../../services/secretVars.js';
import { getConfig } from '../../services/workspace.js';
import { SSO_ENV_ROLE_CANDIDATES } from '../../services/sso.js';

function readConfigValue(names, fallback) {
    const candidates = Array.isArray(names) ? names : [names].filter(Boolean);
    for (const name of candidates) {
        if (!name) continue;
        const secret = resolveVarValue(name);
        if (secret && String(secret).trim()) return String(secret).trim();
    }
    for (const name of candidates) {
        if (!name) continue;
        const env = process.env[name];
        if (env && String(env).trim()) return String(env).trim();
    }
    if (fallback && String(fallback).trim()) return String(fallback).trim();
    return '';
}

function loadAuthConfig() {
    let workspaceConfig;
    // Check if SSO is explicitly disabled in workspace config
    try {
        workspaceConfig = getConfig();
        if (workspaceConfig && workspaceConfig.sso && workspaceConfig.sso.enabled === false) {
            return null;
        }
    } catch (_) {
        // Ignore config read errors, fall through to env var check
    }

    const ssoConfig = workspaceConfig?.sso || {};

    const baseUrl = readConfigValue(SSO_ENV_ROLE_CANDIDATES.baseUrl, ssoConfig.baseUrl);
    const realm = readConfigValue(SSO_ENV_ROLE_CANDIDATES.realm, ssoConfig.realm);
    const clientId = readConfigValue(SSO_ENV_ROLE_CANDIDATES.clientId, ssoConfig.clientId);
    const clientSecret = readConfigValue(SSO_ENV_ROLE_CANDIDATES.clientSecret, ssoConfig.clientSecret);
    const redirectUri = readConfigValue(SSO_ENV_ROLE_CANDIDATES.redirectUri, ssoConfig.redirectUri);
    const postLogoutRedirectUri = readConfigValue(SSO_ENV_ROLE_CANDIDATES.logoutRedirectUri, ssoConfig.logoutRedirectUri);
    const scope = readConfigValue(SSO_ENV_ROLE_CANDIDATES.scope, ssoConfig.scope) || 'openid profile email';

    if (!baseUrl || !realm || !clientId) {
        return null;
    }

    return {
        baseUrl,
        realm,
        clientId,
        clientSecret: clientSecret || null,
        redirectUri: redirectUri || null,
        postLogoutRedirectUri: postLogoutRedirectUri || null,
        scope
    };
}

export { loadAuthConfig };
