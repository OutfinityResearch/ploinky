const MAX_INFLIGHT_CACHE = 16;

function sanitizeBrowserToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return { folder: '', leaf: '' };
    if (raw.includes('\0')) return null;
    const body = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
    const normalized = body.replace(/\\+/g, '/');
    if (normalized.startsWith('/')) return null;
    if (normalized.split('/').some((segment) => segment === '..')) return null;
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return { folder: '', leaf: normalized };
    return {
        folder: normalized.slice(0, lastSlash),
        leaf: normalized.slice(lastSlash + 1)
    };
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
    const stopMatch = afterTrigger.match(/\s/);
    const tokenEnd = stopMatch
        ? triggerIdx + 1 + stopMatch.index
        : triggerIdx + 1 + afterTrigger.length;
    return { triggerIdx, tokenEnd };
}

export function applyWorkspacePathSelectionToValue(value, relativePath, type, triggerInfo = null) {
    const inputValue = typeof value === 'string' ? value : '';
    const range = tokenRangeForTrigger(inputValue, triggerInfo, '@');
    if (!range) return null;
    const tokenBody = `file:${relativePath}`;
    const insertText = type === 'folder' ? `@${tokenBody}/` : `@${tokenBody} `;
    const tailStart = insertText.endsWith(' ') && /\s/.test(inputValue.charAt(range.tokenEnd))
        ? range.tokenEnd + 1
        : range.tokenEnd;
    const next = inputValue.slice(0, range.triggerIdx) + insertText + inputValue.slice(tailStart);
    return {
        value: next,
        cursor: range.triggerIdx + insertText.length
    };
}

function suggestionRecord(item, { state, basePath, dlog }) {
    const kind = item.kind === 'folder' ? 'folder' : 'file';
    const relativePath = String(item.path || '').replace(/^\/+/, '');
    const label = String(item.label || relativePath);
    const description = kind === 'folder' ? 'Folder' : 'File';
    const token = `@file:${relativePath}`;
    return {
        label: kind === 'folder' ? `${label}/` : label,
        description,
        group: kind === 'folder' ? 'Folders' : 'Files',
        keepMenuOpen: kind === 'folder',
        applySelection: (current, triggerInfo) => applyWorkspacePathSelectionToValue(current, relativePath, kind, triggerInfo),
        onSelected: () => {
            if (kind === 'file' && state && typeof state.add === 'function') {
                try {
                    state.add({
                        kind: 'workspace-path',
                        path: relativePath,
                        type: 'file',
                        label
                    }, { token });
                } catch (err) {
                    dlog?.('WorkspacePathsProvider: failed to record reference', err?.message || err);
                }
            }
        }
    };
}

export function createWorkspacePathsProvider({ basePath, state, dlog } = {}) {
    const endpointBase = String(basePath || '').replace(/\/+$/, '') || '';
    const endpoint = endpointBase ? `${endpointBase}/suggestions/files` : '/webchat/suggestions/files';
    let cachedItems = [];
    let cachedKey = '';
    let pendingKey = '';
    const seenKeys = new Map();

    async function fetchSuggestions(folder, leaf) {
        const key = `${folder}::${leaf}`;
        if (key === cachedKey) return cachedItems;
        if (seenKeys.has(key)) return seenKeys.get(key);
        if (pendingKey === key) return cachedItems;
        pendingKey = key;
        const params = new URLSearchParams();
        params.set('query', folder ? `${folder}/${leaf || ''}` : (leaf || ''));
        const url = `${endpoint}?${params.toString()}`;
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                pendingKey = '';
                return [];
            }
            const body = await res.json().catch(() => null);
            const items = Array.isArray(body?.items) ? body.items : [];
            cachedItems = items;
            cachedKey = key;
            if (seenKeys.size >= MAX_INFLIGHT_CACHE) {
                const firstKey = seenKeys.keys().next().value;
                if (firstKey !== undefined) seenKeys.delete(firstKey);
            }
            seenKeys.set(key, items);
            return items;
        } catch (err) {
            dlog?.('WorkspacePathsProvider: suggestion fetch failed', err?.message || err);
            return [];
        } finally {
            pendingKey = '';
        }
    }

    function tokenFromTrigger(triggerInfo) {
        const token = String(triggerInfo?.token || '');
        if (!token) return { folder: '', leaf: '' };
        return sanitizeBrowserToken(token);
    }

    function getSuggestions(value, caret, triggerInfo) {
        if (triggerInfo?.trigger !== '@') return [];
        const parsed = tokenFromTrigger(triggerInfo);
        if (parsed === null) return [];
        const key = `${parsed.folder}::${parsed.leaf}`;
        if (key !== cachedKey) return [];
        const leafLower = parsed.leaf ? parsed.leaf.toLowerCase() : '';
        const matches = cachedItems.filter((item) => {
            const label = String(item?.label || '');
            if (!leafLower) return true;
            return label.toLowerCase().includes(leafLower);
        });
        return matches.map((item) => suggestionRecord(item, { state, basePath, dlog }));
    }

    function requestSuggestions(value, triggerInfo) {
        const parsed = tokenFromTrigger(triggerInfo);
        if (parsed === null) return Promise.resolve([]);
        return fetchSuggestions(parsed.folder, parsed.leaf);
    }

    return {
        trigger: '@',
        groupLabel: 'Files',
        getSuggestions,
        requestSuggestions
    };
}
