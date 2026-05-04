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
    basic: { url: 'https://github.com/PloinkyRepos/Basic.git', description: 'Default base agents', kind: 'agents' },
    cloud: { url: 'https://github.com/PloinkyRepos/cloud.git', description: 'Cloud infrastructure agents', kind: 'agents' },
    vibe: { url: 'https://github.com/PloinkyRepos/vibe.git', description: 'Vibe coding agents', kind: 'agents' },
    security: { url: 'https://github.com/PloinkyRepos/security.git', description: 'Security and scanning tools', kind: 'agents' },
    extra: { url: 'https://github.com/PloinkyRepos/extra.git', description: 'Additional utility agents', kind: 'agents' },
    AchillesIDE: { url: 'https://github.com/PloinkyRepos/AssistOSExplorer.git', description: 'Workspace IDE with Explorer UI, SOPLang editing and Git workflows', kind: 'agents' },
    AchillesCLI: { url: 'https://github.com/OutfinityResearch/AchillesCLI.git', description: 'Workspace CLI for setup and management', kind: 'agents' },
    demo: { url: 'https://github.com/PloinkyRepos/demo.git', description: 'Demo agents and examples', kind: 'agents' },
    proxies: { url: 'https://github.com/PloinkyRepos/proxies.git', description: 'API proxy agents (Kiro Gateway)', kind: 'agents' },
    AchillesCopilotBasicSkills: { url: 'https://github.com/AssistOS-AI/AchillesCopilotBasicSkills.git', description: 'Default Anthropic-style skill catalog (SKILL.md folders)', kind: 'skills' }
};

export function getPredefinedRepos() {
    return PREDEFINED_REPOS;
}

export function classifyRepoKind(repoName) {
    const declared = PREDEFINED_REPOS[repoName]?.kind;
    if (declared) return declared;

    const repoPath = path.join(PLOINKY_DIR, 'repos', repoName);
    if (!fs.existsSync(repoPath)) return 'unknown';

    let hasSkills = false;
    const skillsDir = path.join(repoPath, 'skills');
    try {
        if (fs.statSync(skillsDir).isDirectory()) {
            const subs = fs.readdirSync(skillsDir, { withFileTypes: true });
            hasSkills = subs.some(entry => entry.isDirectory()
                && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')));
        }
    } catch (_) {}

    let hasAgents = false;
    try {
        const top = fs.readdirSync(repoPath, { withFileTypes: true });
        hasAgents = top.some(entry => entry.isDirectory()
            && entry.name !== 'skills'
            && !entry.name.startsWith('.')
            && fs.existsSync(path.join(repoPath, entry.name, 'manifest.json')));
    } catch (_) {}

    if (hasSkills && hasAgents) return 'mixed';
    if (hasSkills) return 'skills';
    if (hasAgents) return 'agents';
    return 'unknown';
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
    const rawName = String(name || '');
    const preset = PREDEFINED_REPOS[rawName]
        || PREDEFINED_REPOS[rawName.toLowerCase()]
        || Object.entries(PREDEFINED_REPOS).find(([key]) => key.toLowerCase() === rawName.toLowerCase())?.[1];
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

    if (PREDEFINED_REPOS[name]?.kind === 'skills') {
        throw new Error(`Repo '${name}' is a skills-only repo (no agents). Use 'default-skills ${name}' to install its skills into the workspace.`);
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

    if (classifyRepoKind(name) === 'skills') {
        throw new Error(`Repo '${name}' contains only skills (no agents found). Use 'default-skills ${name}' to install its skills into the workspace.`);
    }

    const list = loadEnabledRepos();
    if (!list.includes(name)) {
        list.push(name);
        saveEnabledRepos(list);
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
    if (!isGitRepository(repoPath)) {
        throw new Error(`Repository '${name}' is not a git repository.`);
    }
    const args = ['-C', repoPath, 'pull'];
    if (rebase) args.push('--rebase');
    if (autostash) args.push('--autostash');
    execFileSync('git', args, { stdio: 'inherit' });
    return true;
}

export function isGitRepository(repoPath) {
    if (!repoPath) return false;
    try {
        return fs.existsSync(path.join(repoPath, '.git'));
    } catch (_) {
        return false;
    }
}

export function findWorkspaceGitRepos(workspaceRoot) {
    const root = path.resolve(workspaceRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Search root '${root}' is not a directory.`);
    }

    const repos = [];
    const ignoredDirNames = new Set([
        '.git',
        '.ploinky',
        'node_modules',
        'globalDeps',
    ]);

    function visit(dir) {
        if (fs.existsSync(path.join(dir, '.git'))) {
            repos.push({ name: path.basename(dir), path: dir });
            if (dir !== root) return;
        }

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            if (err?.code === 'EACCES' || err?.code === 'EPERM') return;
            throw err;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('.') || ignoredDirNames.has(entry.name)) continue;
            visit(path.join(dir, entry.name));
        }
    }

    visit(root);
    return repos;
}

export function pullGitRepo(repoPath, { rebase = true, autostash = true } = {}) {
    const args = ['-C', repoPath, 'pull'];
    if (rebase) args.push('--rebase');
    if (autostash) args.push('--autostash');
    execFileSync('git', args, { stdio: 'inherit' });
    return true;
}
