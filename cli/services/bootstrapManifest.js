import fs from 'fs';
import path from 'path';
import * as repos from './repos.js';
import { enableAgent } from './agents.js';
import { findAgent } from './utils.js';

export async function applyManifestDirectives(agentNameOrPath) {
    let manifest;
    let baseDir;
    if (agentNameOrPath.endsWith('.json')) {
        manifest = JSON.parse(fs.readFileSync(agentNameOrPath, 'utf8'));
        baseDir = path.dirname(agentNameOrPath);
    } else {
        const { manifestPath } = findAgent(agentNameOrPath);
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        baseDir = path.dirname(manifestPath);
    }

    const r = manifest.repos;
    if (r && typeof r === 'object') {
        for (const [name, url] of Object.entries(r)) {
            try {
                repos.addRepo(name, url);
            } catch (_) {}
            try {
                repos.enableRepo(name);
            } catch (e) {}
        }
    }

    const en = manifest.enable;
    if (Array.isArray(en)) {
        for (const a of en) {
            try {
                enableAgent(a);
            } catch (_) {}
        }
    }
}
