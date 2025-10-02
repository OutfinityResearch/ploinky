import fs from 'fs';
import path from 'path';

import * as workspaceSvc from './workspace.js';
import * as envSvc from './secretVars.js';

const ROUTING_FILE = path.resolve('.ploinky/routing.json');

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

function getSsoConfig() {
    const cfg = workspaceSvc.getConfig() || {};
    const sso = cfg.sso || {};
    return {
        enabled: Boolean(sso.enabled),
        keycloakAgent: sso.keycloakAgent || 'keycloak',
        keycloakAgentShort: sso.keycloakAgentShort || extractShortAgentName(sso.keycloakAgent || 'keycloak'),
        postgresAgent: sso.postgresAgent || 'postgres',
        postgresAgentShort: sso.postgresAgentShort || extractShortAgentName(sso.postgresAgent || 'postgres'),
        realm: sso.realm || 'ploinky',
        clientId: sso.clientId || 'ploinky-router',
        redirectUri: sso.redirectUri || null,
        logoutRedirectUri: sso.logoutRedirectUri || null,
        baseUrl: sso.baseUrl || null,
        scope: sso.scope || 'openid profile email'
    };
}

function setSsoConfig(partial) {
    const current = workspaceSvc.getConfig() || {};
    const merged = { ...getSsoConfig(), ...partial, enabled: true };
    merged.keycloakAgentShort = extractShortAgentName(merged.keycloakAgent);
    merged.postgresAgentShort = extractShortAgentName(merged.postgresAgent);
    current.sso = merged;
    workspaceSvc.setConfig(current);
    return merged;
}

function disableSsoConfig() {
    const current = workspaceSvc.getConfig() || {};
    current.sso = { enabled: false };
    workspaceSvc.setConfig(current);
    return current.sso;
}

function getSsoSecrets() {
    return {
        baseUrl: envSvc.resolveVarValue('KEYCLOAK_URL') || '',
        realm: envSvc.resolveVarValue('KEYCLOAK_REALM') || '',
        clientId: envSvc.resolveVarValue('KEYCLOAK_CLIENT_ID') || '',
        clientSecret: envSvc.resolveVarValue('KEYCLOAK_CLIENT_SECRET') || '',
        redirectUri: envSvc.resolveVarValue('KEYCLOAK_REDIRECT_URI') || '',
        logoutRedirectUri: envSvc.resolveVarValue('KEYCLOAK_LOGOUT_REDIRECT_URI') || '',
        scope: envSvc.resolveVarValue('KEYCLOAK_SCOPE') || ''
    };
}

function gatherSsoStatus() {
    const config = getSsoConfig();
    const secrets = getSsoSecrets();
    return {
        config,
        secrets,
        routerPort: getRouterPort(),
        keycloakHostPort: getAgentHostPort(config.keycloakAgentShort)
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
    disableSsoConfig,
    getSsoSecrets,
    gatherSsoStatus,
    getRouterPort,
    getAgentHostPort,
    normalizeBaseUrl,
    extractShortAgentName
};
