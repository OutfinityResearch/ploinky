/**
 * Smart caching utility for configuration values
 * Only recreates cached objects when the underlying value changes
 * 
 * Supports optional TTL (time-to-live) for performance optimization:
 * - TTL = 0 (default): Instant updates, checks config on every access
 * - TTL > 0: Caches for specified milliseconds, improves performance but delays updates
 */

class ConfigCache {
    /**
     * @param {number} defaultTtl - Default TTL in milliseconds (0 = disabled, instant updates)
     */
    constructor(defaultTtl = 0) {
        this.defaultTtl = defaultTtl;
        this.caches = new Map();
    }

    /**
     * Get or create a cached value based on a key
     * @param {string} cacheName - Name of the cache
     * @param {Function} valueGetter - Function that returns the current config value
     * @param {Function} factoryFn - Function that creates the cached object
     * @param {Object} options - Optional configuration
     * @param {number} options.ttl - Override TTL for this specific cache (milliseconds)
     * @returns The cached object (recreated only if value changed or TTL expired)
     */
    getOrCreate(cacheName, valueGetter, factoryFn, options = {}) {
        const ttl = options.ttl !== undefined ? options.ttl : this.defaultTtl;
        const cache = this.caches.get(cacheName) || { 
            value: null, 
            cached: null, 
            timestamp: 0 
        };

        const now = Date.now();
        const expired = ttl > 0 && (now - cache.timestamp > ttl);
        const noTtl = ttl === 0;

        // Check value if: no TTL (instant), TTL expired, or no cache exists
        if (noTtl || expired || cache.cached === null) {
            const currentValue = valueGetter();

            // Check if value changed (deep comparison for objects/arrays)
            const valueChanged = JSON.stringify(currentValue) !== JSON.stringify(cache.value);

            if (valueChanged || cache.cached === null) {
                cache.value = currentValue;
                cache.cached = factoryFn(currentValue);
                cache.timestamp = now;
                this.caches.set(cacheName, cache);
            } else if (expired) {
                // Value unchanged but TTL expired - update timestamp
                cache.timestamp = now;
                this.caches.set(cacheName, cache);
            }
        }

        return cache.cached;
    }

    /**
     * Invalidate a specific cache
     * @param {string} cacheName - Name of the cache to invalidate
     */
    invalidate(cacheName) {
        this.caches.delete(cacheName);
    }

    /**
     * Clear all caches
     */
    clearAll() {
        this.caches.clear();
    }

    /**
     * Get cache statistics for debugging
     * @returns {Object} Cache statistics
     */
    getStats() {
        const stats = {
            defaultTtl: this.defaultTtl,
            cacheCount: this.caches.size,
            caches: {}
        };

        for (const [name, cache] of this.caches.entries()) {
            const age = cache.timestamp > 0 ? Date.now() - cache.timestamp : null;
            stats.caches[name] = {
                hasValue: cache.cached !== null,
                age: age,
                lastUpdate: cache.timestamp > 0 ? new Date(cache.timestamp).toISOString() : null
            };
        }

        return stats;
    }
}

// Create singleton with TTL from environment variable
// PLOINKY_CONFIG_CACHE_TTL=0 (default): Instant updates
// PLOINKY_CONFIG_CACHE_TTL=1000: Cache for 1 second
// PLOINKY_CONFIG_CACHE_TTL=5000: Cache for 5 seconds
const ttlFromEnv = parseInt(process.env.PLOINKY_CONFIG_CACHE_TTL || '0', 10);
const ttl = Number.isNaN(ttlFromEnv) || ttlFromEnv < 0 ? 0 : ttlFromEnv;

export const configCache = new ConfigCache(ttl);

// Export class for testing
export { ConfigCache };

// Log TTL setting on startup for visibility
if (ttl > 0) {
    console.log(`[ConfigCache] TTL enabled: ${ttl}ms (config updates delayed by up to ${ttl}ms)`);
} else {
    console.log('[ConfigCache] TTL disabled: instant config updates');
}
