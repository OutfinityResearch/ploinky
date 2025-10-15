import fs from 'fs';
import path from 'path';
import net from 'net';
import { PLOINKY_DIR } from './config.js';
import * as reposSvc from './repos.js';
import { collectLiveAgentContainers, getAgentsRegistry } from './docker/index.js';
import { findAgent } from './utils.js';
import { gatherSsoStatus } from './sso.js';

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const PREDEFINED_REPOS = reposSvc.getPredefinedRepos();

export function findAgentManifest(agentName) {
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}

export function listRepos() {
    const enabled = new Set(reposSvc.loadEnabledRepos());
    const installed = new Set(reposSvc.getInstalledRepos(REPOS_DIR));
    const allRepos = { ...PREDEFINED_REPOS };

    for (const repo of installed) {
        if (!allRepos[repo]) {
            allRepos[repo] = { url: 'local', description: '' };
        }
    }

    console.log('Available repositories:');
    for (const [name, info] of Object.entries(allRepos)) {
        const isInstalled = installed.has(name);
        const isEnabled = enabled.has(name);
        const flags = `${isInstalled ? '[installed]' : ''}${isEnabled ? ' [enabled]' : ''}`.trim();
        const url = info.url === 'local' ? '(local)' : info.url;
        console.log(`- ${name}: ${url}${flags ? ` ${flags}` : ''}`);
    }
    console.log("\nTip: enable repos with 'enable repo <name>'. If none are enabled, installed repos are used by default for agent listings.");
}

export function listCurrentAgents() {
    const live = collectLiveAgentContainers();
    if (!live.length) {
        const legacy = getAgentsRegistry();
        const names = Object.keys(legacy || {});
        if (!names.length) {
            console.log('No running agent containers detected.');
            return;
        }
        console.log('No running agent containers detected. Last recorded registry entries:');
        for (const name of names) {
            const r = legacy[name] || {};
            const type = r.type || '-';
            const agent = r.agentName || '-';
            const repo = r.repoName || '-';
            const img = r.containerImage || '-';
            const cwd = r.projectPath || '-';
            const created = r.createdAt || '-';
            const binds = r.config?.binds ? r.config.binds.length : 0;
            const envs = r.config?.env ? r.config.env.length : 0;
            const ports = r.config?.ports
                ? r.config.ports.map(p => `${p.containerPort}->${p.hostPort}`).join(', ')
                : '';
            console.log(`- ${name}`);
            console.log(`    type: ${type}  agent: ${agent}  repo: ${repo}`);
            console.log(`    image: ${img}`);
            console.log(`    created: ${created}`);
            console.log(`    cwd: ${cwd}`);
            console.log(`    binds: ${binds}  env: ${envs}${ports ? `  ports: ${ports}` : ''}`);
        }
        return;
    }
    console.log('Running agent containers:');
    for (const entry of live) {
        const binds = entry.config?.binds?.length || 0;
        const envs = entry.config?.env?.length || 0;
        const ports = (entry.config?.ports || [])
            .map(p => `${p.containerPort}->${p.hostPort || ''}`)
            .filter(Boolean)
            .join(', ');
        console.log(`- ${entry.containerName}`);
        console.log(`    type: agent  agent: ${entry.agentName || '-'}  repo: ${entry.repoName || '-'}`);
        console.log(`    image: ${entry.containerImage || '-'}`);
        console.log(`    created: ${entry.createdAt || '-'}`);
        console.log(`    status: ${entry.state?.status || '-'} (pid ${entry.state?.pid || 0})`);
        console.log(`    cwd: ${entry.projectPath || '-'}`);
        console.log(`    binds: ${binds}  env: ${envs}${ports ? `  ports: ${ports}` : ''}`);
    }
}

export function collectAgentsSummary({ includeInactive = true } = {}) {
    const repoList = includeInactive
        ? reposSvc.getInstalledRepos(REPOS_DIR)
        : reposSvc.getActiveRepos(REPOS_DIR);

    const summary = [];
    if (!repoList || repoList.length === 0) return summary;

    for (const repo of repoList) {
        const repoPath = path.join(REPOS_DIR, repo);
        const installed = fs.existsSync(repoPath);
        const record = { repo, installed, agents: [] };

        if (installed) {
            let dirs = [];
            try {
                dirs = fs.readdirSync(repoPath);
            } catch (_) {
                dirs = [];
            }

            for (const name of dirs) {
                const agentDir = path.join(repoPath, name);
                const manifestPath = path.join(agentDir, 'manifest.json');
                try {
                    if (!fs.statSync(agentDir).isDirectory() || !fs.existsSync(manifestPath)) continue;
                } catch (_) {
                    continue;
                }

                let about = '-';
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    if (manifest && typeof manifest.about === 'string') {
                        about = manifest.about;
                    }
                } catch (_) {}

                record.agents.push({
                    repo,
                    name,
                    about,
                    manifestPath
                });
            }
        }

        summary.push(record);
    }

    return summary;
}

