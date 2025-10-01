import fs from 'fs';
import path from 'path';

export const PLOINKY_DIR = '.ploinky';
export const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
export const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents');
export const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');

let DEBUG_MODE = process.env.PLOINKY_DEBUG === '1';

export function setDebugMode(enabled) {
    DEBUG_MODE = Boolean(enabled);
}

export function isDebugMode() {
    return DEBUG_MODE;
}

export function initEnvironment() {
    let firstInit = false;
    if (!fs.existsSync(PLOINKY_DIR)) {
        console.log(`Initializing Ploinky environment in ${path.resolve(PLOINKY_DIR)}...`);
        fs.mkdirSync(PLOINKY_DIR);
        firstInit = true;
    }

    if (!fs.existsSync(REPOS_DIR)) {
        fs.mkdirSync(REPOS_DIR);
    }

    if (!fs.existsSync(AGENTS_FILE)) {
        fs.writeFileSync(AGENTS_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(SECRETS_FILE)) {
        fs.writeFileSync(SECRETS_FILE, '# This file stores secrets for Ploinky agents.\n');
    }
}
