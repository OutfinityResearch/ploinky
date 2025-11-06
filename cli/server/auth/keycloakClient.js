import { URL } from 'url';

const METADATA_TTL_MS = 5 * 60 * 1000;

function ensureTrailingSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}

function buildRealmBase(baseUrl, realm) {
    return `${ensureTrailingSlash(baseUrl)}realms/${encodeURIComponent(realm)}`;
}

function createMetadataCache() {
    const cache = new Map(); // key -> { fetchedAt, data }
    return {
        async get(config) {
            const key = `${config.baseUrl}|${config.realm}`;
            const cached = cache.get(key);
            if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) {
                return cached.data;
            }
            const realmBase = buildRealmBase(config.baseUrl, config.realm);
            const url = `${realmBase}/.well-known/openid-configuration`;
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) {
                throw new Error(`Failed to fetch OpenID configuration (${res.status})`);
            }
            const data = await res.json();
            cache.set(key, { fetchedAt: Date.now(), data });
            return data;
        },
        clear() {
            cache.clear();
        }
    };
}

function toFormBody(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    return search.toString();
}

async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
        const detail = text ? `: ${text}` : '';
        throw new Error(`Keycloak request failed (${res.status})${detail}`);
    }
    return text ? JSON.parse(text) : {};
}

function buildAuthUrl(metadata, config, { state, codeChallenge, redirectUri, scope, nonce, prompt }) {
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('scope', scope || config.scope || 'openid');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (nonce) authUrl.searchParams.set('nonce', nonce);
    if (prompt) authUrl.searchParams.set('prompt', prompt);
    return authUrl.toString();
}

async function exchangeCodeForTokens(metadata, config, { code, redirectUri, codeVerifier }) {
    const body = toFormBody({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
        client_secret: config.clientSecret || undefined
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}

async function refreshTokens(metadata, config, refreshToken) {
    const body = toFormBody({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret || undefined
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}

function buildLogoutUrl(metadata, config, { idTokenHint, postLogoutRedirectUri }) {
    if (!metadata.end_session_endpoint) return null;
    const url = new URL(metadata.end_session_endpoint);
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
    const redirect = postLogoutRedirectUri || config.postLogoutRedirectUri || config.redirectUri;
    if (redirect) url.searchParams.set('post_logout_redirect_uri', redirect);
    url.searchParams.set('client_id', config.clientId);
    return url.toString();
}

async function exchangeClientCredentials(metadata, config, { clientId, clientSecret, scope }) {
    const body = toFormBody({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope || config.scope || 'openid'
    });
    return fetchJson(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}

export {
    createMetadataCache,
    buildAuthUrl,
    exchangeCodeForTokens,
    exchangeClientCredentials,
    refreshTokens,
    buildLogoutUrl
};
