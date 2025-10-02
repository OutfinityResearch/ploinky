const DEFAULT_TTL_MS = 5 * 60 * 1000;

function createJwksCache({ ttlMs = DEFAULT_TTL_MS } = {}) {
    const cache = new Map(); // jwksUri -> { fetchedAt, keys: Map(kid -> jwk) }

    async function load(jwksUri) {
        const now = Date.now();
        const cached = cache.get(jwksUri);
        if (cached && now - cached.fetchedAt < ttlMs) {
            return cached.keys;
        }
        const res = await fetch(jwksUri, { method: 'GET' });
        if (!res.ok) {
            throw new Error(`Failed to fetch JWKS (${res.status})`);
        }
        const body = await res.json();
        const keys = new Map();
        if (Array.isArray(body?.keys)) {
            for (const jwk of body.keys) {
                if (jwk && jwk.kid) {
                    keys.set(jwk.kid, jwk);
                }
            }
        }
        cache.set(jwksUri, { fetchedAt: now, keys });
        return keys;
    }

    async function getKey(jwksUri, kid) {
        if (!jwksUri) throw new Error('JWKS URI missing');
        if (!kid) throw new Error('Token missing key id');
        const keys = await load(jwksUri);
        const jwk = keys.get(kid);
        if (!jwk) {
            // Refresh once if key missing
            cache.delete(jwksUri);
            const refreshed = await load(jwksUri);
            return refreshed.get(kid) || null;
        }
        return jwk;
    }

    function clear() {
        cache.clear();
    }

    return { getKey, clear };
}

export { createJwksCache };
