import fs from 'fs';
import path from 'path';

import * as workspaceSvc from './workspace.js';
import { resolveVarValue } from './secretVars.js';

const ROUTING_FILE = path.resolve('.ploinky/routing.json');

// Standard SSO environment variable naming conventions
// Used by auth/config.js and CLI commands for consistent variable resolution
const SSO_ENV_ROLE_CANDIDATES = {
    baseUrl: ['KEYCLOAK_URL', 'SSO_BASE_URL', 'SSO_URL', 'OIDC_BASE_URL'],
    realm: ['KEYCLOAK_REALM', 'SSO_REALM', 'OIDC_REALM'],
    clientId: ['KEYCLOAK_CLIENT_ID', 'SSO_CLIENT_ID', 'OIDC_CLIENT_ID'],
    clientSecret: ['KEYCLOAK_CLIENT_SECRET', 'SSO_CLIENT_SECRET', 'OIDC_CLIENT_SECRET'],
    scope: ['KEYCLOAK_SCOPE', 'SSO_SCOPE', 'OIDC_SCOPE'],
    redirectUri: ['KEYCLOAK_REDIRECT_URI', 'SSO_REDIRECT_URI', 'OIDC_REDIRECT_URI'],
    logoutRedirectUri: ['KEYCLOAK_LOGOUT_REDIRECT_URI', 'SSO_LOGOUT_REDIRECT_URI', 'OIDC_LOGOUT_REDIRECT_URI'],
    adminUser: ['KEYCLOAK_ADMIN', 'SSO_ADMIN', 'OIDC_ADMIN'],
    adminPassword: ['KEYCLOAK_ADMIN_PASSWORD', 'SSO_ADMIN_PASSWORD', 'OIDC_ADMIN_PASSWORD'],
    hostname: ['KC_HOSTNAME', 'SSO_HOSTNAME', 'OIDC_HOSTNAME'],
    hostnameStrict: ['KC_HOSTNAME_STRICT', 'SSO_HOSTNAME_STRICT', 'OIDC_HOSTNAME_STRICT'],
    httpEnabled: ['KC_HTTP_ENABLED', 'SSO_HTTP_ENABLED', 'OIDC_HTTP_ENABLED'],
    proxy: ['KC_PROXY', 'SSO_PROXY', 'OIDC_PROXY'],
    dbEngine: ['KC_DB', 'SSO_DB_ENGINE', 'OIDC_DB_ENGINE'],
    dbUrl: ['KC_DB_URL', 'SSO_DB_URL', 'OIDC_DB_URL'],
    dbUsername: ['KC_DB_USERNAME', 'SSO_DB_USERNAME', 'OIDC_DB_USERNAME'],
    dbPassword: ['KC_DB_PASSWORD', 'SSO_DB_PASSWORD', 'OIDC_DB_PASSWORD']
};

// Service discovery utilities

function readRouting() {
    try {
        return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

function getRouterPort() {
    const routing = readRouting();
    const fromRouting = parseInt(routing.port, 10);
    if (!Number.isNaN(fromRouting) && fromRouting > 0) return fromRouting;
    try {
        const cfg = workspaceSvc.getConfig() || {};
        const staticPort = parseInt(cfg?.static?.port, 10);
        if (!Number.isNaN(staticPort) && staticPort > 0) return staticPort;
    } catch (_) {}
    return 8080;
}

function extractShortAgentName(agentRef) {
    if (!agentRef) return '';
    const tokens = String(agentRef).split(/[/:]/).filter(Boolean);
    if (!tokens.length) return String(agentRef);
    return tokens[tokens.length - 1];
}

function getAgentHostPort(agentName) {
    if (!agentName) return null;
    const shortName = extractShortAgentName(agentName);
    const routing = readRouting();
    const routes = routing.routes || {};
    const route = routes[shortName] || routes[agentName];
    if (!route) return null;
    if (Array.isArray(route.ports) && route.ports.length) {
        const preferred = route.ports.find(p => p && (p.primary || p.name === 'http')) || route.ports[0];
        const hostPort = parseInt(preferred?.hostPort, 10);
        if (!Number.isNaN(hostPort) && hostPort > 0) return hostPort;
    }
    if (route.portMap && typeof route.portMap === 'object') {
        const httpPort = parseInt(route.portMap.http, 10);
        if (!Number.isNaN(httpPort) && httpPort > 0) return httpPort;
        const first = Object.values(route.portMap).map(v => parseInt(v, 10)).find(v => !Number.isNaN(v) && v > 0);
        if (first) return first;
    }
    const fallback = parseInt(route.hostPort, 10);
    if (!Number.isNaN(fallback) && fallback > 0) return fallback;
    return null;
}

// Variable resolution - leverages secretVars.js for consistent resolution

function readEnvValue(name) {
    if (!name) return '';
    try {
        const fromSecrets = resolveVarValue(name);
        if (fromSecrets && String(fromSecrets).trim()) {
            return String(fromSecrets).trim();
        }
    } catch (_) {}
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
        const raw = process.env[name];
        if (raw !== undefined && raw !== null) {
            const str = String(raw).trim();
            if (str) return str;
        }
    }
    return '';
}

function resolveEnvRoleValues() {
    const valueFromCandidates = (candidates = []) => {
        for (const name of candidates) {
            if (!name) continue;
            const val = readEnvValue(name);
            if (val) return val;
        }
        return '';
    };
    return {
        baseUrl: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.baseUrl),
        realm: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.realm),
        clientId: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.clientId),
        clientSecret: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.clientSecret),
        scope: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.scope),
        redirectUri: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.redirectUri),
        logoutRedirectUri: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.logoutRedirectUri),
        adminUser: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.adminUser),
        adminPassword: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.adminPassword),
        hostname: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.hostname),
        hostnameStrict: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.hostnameStrict),
        httpEnabled: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.httpEnabled),
        proxy: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.proxy),
        dbEngine: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.dbEngine),
        dbUrl: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.dbUrl),
        dbUsername: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.dbUsername),
        dbPassword: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.dbPassword)
    };
}

