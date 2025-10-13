import fs from 'fs';
import path from 'path';
import { SECRETS_FILE } from './config.js';
import { getConfig } from './workspace.js';
import { findAgent } from './utils.js';

function ensureSecretsFile() {
    try {
        const dir = path.dirname(SECRETS_FILE);
        if (dir && dir !== '.') {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (_) {}
        }
        if (!fs.existsSync(SECRETS_FILE)) {
            fs.writeFileSync(SECRETS_FILE, '# Ploinky secrets\n');
        }
    } catch (_) {}
}

export function parseSecrets() {
    ensureSecretsFile();
    const map = {};
    try {
        const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
        for (const line of (raw.split('\n') || [])) {
            if (!line || line.trim().startsWith('#')) continue;
            const idx = line.indexOf('=');
            if (idx > 0) {
                const k = line.slice(0, idx).trim();
                const v = line.slice(idx + 1);
                if (k) map[k] = v;
            }
        }
    } catch (_) {}
    return map;
}

export function setEnvVar(name, value) {
    if (!name) throw new Error('Missing variable name.');
    ensureSecretsFile();
    let lines = [];
    try {
        lines = fs.readFileSync(SECRETS_FILE, 'utf8').split('\n');
    } catch (_) {
        lines = [];
    }
    const envLine = `${name}=${value ?? ''}`;
    const idx = lines.findIndex(l => String(l).startsWith(name + '='));
    if (idx >= 0) lines[idx] = envLine;
    else lines.push(envLine);
    fs.writeFileSync(SECRETS_FILE, lines.filter(x => x !== undefined).join('\n'));
}

export function deleteVar(name) {
    if (!name) return;
    ensureSecretsFile();
    let lines = [];
    try {
        lines = fs.readFileSync(SECRETS_FILE, 'utf8').split('\n');
    } catch (_) {
        lines = [];
    }
    const idx = lines.findIndex(l => String(l).startsWith(name + '='));
    if (idx >= 0) {
        lines.splice(idx, 1);
        fs.writeFileSync(SECRETS_FILE, lines.join('\n'));
    }
}

export function declareVar(name) {
    return setEnvVar(name, '');
}

function resolveAlias(value, secrets, seen = new Set()) {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('$')) return value;
    const ref = value.slice(1);
    if (!ref || seen.has(ref)) return '';
    seen.add(ref);
    const next = secrets[ref];
    if (next === undefined) return '';
    return resolveAlias(next, secrets, seen);
}

export function resolveVarValue(name) {
    const secrets = parseSecrets();
    const raw = secrets[name];
    if (raw === undefined) return '';
    return resolveAlias(raw, secrets);
}

function toBool(value, defaultValue = false) {
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return defaultValue;
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    return defaultValue;
}

export function getManifestEnvSpecs(manifest) {
    const specs = [];
    const env = manifest?.env;
    if (!env) return specs;

    if (Array.isArray(env)) {
        for (const entry of env) {
            if (entry === undefined || entry === null) continue;
            if (typeof entry === 'object' && !Array.isArray(entry)) {
                const { name, value, varName, required } = entry;
                const insideName = typeof name === 'string' ? name.trim() : '';
                if (!insideName) continue;
                const sourceName = typeof varName === 'string' && varName.trim() ? varName.trim() : insideName;
                specs.push({
                    insideName,
                    sourceName,
                    required: toBool(required, false),
                    defaultValue: value
                });
                continue;
            }
            const text = String(entry).trim();
            if (!text) continue;
            let insideName = text;
            let defaultValue;
            const eqIdx = text.indexOf('=');
            if (eqIdx >= 0) {
                insideName = text.slice(0, eqIdx).trim();
                defaultValue = text.slice(eqIdx + 1);
            }
            if (!insideName) continue;
            specs.push({
                insideName,
                sourceName: insideName,
                required: false,
                defaultValue
            });
        }
        return specs;
    }

    if (env && typeof env === 'object') {
        for (const [insideKey, rawSpec] of Object.entries(env)) {
            if (!insideKey) continue;
            const insideName = String(insideKey).trim();
            if (!insideName) continue;

            let sourceName = insideName;
            let required = false;
            let defaultValue;
            if (rawSpec && typeof rawSpec === 'object' && !Array.isArray(rawSpec)) {
                if (typeof rawSpec.varName === 'string' && rawSpec.varName.trim()) {
                    sourceName = rawSpec.varName.trim();
                } else if (typeof rawSpec.name === 'string' && rawSpec.name.trim()) {
                    sourceName = rawSpec.name.trim();
                }
                if (Object.prototype.hasOwnProperty.call(rawSpec, 'required')) {
                    required = toBool(rawSpec.required, false);
                }
                if (Object.prototype.hasOwnProperty.call(rawSpec, 'default')) {
                    defaultValue = rawSpec.default;
                } else if (Object.prototype.hasOwnProperty.call(rawSpec, 'value')) {
                    defaultValue = rawSpec.value;
                }
            } else {
                defaultValue = rawSpec;
            }

            specs.push({
                insideName,
                sourceName,
                required,
                defaultValue
            });
        }
    }

    return specs;
}

