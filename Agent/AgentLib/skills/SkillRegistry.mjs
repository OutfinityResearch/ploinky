import { randomBytes, randomUUID } from 'node:crypto';
import { createFlexSearchAdapter } from '../search/flexsearchAdapter.mjs';

const DEFAULT_INDEX_OPTIONS = {
    tokenize: 'forward',
};

const SEARCHABLE_FIELDS = ['name', 'what', 'why', 'description', 'args', 'requiredArgs'];

function generateId() {
    if (typeof randomUUID === 'function') {
        return randomUUID();
    }
    return randomBytes(16).toString('hex');
}

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
    }

    registerSkill(skillSpecs, action) {
        if (typeof action !== 'function') {
            throw new TypeError('registerSkill requires a function action handler.');
        }
        const normalizedSpecs = sanitizeSpecs(skillSpecs);
        const skillId = generateId();

        const record = {
            skillId,
            ...normalizedSpecs,
            registeredAt: new Date().toISOString(),
        };

        this.skills.set(skillId, record);
        this.actions.set(skillId, action);

        const searchText = buildSearchText(record);
        if (searchText) {
            this.index.add(skillId, searchText);
        }

        return skillId;
    }

    rankSkill(taskDescription, options = {}) {
        if (!this.skills.size) {
            return [];
        }
        const query = typeof taskDescription === 'string' ? taskDescription.trim() : '';
        if (!query) {
            return [];
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
        for (const skillId of matches) {
            if (!seen.has(skillId) && this.skills.has(skillId)) {
                seen.add(skillId);
                filtered.push(skillId);
            }
            if (limit && filtered.length >= limit) {
                break;
            }
        }
        return filtered;
    }

    getSkill(skillId) {
        return this.skills.get(skillId) || null;
    }

    getSkillAction(skillId) {
        return this.actions.get(skillId) || null;
    }

    clear() {
        this.skills.clear();
        this.actions.clear();
        if (typeof this.index.clear === 'function') {
            this.index.clear();
        }
    }
}
