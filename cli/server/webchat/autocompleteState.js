export function createAutocompleteState() {
    const references = new Map();

    function keyOf(reference) {
        const kind = String(reference?.kind || '').trim();
        const path = String(reference?.path || '').trim();
        return `${kind}:${path}`;
    }

    function add(reference, { token } = {}) {
        if (!reference || typeof reference !== 'object') return;
        const sanitized = {
            kind: String(reference.kind || '').trim(),
            path: String(reference.path || '').trim(),
            type: reference.type ? String(reference.type).trim() : null,
            label: reference.label ? String(reference.label).trim() : null
        };
        if (!sanitized.kind || !sanitized.path) return;
        references.set(keyOf(sanitized), {
            reference: sanitized,
            token: typeof token === 'string' ? token : ''
        });
    }

    function snapshot() {
        return Array.from(references.values()).map((entry) => ({ ...entry.reference }));
    }

    function pruneByText(text) {
        if (typeof text !== 'string') return;
        for (const [key, entry] of references) {
            const token = entry.token;
            if (!token) continue;
            if (!text.includes(token)) {
                references.delete(key);
            }
        }
    }

    function clear() {
        references.clear();
    }

    return {
        add,
        snapshot,
        pruneByText,
        clear,
        get size() { return references.size; }
    };
}
