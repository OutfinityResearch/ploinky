import { createFlexSearchAdapter } from '../search/flexsearchAdapter.mjs';

const DEFAULT_INDEX_OPTIONS = {
    tokenize: 'forward',
};

const SEARCHABLE_FIELDS = ['name', 'what', 'why', 'description', 'args', 'requiredArgs', 'roles'];

function toSearchableText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(toSearchableText).join(' ');
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }
    return String(value);
}

function normalizeSearchResults(result) {
    if (!result) {
        return [];
    }
    if (Array.isArray(result)) {
        return result.map(entry => {
            if (typeof entry === 'string') {
                return entry;
            }
            if (entry && typeof entry === 'object') {
                if (typeof entry.id === 'string') {
                    return entry.id;
                }
                if (typeof entry.doc === 'string') {
                    return entry.doc;
                }
                if (typeof entry.key === 'string') {
                    return entry.key;
                }
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof result === 'object') {
        if (Array.isArray(result.result)) {
            return normalizeSearchResults(result.result);
        }
        if (Array.isArray(result.ids)) {
            return result.ids.filter(id => typeof id === 'string');
        }
    }
    return [];
}

function buildSearchText(skill) {
    return SEARCHABLE_FIELDS
        .map(field => toSearchableText(skill[field]))
        .filter(Boolean)
        .join(' ');
}

function normalizeSkillName(name) {
    if (typeof name !== 'string') {
        return '';
    }
    return name.trim().toLowerCase();
}

function sanitizeSpecs(specs) {
    if (!specs || typeof specs !== 'object') {
        throw new TypeError('Skill specifications must be provided as an object.');
    }

    const normalized = {};
    for (const key of Object.keys(specs)) {
        const value = specs[key];
        if (value === undefined) {
            continue;
        }
        normalized[key] = value;
    }

    if (!normalized.name || typeof normalized.name !== 'string') {
        throw new Error('Skill specification requires a "name" string.');
    }

    if (!normalized.description || typeof normalized.description !== 'string') {
        throw new Error('Skill specification requires a "description" string.');
    }

    return normalized;
}

export default class SkillRegistry {
    constructor(options = {}) {
        const { flexSearchAdapter, indexOptions } = options;
        this.index = flexSearchAdapter || createFlexSearchAdapter(indexOptions || DEFAULT_INDEX_OPTIONS);
        this.skills = new Map();
        this.actions = new Map();
        this.optionHandlers = new Map();
    }

    registerSkill(skillObj) {
        if (!skillObj || typeof skillObj !== 'object') {
            throw new TypeError('registerSkill requires a skill configuration object.');
        }

        const { specs, action, roles, getOptions } = skillObj;

        if (!specs || typeof specs !== 'object') {
            throw new TypeError('registerSkill requires a "specs" object.');
        }

        if (typeof action !== 'function') {
            throw new TypeError('registerSkill requires a function action handler.');
        }

        if (typeof getOptions !== 'undefined' && getOptions !== null && typeof getOptions !== 'function') {
            throw new TypeError('registerSkill requires getOptions to be a function when provided.');
        }

        const normalizedSpecs = sanitizeSpecs(specs);
        const canonicalName = normalizeSkillName(normalizedSpecs.name);
        if (!canonicalName) {
            throw new Error('Skill specification requires a non-empty name.');
        }

        if (!Array.isArray(roles)) {
            throw new TypeError('registerSkill requires a "roles" array.');
        }

        const normalizedRoles = Array.from(new Set(roles
            .map(role => (typeof role === 'string' ? role.trim() : ''))
            .filter(Boolean)
            .map(role => role.toLowerCase())));

        if (!normalizedRoles.length) {
            throw new Error('registerSkill requires at least one role.');
        }

        const record = {
            canonicalName,
            ...normalizedSpecs,
            roles: normalizedRoles,
            registeredAt: new Date().toISOString(),
        };

        if (this.skills.has(canonicalName)) {
            this.skills.delete(canonicalName);
            this.actions.delete(canonicalName);
            this.optionHandlers.delete(canonicalName);
            if (typeof this.index.remove === 'function') {
                try {
                    this.index.remove(canonicalName);
                } catch (error) {
                    // ignore removal issues; index will be refreshed via add below
                }
            }
        }

        this.skills.set(canonicalName, record);
        this.actions.set(canonicalName, action);
        if (typeof getOptions === 'function') {
            this.optionHandlers.set(canonicalName, getOptions);
        } else if (typeof record.getOptions === 'function') {
            this.optionHandlers.set(canonicalName, record.getOptions);
        } else {
            this.optionHandlers.delete(canonicalName);
        }

        const searchText = buildSearchText(record);
        if (searchText) {
            this.index.add(canonicalName, searchText);
        }

        return record.name;
    }

    rankSkill(taskDescription, options = {}) {
        if (!this.skills.size) {
            return [];
        }
        const query = typeof taskDescription === 'string' ? taskDescription.trim() : '';
        if (!query) {
            return [];
        }

        const normalizedRole = typeof options.role === 'string' && options.role.trim()
            ? options.role.trim().toLowerCase()
            : (typeof options.callerRole === 'string' && options.callerRole.trim()
                ? options.callerRole.trim().toLowerCase()
                : '');

        if (!normalizedRole) {
            throw new Error('rankSkill requires a caller role for access filtering.');
        }

        const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : options.limit === 0 ? 0 : 5;
        const searchOptions = {
            bool: options?.bool === 'and' ? 'and' : 'or',
            suggest: true,
            ...(limit ? { limit } : {}),
        };

        let rawResults;
        try {
            rawResults = this.index.search(query, searchOptions);
        } catch (error) {
            return [];
        }
        const matches = normalizeSearchResults(rawResults);
        if (!matches.length) {
            return [];
        }
        const seen = new Set();
        const filtered = [];
        for (const key of matches) {
            const canonical = normalizeSkillName(key);
            if (!canonical || seen.has(canonical)) {
                continue;
            }
            if (this.skills.has(canonical)) {
                const record = this.skills.get(canonical);
                if (Array.isArray(record.roles) && record.roles.includes(normalizedRole)) {
                    seen.add(canonical);
                    filtered.push(record.name);
                }
            }
            if (limit && filtered.length >= limit) {
                break;
            }
        }
        return filtered;
    }

    getSkill(skillName) {
        const canonical = normalizeSkillName(skillName);
        if (!canonical) {
            return null;
        }
        return this.skills.get(canonical) || null;
    }

    getSkillAction(skillName) {
        const canonical = normalizeSkillName(skillName);
        if (!canonical) {
            return null;
        }
        return this.actions.get(canonical) || null;
    }

    getSkillOptions(skillName) {
        const canonical = normalizeSkillName(skillName);
        if (!canonical) {
            return null;
        }
        const handler = this.optionHandlers.get(canonical);
        return typeof handler === 'function' ? handler : null;
    }

    clear() {
        this.skills.clear();
        this.actions.clear();
        this.optionHandlers.clear();
        if (typeof this.index.clear === 'function') {
            this.index.clear();
        }
    }
}
