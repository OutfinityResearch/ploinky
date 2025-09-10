const fs = require('fs');
const path = require('path');

const PLOINKY_DIR = '.ploinky';
const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents');
const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');

let DEBUG_MODE = process.env.PLOINKY_DEBUG === '1';

function setDebugMode(enabled) {
    DEBUG_MODE = !!enabled;
}

function isDebugMode() {
    return DEBUG_MODE;
}

function initEnvironment() {
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

module.exports = {
    initEnvironment,
    setDebugMode,
    isDebugMode,
    PLOINKY_DIR,
    REPOS_DIR,
    AGENTS_FILE,
    SECRETS_FILE,
};
