import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PLOINKY_DIR } from './config.js';
import * as repos from './repos.js';

const DEFAULT_REPOS = [
    { name: 'basic', url: 'https://github.com/PloinkyRepos/Basic.git' },
    { name: 'AchillesIDE', url: 'https://github.com/PloinkyRepos/AssistOSExplorer.git' },
    { name: 'AchillesCLI', url: 'https://github.com/OutfinityResearch/AchillesCLI.git' },
];

export function getDefaultBootRepos() {
    return DEFAULT_REPOS.map(repo => ({ ...repo }));
}

function ensureRepo(name, url) {
    const reposDir = path.join(PLOINKY_DIR, 'repos');
    const repoPath = path.join(reposDir, name);
    try {
        fs.mkdirSync(reposDir, { recursive: true });
    } catch (_) {}
    if (!fs.existsSync(repoPath)) {
        console.log(`Default '${name}' repository not found. Cloning...`);
        try {
            execSync(`git clone ${url} ${repoPath}`, { stdio: 'inherit' });
            console.log(`${name} repository cloned successfully.`);
        } catch (error) {
            console.error(`Error cloning ${name} repository: ${error.message}`);
        }
    }
}

export function bootstrap() {
    for (const { name, url } of getDefaultBootRepos()) {
        ensureRepo(name, url);
    }
    try {
        const list = repos.loadEnabledRepos();
        for (const { name } of getDefaultBootRepos()) {
            const repoPath = path.join(PLOINKY_DIR, 'repos', name);
            if (fs.existsSync(repoPath) && !list.includes(name)) {
                list.push(name);
                repos.saveEnabledRepos(list);
            }
        }
    } catch (_) {}
}