function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    const str = String(value);
    return str.trim().length === 0;
}

function resolveManifestEnv(manifest, secrets, options = {}) {
    const specs = getManifestEnvSpecs(manifest);
    const resolved = [];
    const missing = [];

    for (const spec of specs) {
        let resolvedValue;
        let usedDefault = false;
        const hasSecret = spec.sourceName && Object.prototype.hasOwnProperty.call(secrets, spec.sourceName);
        if (hasSecret) {
            resolvedValue = resolveAlias(secrets[spec.sourceName], secrets);
        } else if (spec.sourceName && Object.prototype.hasOwnProperty.call(process.env, spec.sourceName)) {
            resolvedValue = process.env[spec.sourceName];
        } else if (Object.prototype.hasOwnProperty.call(spec, 'defaultValue')) {
            resolvedValue = spec.defaultValue;
            usedDefault = true;
        } else {
            resolvedValue = undefined;
        }

        if (!usedDefault && (resolvedValue === undefined || resolvedValue === null) && Object.prototype.hasOwnProperty.call(spec, 'defaultValue')) {
            resolvedValue = spec.defaultValue;
            usedDefault = true;
        }

        const normalizedValue = resolvedValue === undefined || resolvedValue === null
            ? undefined
            : String(resolvedValue);

        if (spec.required && isEmptyValue(normalizedValue)) {
            missing.push(spec);
        }

        resolved.push({
            insideName: spec.insideName,
            sourceName: spec.sourceName,
            required: spec.required,
            value: normalizedValue,
            defaultValue: Object.prototype.hasOwnProperty.call(spec, 'defaultValue') ? spec.defaultValue : undefined,
            usedDefault
        });
    }

    if ((options?.enforceRequired) && missing.length) {
        const details = missing.map(spec =>
            (spec.sourceName && spec.sourceName !== spec.insideName)
                ? `${spec.insideName} (source: ${spec.sourceName})`
                : spec.insideName
        );
        const error = new Error(`Missing required environment variables: ${details.join(', ')}`);
        error.code = 'PLOINKY_ENV_REQUIRED_MISSING';
        error.missing = missing.map(spec => spec.insideName);
        throw error;
    }

    return { resolved, missing };
}

export function getManifestEnvNames(manifest) {
    return getManifestEnvSpecs(manifest).map(spec => spec.insideName);
}

export function collectManifestEnv(manifest, { enforceRequired = false } = {}) {
    const secrets = parseSecrets();
    return resolveManifestEnv(manifest, secrets, { enforceRequired });
}

export function getExposedNames(manifest) {
    const names = new Set(getManifestEnvNames(manifest));
    const exp = manifest?.expose;
    if (Array.isArray(exp)) {
        exp.forEach(e => {
            if (e && e.name) names.add(String(e.name));
        });
    } else if (exp && typeof exp === 'object') {
        Object.keys(exp).forEach(n => names.add(String(n)));
    }
    return Array.from(names);
}

