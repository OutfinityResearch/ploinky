import fs from 'fs';
import path from 'path';
import { SECRETS_FILE } from './config.js';
import { getConfig } from './workspace.js';
import { findAgent } from './utils.js';
import { loadSecretsFile, loadEnvFile } from './secretInjector.js';

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

/**
 * Check if a string is a wildcard pattern (contains * character).
 * @param {string} pattern - The pattern to check
 * @returns {boolean} True if the pattern contains wildcard
 */
function isWildcardPattern(pattern) {
    return typeof pattern === 'string' && pattern.includes('*');
}

/**
 * Convert a wildcard pattern to a regular expression.
 * Supports patterns like:
 *   - "LLM_MODEL_*" - matches LLM_MODEL_ followed by anything
 *   - "LLM_MODEL*" - matches LLM_MODEL followed by anything
 *   - "*" - matches everything
 *   - "PREFIX_*_SUFFIX" - matches PREFIX_ + anything + _SUFFIX
 *
 * @param {string} pattern - The wildcard pattern
 * @returns {RegExp} The compiled regular expression
 */
function wildcardToRegex(pattern) {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace * with .* to match any characters
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr);
}

/**
 * Check if a variable name contains API_KEY (case-insensitive check).
 * These variables are considered sensitive and excluded from wildcard expansion.
 * @param {string} name - The variable name
 * @returns {boolean} True if the variable is an API key
 */
function isApiKeyVariable(name) {
    if (!name || typeof name !== 'string') return false;
    const upper = name.toUpperCase();
    return upper.includes('API_KEY') || upper.includes('APIKEY');
}

/**
 * Get all available environment variable names from all sources.
 * Sources checked (in order):
 *   1. process.env (current environment)
 *   2. .ploinky/.secrets file
 *   3. .env file in workspace root
 *
 * @returns {Set<string>} Set of all available variable names
 */
function getAllAvailableEnvNames() {
    const names = new Set();

    // Add from process.env
    for (const key of Object.keys(process.env)) {
        names.add(key);
    }

    // Add from .ploinky/.secrets
    try {
        const secretsMap = loadSecretsFile();
        for (const key of Object.keys(secretsMap)) {
            names.add(key);
        }
    } catch (_) {
        // Ignore errors
    }

    // Add from .env file
    try {
        const envMap = loadEnvFile();
        for (const key of Object.keys(envMap)) {
            names.add(key);
        }
    } catch (_) {
        // Ignore errors
    }

    return names;
}

/**
 * Expand a wildcard pattern into matching environment variable names.
 * For the special "*" pattern (match all), API_KEY variables are excluded.
 *
 * @param {string} pattern - The wildcard pattern (e.g., "LLM_MODEL_*", "*")
 * @returns {string[]} Array of matching variable names (sorted)
 */
function expandEnvWildcard(pattern) {
    if (!isWildcardPattern(pattern)) {
        return [pattern];
    }

    const allNames = getAllAvailableEnvNames();
    const regex = wildcardToRegex(pattern);
    const isMatchAll = pattern === '*';
    const matches = [];

    for (const name of allNames) {
        if (!regex.test(name)) {
            continue;
        }

        // For "*" (match all), exclude API_KEY variables
        // They must be explicitly specified in the manifest
        if (isMatchAll && isApiKeyVariable(name)) {
            continue;
        }

        matches.push(name);
    }

    // Sort for deterministic ordering
    return matches.sort();
}

/**
 * Get environment variable specifications from manifest or profile configuration.
 * Profile-based env takes precedence over top-level manifest env.
 *
 * Supports wildcard patterns in variable names:
 *   - "LLM_MODEL_*" - matches all variables starting with LLM_MODEL_
 *   - "LLM_MODEL*" - matches all variables starting with LLM_MODEL
 *   - "*" - matches all variables EXCEPT those containing API_KEY
 *
 * Variables containing "API_KEY" (case-insensitive) must be explicitly listed
 * and will not be included when using the "*" wildcard pattern.
 *
 * @param {object} manifest - The manifest object
 * @param {object} [profileConfig] - The merged profile configuration (optional)
 * @returns {Array} Array of env specs
 */
