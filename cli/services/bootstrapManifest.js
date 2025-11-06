import fs from 'fs';
import path from 'path';
import * as repos from './repos.js';
import { enableAgent } from './agents.js';
import { findAgent } from './utils.js';

function parseEnableDirective(entry) {
    if (entry === null || entry === undefined) return null;
    const raw = typeof entry === 'string' ? entry : String(entry || '').trim();
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    const aliasIndex = tokens.findIndex(token => token.toLowerCase() === 'as');
    let alias;
    if (aliasIndex !== -1) {
        if (aliasIndex + 1 >= tokens.length) {
            throw new Error(`manifest enable entry '${entry}' is missing alias name after "as"`);
        }
        alias = tokens[aliasIndex + 1];
        tokens.splice(aliasIndex);
    }

    const spec = tokens.join(' ').trim();
    if (!spec) {
        throw new Error(`manifest enable entry '${entry}' is missing agent reference`);
    }
    return { spec, alias };
}

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
        for (const rawEntry of en) {
            try {
                const parsed = parseEnableDirective(rawEntry);
                if (!parsed) continue;
                enableAgent(parsed.spec, undefined, undefined, parsed.alias);
            } catch (err) {
                const message = err && err.message ? err.message : String(err);
                console.error(`[manifest enable] Failed to enable agent '${rawEntry}': ${message}`);
            }
        }
    }
}