export function listAgents() {
    const summary = collectAgentsSummary();
    if (!summary.length) {
        console.log('No repos installed. Use: add repo <name>');
        return;
    }

    for (const { repo, installed, agents } of summary) {
        console.log(`\n[Repo] ${repo}${installed ? '' : ' (not installed)'}:`);
        if (!installed) {
            console.log(`  (install with: add repo ${repo})`);
            continue;
        }
        if (!agents.length) {
            console.log('  (no agents found)');
            continue;
        }
        for (const agent of agents) {
            console.log(`  - ${agent.name}: ${agent.about || '-'}`);
        }
    }
    console.log("\nTip: enable repos with 'enable repo <name>' to control listings. If none are enabled, installed repos are used by default.");
}

export function listRoutes() {
    try {
        const routingPath = path.resolve('.ploinky/routing.json');
        if (!fs.existsSync(routingPath)) {
            console.log('No routing configuration found (.ploinky/routing.json missing).');
            console.log("Tip: run 'start <staticAgent> <port>' to generate it.");
            return;
        }
        let routing = {};
        try {
            routing = JSON.parse(fs.readFileSync(routingPath, 'utf8')) || {};
        } catch (e) {
            console.log('Invalid routing.json (cannot parse).');
            return;
        }

        const port = routing.port || '-';
        const staticCfg = routing.static || {};
        const routes = routing.routes || {};

        console.log('Routing configuration (.ploinky/routing.json):');
        console.log(`- Port: ${port}`);
        if (staticCfg.agent) {
            console.log(`- Static agent: ${staticCfg.agent}`);
        }
        if (Object.keys(routes).length) {
            console.log('- Routes:');
            for (const [route, config] of Object.entries(routes)) {
                const hostPort = config.hostPort !== undefined ? config.hostPort : '-';
                const method = config.method || '-';
                const agent = config.agent || '-';
                console.log(
                    `  ${route} -> agent=${agent} method=${method} hostPort=${hostPort}`
                );
            }
        } else {
            console.log('- No dynamic routes defined.');
        }
    } catch (e) {
        console.error('Failed to read routing configuration:', e.message);
    }
}

function isPortListening(port, host = '127.0.0.1', timeoutMs = 500) {
    return new Promise((resolve) => {
        if (!Number.isFinite(port) || port <= 0) {
            resolve(false);
            return;
        }
        const socket = net.createConnection({ port, host });
        let settled = false;
        const done = (result) => {
            if (settled) return;
            settled = true;
            try { socket.destroy(); } catch (_) {}
            resolve(result);
        };
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        socket.setTimeout(timeoutMs, () => done(false));
    });
}

export async function statusWorkspace() {
    console.log('Workspace status:');
    const ssoStatus = gatherSsoStatus();
    if (!ssoStatus.config.enabled) {
        console.log('- SSO: disabled');
    } else {
        const baseUrl = ssoStatus.config.baseUrl || ssoStatus.secrets.baseUrl || '(unset)';
        const clientSecretState = ssoStatus.secrets.clientSecret ? '[set]' : '(unset)';
        const providerAgent = ssoStatus.config.providerAgent || ssoStatus.config.keycloakAgent;
        const providerShort = ssoStatus.config.providerAgentShort || ssoStatus.config.keycloakAgentShort || providerAgent;
        const providerLabel = providerShort && providerShort !== providerAgent
            ? `${providerAgent} (${providerShort})`
            : providerAgent;
        console.log('- SSO: enabled');
        console.log(`    Provider agent: ${providerLabel}${ssoStatus.providerHostPort ? ` (host port ${ssoStatus.providerHostPort})` : ''}`);
        const databaseAgent = ssoStatus.config.databaseAgent || ssoStatus.config.postgresAgent;
        const databaseShort = ssoStatus.config.databaseAgentShort || ssoStatus.config.postgresAgentShort || databaseAgent;
        const databaseLabel = databaseShort && databaseShort !== databaseAgent
            ? `${databaseAgent} (${databaseShort})`
            : databaseAgent;
        console.log(`    Realm / Client: ${ssoStatus.config.realm} / ${ssoStatus.config.clientId}`);
        console.log(`    Database agent: ${databaseLabel}`);
        console.log(`    Base URL: ${baseUrl}`);
        console.log(`    Redirect URI: ${ssoStatus.config.redirectUri || ssoStatus.secrets.redirectUri || `http://127.0.0.1:${ssoStatus.routerPort}/auth/callback`}`);
        console.log(`    Logout redirect: ${ssoStatus.config.logoutRedirectUri || ssoStatus.secrets.logoutRedirectUri || `http://127.0.0.1:${ssoStatus.routerPort}/`}`);
        console.log(`    Client secret: ${clientSecretState}`);
    }

    const routerPort = Number(ssoStatus.routerPort) || 8080;
    const routerListening = await isPortListening(routerPort);
    console.log(`- Router: ${routerListening ? 'listening' : 'not listening'} (127.0.0.1:${routerPort})`);
    listAgents();
    listCurrentAgents();
}