function getSsoConfig() {
    const cfg = workspaceSvc.getConfig() || {};
    const sso = cfg.sso || {};
    const providerAgent = sso.providerAgent || sso.keycloakAgent || 'keycloak';
    const providerAgentShort = sso.providerAgentShort || sso.keycloakAgentShort || extractShortAgentName(providerAgent);
    const databaseAgent = sso.databaseAgent || sso.postgresAgent || 'postgres';
    const databaseAgentShort = sso.databaseAgentShort || sso.postgresAgentShort || extractShortAgentName(databaseAgent);
    
    return {
        enabled: Boolean(sso.enabled),
        providerAgent,
        providerAgentShort,
        keycloakAgent: providerAgent,
        keycloakAgentShort: providerAgentShort,
        databaseAgent,
        databaseAgentShort,
        postgresAgent: databaseAgent,
        postgresAgentShort: databaseAgentShort,
        realm: sso.realm || null,
        clientId: sso.clientId || null,
        redirectUri: sso.redirectUri || null,
        logoutRedirectUri: sso.logoutRedirectUri || null,
        baseUrl: sso.baseUrl || null,
        scope: sso.scope || 'openid profile email'
    };
}

function setSsoConfig(partial) {
    const current = workspaceSvc.getConfig() || {};
    const existing = getSsoConfig();
    const merged = { ...existing, ...partial, enabled: true };

    const providerAgent = partial.providerAgent || partial.keycloakAgent || merged.providerAgent || merged.keycloakAgent || 'keycloak';
    merged.providerAgent = providerAgent;
    merged.keycloakAgent = providerAgent;
    const providerAgentShort = extractShortAgentName(providerAgent);
    merged.providerAgentShort = providerAgentShort;
    merged.keycloakAgentShort = providerAgentShort;

    const databaseAgent = partial.databaseAgent || partial.postgresAgent || merged.databaseAgent || merged.postgresAgent || 'postgres';
    merged.databaseAgent = databaseAgent;
    merged.postgresAgent = databaseAgent;
    const databaseAgentShort = extractShortAgentName(databaseAgent);
    merged.databaseAgentShort = databaseAgentShort;
    merged.postgresAgentShort = databaseAgentShort;

    current.sso = merged;
    workspaceSvc.setConfig(current);
    return merged;
}

function setSsoEnabled(enabled = true) {
    const current = workspaceSvc.getConfig() || {};
    const existing = current.sso || {};
    current.sso = { ...existing, enabled: Boolean(enabled) };
    workspaceSvc.setConfig(current);
    return current.sso;
}

function disableSsoConfig() {
    const current = workspaceSvc.getConfig() || {};
    const existing = current.sso || {};
    current.sso = { ...existing, enabled: false };
    workspaceSvc.setConfig(current);
    return current.sso;
}

// Resolve SSO configuration with environment variable fallbacks

function getSsoSecrets() {
    const config = getSsoConfig();
    const envValues = resolveEnvRoleValues();
    
    return {
        baseUrl: config.baseUrl || envValues.baseUrl || '',
        realm: config.realm || envValues.realm || '',
        clientId: config.clientId || envValues.clientId || '',
        clientSecret: envValues.clientSecret || '',
        redirectUri: config.redirectUri || envValues.redirectUri || '',
        logoutRedirectUri: config.logoutRedirectUri || envValues.logoutRedirectUri || '',
        scope: config.scope || envValues.scope || 'openid profile email',
        adminUser: envValues.adminUser || '',
        adminPassword: envValues.adminPassword || '',
        hostname: envValues.hostname || '',
        hostnameStrict: envValues.hostnameStrict || '',
        httpEnabled: envValues.httpEnabled || '',
        proxy: envValues.proxy || '',
        dbEngine: envValues.dbEngine || '',
        dbUrl: envValues.dbUrl || '',
        dbUsername: envValues.dbUsername || '',
        dbPassword: envValues.dbPassword || ''
    };
}

function gatherSsoStatus() {
    const config = getSsoConfig();
    const secrets = getSsoSecrets();
    return {
        config,
        secrets,
        routerPort: getRouterPort(),
        providerHostPort: getAgentHostPort(config.providerAgentShort || config.keycloakAgentShort)
    };
}

function normalizeBaseUrl(raw) {
    if (!raw) return '';
    let value = String(raw).trim();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) {
        value = `http://${value}`;
    }
    try {
        const url = new URL(value);
        const normalizedPath = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';
        return `${url.origin}${normalizedPath}`;
    } catch (_) {
        return value.replace(/\/+$/, '');
    }
}

export {
    getSsoConfig,
    setSsoConfig,
    setSsoEnabled,
    disableSsoConfig,
    getSsoSecrets,
    gatherSsoStatus,
    getRouterPort,
    getAgentHostPort,
    normalizeBaseUrl,
    extractShortAgentName,
    SSO_ENV_ROLE_CANDIDATES,
    resolveEnvRoleValues
};
