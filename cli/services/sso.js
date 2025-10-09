import fs from 'fs';
import path from 'path';

import * as workspaceSvc from './workspace.js';
import * as envSvc from './secretVars.js';

const ROUTING_FILE = path.resolve('.ploinky/routing.json');

const SSO_ENV_ROLE_CANDIDATES = {
    baseUrl: ['KEYCLOAK_URL', 'SSO_BASE_URL', 'SSO_URL', 'OIDC_BASE_URL'],
    realm: ['KEYCLOAK_REALM', 'SSO_REALM', 'OIDC_REALM'],
    clientId: ['KEYCLOAK_CLIENT_ID', 'SSO_CLIENT_ID', 'OIDC_CLIENT_ID'],
    clientSecret: ['KEYCLOAK_CLIENT_SECRET', 'SSO_CLIENT_SECRET', 'OIDC_CLIENT_SECRET'],
    scope: ['KEYCLOAK_SCOPE', 'SSO_SCOPE', 'OIDC_SCOPE'],
    redirectUri: ['KEYCLOAK_REDIRECT_URI', 'SSO_REDIRECT_URI', 'OIDC_REDIRECT_URI'],
    logoutRedirectUri: ['KEYCLOAK_LOGOUT_REDIRECT_URI', 'SSO_LOGOUT_REDIRECT_URI', 'OIDC_LOGOUT_REDIRECT_URI'],
    adminUser: ['KEYCLOAK_ADMIN', 'SSO_ADMIN', 'OIDC_ADMIN'],
    adminPassword: ['KEYCLOAK_ADMIN_PASSWORD', 'SSO_ADMIN_PASSWORD', 'OIDC_ADMIN_PASSWORD']
};

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

function normalizeEnvBindings(bindings) {
    if (!Array.isArray(bindings)) return [];
    const normalized = [];
    for (const entry of bindings) {
        if (!entry) continue;
        const inside = typeof entry.inside === 'string'
            ? entry.inside.trim()
            : typeof entry.insideName === 'string'
                ? entry.insideName.trim()
                : typeof entry.name === 'string'
                    ? entry.name.trim()
                    : '';
        if (!inside) continue;
        const host = typeof entry.host === 'string' && entry.host.trim()
            ? entry.host.trim()
            : typeof entry.sourceName === 'string' && entry.sourceName.trim()
                ? entry.sourceName.trim()
                : typeof entry.varName === 'string' && entry.varName.trim()
                    ? entry.varName.trim()
                    : '';
        normalized.push({
            inside,
            host: host || undefined,
            required: Boolean(entry.required)
        });
    }
    return normalized;
}

function readEnvValue(name) {
    if (!name) return '';
    try {
        const fromSecrets = envSvc.resolveVarValue(name);
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

function resolveEnvRoleValues(bindings = []) {
    const map = new Map();
    for (const binding of bindings) {
        if (!binding) continue;
        const names = new Set();
        if (binding.host) names.add(binding.host);
        names.add(binding.inside);
        for (const name of names) {
            const val = readEnvValue(name);
            if (val) map.set(name, val);
        }
    }
    const valueFromCandidates = (candidates = []) => {
        for (const name of candidates) {
            if (!name) continue;
            const val = map.get(name) || readEnvValue(name);
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
        adminPassword: valueFromCandidates(SSO_ENV_ROLE_CANDIDATES.adminPassword)
    };
}

function getSsoConfig() {
    const cfg = workspaceSvc.getConfig() || {};
    const sso = cfg.sso || {};
    const providerAgent = sso.providerAgent || sso.keycloakAgent || 'keycloak';
    const providerAgentShort = sso.providerAgentShort || sso.keycloakAgentShort || extractShortAgentName(providerAgent);
    const databaseAgent = sso.databaseAgent || sso.postgresAgent || 'postgres';
    const databaseAgentShort = sso.databaseAgentShort || sso.postgresAgentShort || extractShortAgentName(databaseAgent);
    const envBindings = normalizeEnvBindings(sso.envBindings);
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
        scope: sso.scope || 'openid profile email',
        envBindings
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

    if (Array.isArray(partial.envBindings)) {
        merged.envBindings = normalizeEnvBindings(partial.envBindings);
    } else if (!Array.isArray(merged.envBindings)) {
        merged.envBindings = [];
    }

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

function getSsoSecrets() {
    const config = getSsoConfig();
    const roleValues = resolveEnvRoleValues(config.envBindings);
    const baseUrl = config.baseUrl || roleValues.baseUrl || '';
    const realm = config.realm || roleValues.realm || '';
    const clientId = config.clientId || roleValues.clientId || '';
    const redirectUri = config.redirectUri || roleValues.redirectUri || '';
    const logoutRedirectUri = config.logoutRedirectUri || roleValues.logoutRedirectUri || '';
    const scope = config.scope || roleValues.scope || 'openid profile email';
    return {
        baseUrl,
        realm,
        clientId,
        clientSecret: roleValues.clientSecret || '',
        redirectUri,
        logoutRedirectUri,
        scope,
        adminUser: roleValues.adminUser || '',
        adminPassword: roleValues.adminPassword || ''
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