export function getManifestEnvSpecs(manifest, profileConfig) {
    const specs = [];
    const seenNames = new Set(); // Track seen names to avoid duplicates
    // Profile env takes precedence over top-level manifest env
    const env = profileConfig?.env || manifest?.env;
    if (!env) return specs;

    /**
     * Add a spec, handling wildcard expansion.
     * @param {string} insideName - The name inside the container
     * @param {string} sourceName - The source variable name
     * @param {boolean} required - Whether the variable is required
     * @param {*} defaultValue - Default value if not found
     */
    function addSpec(insideName, sourceName, required, defaultValue) {
        // Check if this is a wildcard pattern
        if (isWildcardPattern(insideName)) {
            // Expand the wildcard into matching variable names
            const expandedNames = expandEnvWildcard(insideName);
            for (const expandedName of expandedNames) {
                if (seenNames.has(expandedName)) continue;
                seenNames.add(expandedName);
                specs.push({
                    insideName: expandedName,
                    sourceName: expandedName,
                    required: false, // Wildcards are not required by default
                    defaultValue: undefined
                });
            }
        } else {
            // Regular non-wildcard entry
            if (seenNames.has(insideName)) return;
            seenNames.add(insideName);
            specs.push({
                insideName,
                sourceName,
                required,
                defaultValue
            });
        }
    }

    if (Array.isArray(env)) {
        for (const entry of env) {
            if (entry === undefined || entry === null) continue;
            if (typeof entry === 'object' && !Array.isArray(entry)) {
                const { name, value, varName, required } = entry;
                const insideName = typeof name === 'string' ? name.trim() : '';
                if (!insideName) continue;
                const sourceName = typeof varName === 'string' && varName.trim() ? varName.trim() : insideName;
                addSpec(insideName, sourceName, toBool(required, false), value);
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
            addSpec(insideName, insideName, false, defaultValue);
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

            addSpec(insideName, sourceName, required, defaultValue);
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
    const { profileConfig } = options;
    const specs = getManifestEnvSpecs(manifest, profileConfig);
    const resolved = [];
    const missing = [];

    // Lazy-load .env so we only read the file when .secrets and process.env
    // both miss.  Mirrors the fallback order in secretInjector.getSecret():
    //   1. .ploinky/.secrets  2. process.env  3. $CWD/.env
    let envFileCache;
    const getEnvFile = () => {
        if (envFileCache === undefined) {
            try { envFileCache = loadEnvFile(); } catch (_) { envFileCache = {}; }
        }
        return envFileCache;
    };

    for (const spec of specs) {
        let resolvedValue;
        let usedDefault = false;
        const hasSecret = spec.sourceName && Object.prototype.hasOwnProperty.call(secrets, spec.sourceName);
        if (hasSecret) {
            resolvedValue = resolveAlias(secrets[spec.sourceName], secrets);
        } else if (spec.sourceName && Object.prototype.hasOwnProperty.call(process.env, spec.sourceName)) {
            resolvedValue = process.env[spec.sourceName];
        } else if (spec.sourceName && Object.prototype.hasOwnProperty.call(getEnvFile(), spec.sourceName)) {
            resolvedValue = getEnvFile()[spec.sourceName];
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

export function getManifestEnvNames(manifest, profileConfig) {
    return getManifestEnvSpecs(manifest, profileConfig).map(spec => spec.insideName);
}

export function collectManifestEnv(manifest, { enforceRequired = false, profileConfig } = {}) {
    const secrets = parseSecrets();
    return resolveManifestEnv(manifest, secrets, { enforceRequired, profileConfig });
}

export function getExposedNames(manifest, profileConfig) {
    const names = new Set(getManifestEnvNames(manifest, profileConfig));
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

export function buildEnvFlags(manifest, profileConfig) {
    const secrets = parseSecrets();
    const envEntries = resolveManifestEnv(manifest, secrets, { enforceRequired: true, profileConfig }).resolved;
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

export function buildEnvMap(manifest, profileConfig) {
    const secrets = parseSecrets();
    const out = {};
    const envEntries = resolveManifestEnv(manifest, secrets, { enforceRequired: false, profileConfig }).resolved;
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
    let source = valueOrRef;
    if (source === undefined || source === null) {
        source = `$${exposedName}`;
    }
    const { manifestPath } = findAgent(agentName);
    updateAgentExpose(manifestPath, exposedName, source);
    return { agentName, manifestPath };
}

// Export wildcard-related functions for testing and external use
export {
    isWildcardPattern,
    wildcardToRegex,
    isApiKeyVariable,
    getAllAvailableEnvNames,
    expandEnvWildcard
};
