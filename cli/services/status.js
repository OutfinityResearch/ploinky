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

const ANSI = {
    reset: '\u001B[0m',
    bold: '\u001B[1m',
    dim: '\u001B[2m',
    red: '\u001B[31m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    blue: '\u001B[34m',
    magenta: '\u001B[35m',
    cyan: '\u001B[36m',
    gray: '\u001B[90m'
};

const supportsColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function colorize(text, ...styles) {
    if (!supportsColor || styles.length === 0) return text;
    return `${styles.join('')}${text}${ANSI.reset}`;
}

const styles = {
    header: (text) => colorize(text, ANSI.bold, ANSI.cyan),
    label: (text) => colorize(text, ANSI.dim),
    name: (text) => colorize(text, ANSI.cyan),
    success: (text) => colorize(text, ANSI.green),
    warn: (text) => colorize(text, ANSI.yellow),
    danger: (text) => colorize(text, ANSI.red),
    info: (text) => colorize(text, ANSI.blue),
    accent: (text) => colorize(text, ANSI.magenta),
    muted: (text) => colorize(text, ANSI.gray),
    bold: (text) => colorize(text, ANSI.bold)
};

const bulletSymbol = supportsColor ? `${ANSI.gray}\u2022${ANSI.reset}` : '-';

function formatBadge(text, formatter = (value) => value) {
    return formatter(`[${text}]`);
}

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
            console.log(styles.warn('No running agent containers detected.'));
            return;
        }
        console.log(styles.warn('No running agent containers detected. Last recorded registry entries:'));
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
            console.log(`- ${styles.name(name)}`);
            console.log(`    ${styles.label('type')}: ${type}  ${styles.label('agent')}: ${styles.accent(agent)}  ${styles.label('repo')}: ${styles.accent(repo)}`);
            console.log(`    ${styles.label('image')}: ${img}`);
            console.log(`    ${styles.label('created')}: ${created}`);
            console.log(`    ${styles.label('cwd')}: ${cwd}`);
            console.log(`    ${styles.label('binds')}: ${binds}  ${styles.label('env')}: ${envs}${ports ? `  ${styles.label('ports')}: ${ports}` : ''}`);
        }
        return;
    }
    console.log(styles.header('Running agent containers:'));
    for (const entry of live) {
        const binds = entry.config?.binds?.length || 0;
        const envs = entry.config?.env?.length || 0;
        const ports = (entry.config?.ports || [])
            .map(p => `${p.containerPort}->${p.hostPort || ''}`)
            .filter(Boolean)
            .join(', ');
        const status = (entry.state?.status || '-').toLowerCase();
        const statusFormatter = ({
            running: styles.success,
            exited: styles.danger,
            paused: styles.warn,
            restarting: styles.warn,
            created: styles.info
        })[status] || styles.warn;
        const pidInfo = entry.state?.pid ? ` ${styles.muted(`pid ${entry.state.pid}`)}` : '';
        console.log(`  ${bulletSymbol} ${styles.name(entry.containerName)} ${statusFormatter(`[${status}]`)}${pidInfo}`);
        console.log(`     ${styles.label('agent')}: ${styles.accent(entry.agentName || '-')}` +
            `  ${styles.label('repo')}: ${styles.accent(entry.repoName || '-')}`);
        console.log(`     ${styles.label('image')}: ${entry.containerImage || '-'}`);
        console.log(`     ${styles.label('created')}: ${entry.createdAt || '-'}`);
        console.log(`     ${styles.label('cwd')}: ${entry.projectPath || '-'}`);
        const resourceParts = [
            `${styles.label('binds')}: ${binds}`,
            `${styles.label('env')}: ${envs}`
        ];
        if (ports) {
            resourceParts.push(`${styles.label('ports')}: ${ports}`);
        }
        console.log(`     ${resourceParts.join('  ')}`);
        console.log('');
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

function collectRepoStatusRows() {
    const enabled = new Set(reposSvc.loadEnabledRepos());
    const installedList = reposSvc.getInstalledRepos(REPOS_DIR);
    const installed = new Set(installedList);
    const allNames = new Set([ ...installedList, ...enabled ]);
    return Array.from(allNames)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
            name,
            enabled: enabled.has(name),
            installed: installed.has(name),
            predefined: PREDEFINED_REPOS[name] !== undefined
        }));
}

