import { resolveVarValue } from '../../services/secretVars.js';

function readConfigValue(name) {
    const secret = resolveVarValue(name);
    if (secret && String(secret).trim()) return String(secret).trim();
    const env = process.env[name];
    if (env && String(env).trim()) return String(env).trim();
    return '';
}

function loadAuthConfig() {
    const baseUrl = readConfigValue('KEYCLOAK_URL');
    const realm = readConfigValue('KEYCLOAK_REALM');
    const clientId = readConfigValue('KEYCLOAK_CLIENT_ID');
    const clientSecret = readConfigValue('KEYCLOAK_CLIENT_SECRET');
    const redirectUri = readConfigValue('KEYCLOAK_REDIRECT_URI');
    const postLogoutRedirectUri = readConfigValue('KEYCLOAK_LOGOUT_REDIRECT_URI');
    const scope = readConfigValue('KEYCLOAK_SCOPE') || 'openid profile email';

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
