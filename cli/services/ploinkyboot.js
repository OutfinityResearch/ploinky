import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PLOINKY_DIR } from './config.js';
import * as repos from './repos.js';

const DEFAULT_REPO_URL = 'https://github.com/PloinkyRepos/Basic.git';

function ensureDefaultRepo() {
    const reposDir = path.join(PLOINKY_DIR, 'repos');
    const defaultRepoPath = path.join(reposDir, 'basic');
    try {
        fs.mkdirSync(reposDir, { recursive: true });
    } catch (_) {}
    if (!fs.existsSync(defaultRepoPath)) {
        console.log("Default 'basic' repository not found. Cloning...");
        try {
            execSync(`git clone ${DEFAULT_REPO_URL} ${defaultRepoPath}`, { stdio: 'inherit' });
            console.log('Default repository cloned successfully.');
        } catch (error) {
            console.error(`Error cloning default repository: ${error.message}`);
        }
    }
}

export function bootstrap() {
    ensureDefaultRepo();
    try {
        const list = repos.loadEnabledRepos();
        const basicPath = path.join(PLOINKY_DIR, 'repos', 'basic');
        if (fs.existsSync(basicPath) && !list.includes('basic')) {
            list.push('basic');
            repos.saveEnabledRepos(list);
        }
    } catch (_) {}
}
