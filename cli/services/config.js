import fs from 'fs';
import path from 'path';

export const WORKSPACE_ROOT = path.resolve(process.cwd());
export const PLOINKY_DIR = path.join(WORKSPACE_ROOT, '.ploinky');
export const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
export const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents.json');
export const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');
export const PROFILE_FILE = path.join(PLOINKY_DIR, 'profile');

// Workspace runtime structure lives under .ploinky/
export const AGENTS_WORK_DIR = path.join(PLOINKY_DIR, 'agents');
export const CODE_DIR = path.join(PLOINKY_DIR, 'code');
export const SKILLS_DIR = path.join(PLOINKY_DIR, 'skills');
export const LOGS_DIR = path.join(PLOINKY_DIR, 'logs');
export const SHARED_DIR = path.join(PLOINKY_DIR, 'shared');
export const RUNNING_DIR = path.join(PLOINKY_DIR, 'running');
export const ROUTING_FILE = path.join(PLOINKY_DIR, 'routing.json');
export const SERVERS_CONFIG_FILE = path.join(PLOINKY_DIR, 'servers.json');
export const TRANSCRIPTS_DIR = path.join(PLOINKY_DIR, 'transcripts');
export const DEPS_DIR = path.join(PLOINKY_DIR, 'deps');
export const GLOBAL_DEPS_CACHE_DIR = path.join(DEPS_DIR, 'global');
export const AGENTS_DEPS_CACHE_DIR = path.join(DEPS_DIR, 'agents');
export const HISTORY_FILE = path.join(PLOINKY_DIR, 'ploinky_history');
export const TEMPLATES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../../templates');
export const GLOBAL_DEPS_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '../../globalDeps');

let DEBUG_MODE = process.env.PLOINKY_DEBUG === '1';

export function setDebugMode(enabled) {
    DEBUG_MODE = Boolean(enabled);
}

export function isDebugMode() {
    return DEBUG_MODE;
}

export function initEnvironment() {
    if (!fs.existsSync(PLOINKY_DIR)) {
        console.log(`Initializing Ploinky environment in ${path.resolve(PLOINKY_DIR)}...`);
        fs.mkdirSync(PLOINKY_DIR, { recursive: true });
    }

    const requiredDirs = [
        REPOS_DIR,
        AGENTS_WORK_DIR,
        CODE_DIR,
        SKILLS_DIR,
        LOGS_DIR,
        SHARED_DIR,
        RUNNING_DIR,
        TRANSCRIPTS_DIR,
    ];
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    if (!fs.existsSync(AGENTS_FILE)) {
        fs.writeFileSync(AGENTS_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(SECRETS_FILE)) {
        fs.writeFileSync(SECRETS_FILE, '# This file stores secrets for Ploinky agents.\n');
    }

    if (!fs.existsSync(HISTORY_FILE)) {
        fs.writeFileSync(HISTORY_FILE, '');
    }
}