function quoteEnvValue(value) {
    const str = String(value ?? '');
    const escaped = str.replace(/(["\\$`])/g, '\\$1').replace(/\n/g, '\\n');
    return `"${escaped}"`;
}

export function formatEnvFlag(name, value) {
    return `-e ${name}=${quoteEnvValue(value)}`;
}

export function buildEnvFlags(manifest) {
    const secrets = parseSecrets();
    const envEntries = resolveManifestEnv(manifest, secrets, { enforceRequired: true }).resolved;
    const out = [];
    for (const entry of envEntries) {
        if (entry.value !== undefined) {
            out.push(formatEnvFlag(entry.insideName, entry.value));
        }
    }
    const exp = manifest?.expose;
    if (Array.isArray(exp)) {
        for (const spec of exp) {
            if (!spec || !spec.name) continue;
            if (Object.prototype.hasOwnProperty.call(spec, 'value')) {
                out.push(formatEnvFlag(spec.name, spec.value));
            } else if (spec.ref) {
                const v = resolveAlias('$' + spec.ref, secrets);
                if (v !== undefined) out.push(formatEnvFlag(spec.name, v ?? ''));
            }
        }
    } else if (exp && typeof exp === 'object') {
        for (const [name, val] of Object.entries(exp)) {
            if (typeof val === 'string' && val.startsWith('$')) {
                const v = resolveAlias(val, secrets);
                if (v !== undefined) out.push(formatEnvFlag(name, v ?? ''));
            } else if (val !== undefined) {
                out.push(formatEnvFlag(name, val));
            }
        }
    }
    return out;
}

export function buildEnvMap(manifest) {
    const secrets = parseSecrets();
    const out = {};
    const envEntries = resolveManifestEnv(manifest, secrets, { enforceRequired: false }).resolved;
    for (const entry of envEntries) {
        if (entry.value !== undefined) {
            out[entry.insideName] = entry.value;
        }
    }
    const exp = manifest?.expose;
    if (Array.isArray(exp)) {
        for (const spec of exp) {
            if (!spec || !spec.name) continue;
            if (Object.prototype.hasOwnProperty.call(spec, 'value')) {
                out[spec.name] = String(spec.value);
            } else if (spec.ref) {
                out[spec.name] = resolveAlias('$' + spec.ref, secrets) ?? '';
            }
        }
    } else if (exp && typeof exp === 'object') {
        for (const [name, val] of Object.entries(exp)) {
            if (typeof val === 'string' && val.startsWith('$')) {
                out[name] = resolveAlias(val, secrets) ?? '';
            } else {
                out[name] = val !== undefined ? String(val) : '';
            }
        }
    }
    return out;
}

export function updateAgentExpose(manifestPath, exposedName, src) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.expose) manifest.expose = [];
    if (!Array.isArray(manifest.expose)) {
        const obj = manifest.expose;
        manifest.expose = Object.entries(obj).map(([name, val]) =>
            typeof val === 'string' && val.startsWith('$')
                ? { name, ref: val.slice(1) }
                : { name, value: val }
        );
    }
    manifest.expose = manifest.expose.filter(e => e && e.name !== exposedName);
    if (src && typeof src === 'string') {
        if (src.startsWith('$')) manifest.expose.push({ name: exposedName, ref: src.slice(1) });
        else manifest.expose.push({ name: exposedName, value: src });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

export function echoVar(nameOrAlias) {
    if (!nameOrAlias) return '';
    const isAlias = String(nameOrAlias).startsWith('$');
    const varName = isAlias ? String(nameOrAlias).slice(1) : String(nameOrAlias);
    if (!varName) return '';
    try {
        if (isAlias) {
            return resolveVarValue(varName) ?? '';
        }
        const rawMap = parseSecrets();
        const raw = rawMap[varName];
        return `${varName}=${raw ?? ''}`;
    } catch (_) {
        return '';
    }
}

function resolveAgentName(agentNameOpt) {
    if (agentNameOpt) return agentNameOpt;
    try {
        const cfg = getConfig();
        if (cfg && cfg.static && cfg.static.agent) {
            return cfg.static.agent;
        }
    } catch (_) {}
    return null;
}

export function exposeEnv(exposedName, valueOrRef, agentNameOpt) {
    const agentName = resolveAgentName(agentNameOpt);
    if (!agentName) {
        throw new Error('Missing agent name. Provide [agentName] or configure static with start <agent> <port>.');
    }
    const { manifestPath } = findAgent(agentName);
    updateAgentExpose(manifestPath, exposedName, valueOrRef);
    return { agentName, manifestPath };
}