function listReposForStatus() {
    const rows = collectRepoStatusRows();
    if (!rows.length) {
        console.log(`- ${styles.label('Repos')}: ${styles.warn('none installed')}`);
        return;
    }
    console.log(`- ${styles.label('Repos')}:`);
    for (const row of rows) {
        const badges = [];
        if (row.enabled) badges.push(formatBadge('enabled', styles.success));
        if (!row.installed) badges.push(formatBadge('missing', styles.danger));
        else if (!row.predefined) badges.push(formatBadge('local', styles.info));
        const badgeText = badges.length ? ` ${badges.join(' ')}` : '';
        console.log(`  ${bulletSymbol} ${styles.name(row.name)}${badgeText}`);
    }
}

function printSsoStatusSummary(ssoStatus) {
    if (!ssoStatus.config.enabled) {
        console.log(`- ${styles.label('SSO')}: ${styles.danger('disabled')}`);
        return;
    }

    console.log(`- ${styles.label('SSO')}: ${styles.success('enabled')}`);

    const providerAgent = ssoStatus.config.providerAgent || ssoStatus.config.keycloakAgent;
    const providerShort = ssoStatus.config.providerAgentShort || ssoStatus.config.keycloakAgentShort || providerAgent;
    const providerLabel = providerShort && providerShort !== providerAgent
        ? `${providerAgent} (${providerShort})`
        : providerAgent;
    const providerHost = ssoStatus.providerHostPort
        ? ` ${styles.muted(`(host port ${ssoStatus.providerHostPort})`)}`
        : '';
    console.log(`  ${bulletSymbol} ${styles.label('Provider agent')}: ${styles.accent(providerLabel)}${providerHost}`);

    const databaseAgent = ssoStatus.config.databaseAgent || ssoStatus.config.postgresAgent;
    const databaseShort = ssoStatus.config.databaseAgentShort || ssoStatus.config.postgresAgentShort || databaseAgent;
    const databaseLabel = databaseShort && databaseShort !== databaseAgent
        ? `${databaseAgent} (${databaseShort})`
        : databaseAgent;
    console.log(`  ${bulletSymbol} ${styles.label('Database agent')}: ${styles.accent(databaseLabel)}`);

    const baseUrl = ssoStatus.config.baseUrl || ssoStatus.secrets.baseUrl || '(unset)';
    const redirectUri = ssoStatus.config.redirectUri || ssoStatus.secrets.redirectUri || `http://127.0.0.1:${ssoStatus.routerPort}/auth/callback`;
    const logoutRedirect = ssoStatus.config.logoutRedirectUri || ssoStatus.secrets.logoutRedirectUri || `http://127.0.0.1:${ssoStatus.routerPort}/`;
    const clientSecretState = ssoStatus.secrets.clientSecret
        ? formatBadge('set', styles.success)
        : formatBadge('unset', styles.danger);

    console.log(`  ${bulletSymbol} ${styles.label('Realm / Client')}: ${ssoStatus.config.realm} / ${ssoStatus.config.clientId}`);
    console.log(`  ${bulletSymbol} ${styles.label('Base URL')}: ${baseUrl}`);
    console.log(`  ${bulletSymbol} ${styles.label('Redirect URI')}: ${redirectUri}`);
    console.log(`  ${bulletSymbol} ${styles.label('Logout redirect')}: ${logoutRedirect}`);
    console.log(`  ${bulletSymbol} ${styles.label('Client secret')}: ${clientSecretState}`);
}

function printRouterStatus(routerPort, isListening) {
    const stateText = isListening ? styles.success('listening') : styles.danger('not listening');
    const endpoint = styles.muted(`(127.0.0.1:${routerPort})`);
    console.log(`- ${styles.label('Router')}: ${stateText} ${endpoint}`);
}

export async function statusWorkspace() {
    console.log(styles.header('Workspace status:'));
    const ssoStatus = gatherSsoStatus();
    printSsoStatusSummary(ssoStatus);

    const routerPort = Number(ssoStatus.routerPort) || 8080;
    const routerListening = await isPortListening(routerPort);
    printRouterStatus(routerPort, routerListening);

    listReposForStatus();
    listCurrentAgents();
}
