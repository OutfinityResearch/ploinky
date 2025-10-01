import fs from 'fs';
import { AGENTS_FILE, PLOINKY_DIR } from './config.js';

function ensureDirs() {
    try {
        fs.mkdirSync(PLOINKY_DIR, { recursive: true });
    } catch (_) {}
}

export function loadAgents() {
    ensureDirs();
    try {
        if (!fs.existsSync(AGENTS_FILE)) return {};
        const data = fs.readFileSync(AGENTS_FILE, 'utf8');
        return JSON.parse(data || '{}') || {};
    } catch (_) {
        return {};
    }
}

export function saveAgents(map) {
    ensureDirs();
    try {
        fs.writeFileSync(AGENTS_FILE, JSON.stringify(map || {}, null, 2));
    } catch (_) {}
}

export function listAgents() {
    return Object.values(loadAgents());
}

export function getAgentRecord(containerName) {
    const map = loadAgents();
    return map[containerName] || null;
}

export function upsertAgent(containerName, record) {
    const map = loadAgents();
    map[containerName] = { ...(record || {}) };
    saveAgents(map);
}

export function removeAgent(containerName) {
    const map = loadAgents();
    delete map[containerName];
    saveAgents(map);
}

export function getConfig() {
    const map = loadAgents();
    return map._config || {};
}

export function setConfig(cfg) {
    const map = loadAgents();
    map._config = cfg || {};
    saveAgents(map);
}
