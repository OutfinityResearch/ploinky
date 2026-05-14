const TAG_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export function normalizeTagBackends(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const backends = Array.isArray(payload.backends) ? payload.backends : [];
    const entries = [];
    const seen = new Set();
    for (const backend of backends) {
        if (!backend || typeof backend !== 'object') continue;
        const id = typeof backend.id === 'string' ? backend.id.trim().replace(/^@+/, '').toLowerCase() : '';
        const tagList = Array.isArray(backend.tags) ? backend.tags : [];
        const label = typeof backend.label === 'string' ? backend.label : '';
        const description = typeof backend.description === 'string' ? backend.description : '';
        const candidates = new Set();
        if (TAG_NAME_RE.test(id)) candidates.add(id);
        for (const rawTag of tagList) {
            if (typeof rawTag !== 'string') continue;
            const normalized = rawTag.trim().replace(/^@+/, '').toLowerCase();
            if (TAG_NAME_RE.test(normalized)) candidates.add(normalized);
        }
        for (const tag of candidates) {
            if (seen.has(tag)) continue;
            seen.add(tag);
            entries.push({
                tag,
                label: label || tag,
                description: description || ''
            });
        }
    }
    return entries;
}

export function parseStaticTagList(value) {
    if (value === undefined || value === null) return [];
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    const seen = new Set();
    const entries = [];
    raw.split(/[,\s]+/).forEach((piece) => {
        const normalized = piece.trim().replace(/^@+/, '').toLowerCase();
        if (!TAG_NAME_RE.test(normalized)) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        entries.push({ tag: normalized, label: normalized, description: '' });
    });
    return entries;
}

function tokenRangeForTrigger(value, triggerInfo, triggerChar) {
    const inputValue = typeof value === 'string' ? value : '';
    const fallbackIdx = inputValue.lastIndexOf(triggerChar);
    const triggerIdx = Number.isInteger(triggerInfo?.triggerIndex)
        ? triggerInfo.triggerIndex
        : fallbackIdx;
    if (triggerIdx < 0 || inputValue.charAt(triggerIdx) !== triggerChar) {
        return null;
    }
    const afterTrigger = inputValue.slice(triggerIdx + 1);
    const stopMatch = afterTrigger.match(/[\s]/);
    const tokenEnd = stopMatch
        ? triggerIdx + 1 + stopMatch.index
        : triggerIdx + 1 + afterTrigger.length;
    return { triggerIdx, tokenEnd };
}

export function applyTagSelectionToValue(value, tag, triggerInfo = null) {
    const inputValue = typeof value === 'string' ? value : '';
    const range = tokenRangeForTrigger(inputValue, triggerInfo, '@');
    if (!range || !tag) return null;
    const insertText = `@${tag} `;
    const tailStart = insertText.endsWith(' ') && /\s/.test(inputValue.charAt(range.tokenEnd))
        ? range.tokenEnd + 1
        : range.tokenEnd;
    const next = inputValue.slice(0, range.triggerIdx) + insertText + inputValue.slice(tailStart);
    return {
        value: next,
        cursor: range.triggerIdx + insertText.length
    };
}

function applyTagSelection(value, tag, triggerInfo = null) {
    return applyTagSelectionToValue(value, tag, triggerInfo);
}

function hasDynamicCatalogConfig(launchConfig) {
    return Boolean(
        String(launchConfig['tag-relay-agent'] || launchConfig.tagRelayAgent || '').trim()
        || String(launchConfig['tag-relay-list-tool'] || launchConfig.tagRelayListTool || '').trim()
    );
}

export function createTagCatalogProvider({ launchConfig = {}, dlog } = {}) {
    const staticTags = parseStaticTagList(launchConfig['tag-relay-tags'] || launchConfig.tagRelayTags || '');
    if (!staticTags.length && hasDynamicCatalogConfig(launchConfig)) {
        dlog?.('TagCatalogProvider: dynamic tag catalog disabled in browser; use tag-relay-tags for suggestions');
    }

    function currentTags() {
        return staticTags;
    }

    function getSuggestions(value, caret, triggerInfo) {
        if (triggerInfo?.trigger !== '@') return [];
        const token = String(triggerInfo.token || '');
        if (/[/\\]/.test(token)) return [];
        const normalized = token.trim().toLowerCase();
        const entries = currentTags();
        if (!entries.length) return [];
        const matches = entries.filter((entry) => {
            if (!normalized) return true;
            return entry.tag.includes(normalized);
        });
        return matches.map((entry) => ({
            label: `@${entry.tag}`,
            description: entry.description || entry.label || '',
            applySelection: (current, currentTriggerInfo) => applyTagSelection(current, entry.tag, currentTriggerInfo),
            group: 'Tags'
        }));
    }

    function requestSuggestions() {
        return Promise.resolve(staticTags);
    }

    async function refresh() {
        return staticTags;
    }

    return {
        trigger: '@',
        groupLabel: 'Tags',
        getSuggestions,
        requestSuggestions,
        refresh
    };
}
