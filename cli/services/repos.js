import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { PLOINKY_DIR } from './config.js';

export const ENABLED_REPOS_FILE = path.join(PLOINKY_DIR, 'enabled_repos.json');

export function loadEnabledRepos() {
    try {
        const raw = fs.readFileSync(ENABLED_REPOS_FILE, 'utf8');
        const data = JSON.parse(raw || '[]');
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}

export function saveEnabledRepos(list) {
    try {
        fs.mkdirSync(PLOINKY_DIR, { recursive: true });
        fs.writeFileSync(ENABLED_REPOS_FILE, JSON.stringify(list || [], null, 2));
    } catch (_) {}
}

export function getInstalledRepos(REPOS_DIR) {
    try {
        return fs
            .readdirSync(REPOS_DIR)
            .filter(name => {
                try {
                    return fs.statSync(path.join(REPOS_DIR, name)).isDirectory();
                } catch (_) {
                    return false;
                }
            });
    } catch (_) {
        return [];
    }
}

export function getActiveRepos(REPOS_DIR) {
    const enabled = loadEnabledRepos();
    if (enabled && enabled.length) return enabled;
    return getInstalledRepos(REPOS_DIR);
}

const PREDEFINED_REPOS = {
    basic: { url: 'https://github.com/PloinkyRepos/Basic.git', description: 'Default base agents' },
    cloud: { url: 'https://github.com/PloinkyRepos/cloud.git', description: 'Cloud infrastructure agents' },
    vibe: { url: 'https://github.com/PloinkyRepos/vibe.git', description: 'Vibe coding agents' },
    security: { url: 'https://github.com/PloinkyRepos/security.git', description: 'Security and scanning tools' },
    extra: { url: 'https://github.com/PloinkyRepos/extra.git', description: 'Additional utility agents' },
    demo: { url: 'https://github.com/PloinkyRepos/demo.git', description: 'Demo agents and examples' },
    proxies: { url: 'https://github.com/PloinkyRepos/proxies.git', description: 'API proxy agents (Kiro Gateway)' }
};

export function getPredefinedRepos() {
    return PREDEFINED_REPOS;
}

function ensureReposDir() {
    const dir = path.join(PLOINKY_DIR, 'repos');
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    return dir;
}

export function resolveRepoUrl(name, url) {
    if (url && url.trim()) return url;
    const preset = PREDEFINED_REPOS[String(name || '').toLowerCase()];
    return preset ? preset.url : null;
}

export function addRepo(name, url, branch = null) {
    if (!name) throw new Error('Missing repository name.');
    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);
    if (fs.existsSync(repoPath)) {
        return { status: 'exists', path: repoPath, branch: null };
    }
    const actualUrl = resolveRepoUrl(name, url);
    if (!actualUrl) throw new Error(`Missing repository URL for '${name}'.`);
    let cloneCmd = `git clone ${actualUrl} ${repoPath}`;
    if (branch) {
        cloneCmd = `git clone --branch ${branch} ${actualUrl} ${repoPath}`;
    }
    execSync(cloneCmd, { stdio: 'inherit' });
    return { status: 'cloned', path: repoPath, branch: branch || 'default' };
}

export function enableRepo(name, branch = null) {
    if (!name) throw new Error('Missing repository name.');
    const list = loadEnabledRepos();
    if (!list.includes(name)) {
        list.push(name);
        saveEnabledRepos(list);
    }
    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);
    if (!fs.existsSync(repoPath)) {
        const url = resolveRepoUrl(name, null);
        if (!url) throw new Error(`No URL configured for repo '${name}'.`);
        let cloneCmd = `git clone ${url} ${repoPath}`;
        if (branch) {
            cloneCmd = `git clone --branch ${branch} ${url} ${repoPath}`;
        }
        execSync(cloneCmd, { stdio: 'inherit' });
    }
    return true;
}

export function disableRepo(name) {
    const list = loadEnabledRepos();
    const filtered = list.filter(r => r !== name);
    saveEnabledRepos(filtered);
    return true;
}

export function updateRepo(name, { rebase = true, autostash = true } = {}) {
    if (!name) throw new Error('Missing repository name.');
    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository '${name}' is not installed.`);
    }
    const args = ['-C', repoPath, 'pull'];
    if (rebase) args.push('--rebase');
    if (autostash) args.push('--autostash');
    execFileSync('git', args, { stdio: 'inherit' });
    return true;
}
