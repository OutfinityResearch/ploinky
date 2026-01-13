# cli/server/utils/configCache.js - Configuration Cache

## Overview

Smart caching utility for configuration values that only recreates cached objects when the underlying value changes. Supports optional TTL (time-to-live) for performance optimization.

## Source File

`cli/server/utils/configCache.js`

## Class: ConfigCache

### Constructor

**Purpose**: Creates a new ConfigCache instance

**Parameters**:
- `defaultTtl` (number): Default TTL in milliseconds (0 = disabled, instant updates)

**Implementation**:
```javascript
class ConfigCache {
    constructor(defaultTtl = 0) {
        this.defaultTtl = defaultTtl;
        this.caches = new Map();
    }
}
```

### getOrCreate(cacheName, valueGetter, factoryFn, options)

**Purpose**: Gets or creates a cached value based on a configuration key

**Parameters**:
- `cacheName` (string): Name of the cache
- `valueGetter` (Function): Function that returns the current config value
- `factoryFn` (Function): Function that creates the cached object
- `options` (Object):
  - `ttl` (number): Override TTL for this specific cache (milliseconds)

**Returns**: The cached object (recreated only if value changed or TTL expired)

**Behavior**:
- `TTL = 0` (default): Instant updates, checks config on every access
- `TTL > 0`: Caches for specified milliseconds, improves performance but delays updates

**Implementation**:
```javascript
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
```

### invalidate(cacheName)

**Purpose**: Invalidates a specific cache

**Parameters**:
- `cacheName` (string): Name of the cache to invalidate

**Implementation**:
```javascript
invalidate(cacheName) {
    this.caches.delete(cacheName);
}
```

### clearAll()

**Purpose**: Clears all caches

**Implementation**:
```javascript
clearAll() {
    this.caches.clear();
}
```

### getStats()

**Purpose**: Gets cache statistics for debugging

**Returns**: (Object) Cache statistics

**Implementation**:
```javascript
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
```

## Singleton Instance

A singleton instance is created with TTL from environment variable:

```javascript
// PLOINKY_CONFIG_CACHE_TTL=0 (default): Instant updates
// PLOINKY_CONFIG_CACHE_TTL=1000: Cache for 1 second
// PLOINKY_CONFIG_CACHE_TTL=5000: Cache for 5 seconds
const ttlFromEnv = parseInt(process.env.PLOINKY_CONFIG_CACHE_TTL || '0', 10);
const ttl = Number.isNaN(ttlFromEnv) || ttlFromEnv < 0 ? 0 : ttlFromEnv;

export const configCache = new ConfigCache(ttl);
```

## Exports

```javascript
export { configCache, ConfigCache };
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLOINKY_CONFIG_CACHE_TTL` | `0` | Cache TTL in milliseconds |

## TTL Behavior

| TTL Value | Behavior |
|-----------|----------|
| `0` | Instant updates - config checked on every access |
| `1000` | Cached for 1 second |
| `5000` | Cached for 5 seconds |

## Usage Example

```javascript
import { configCache } from './configCache.js';

// Cache a database connection based on config
const getDbConnection = () => configCache.getOrCreate(
    'database',
    () => ({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432', 10)
    }),
    (config) => new DatabaseConnection(config)
);

// Use cached connection
const db = getDbConnection();

// Invalidate when config changes
configCache.invalidate('database');

// Get cache statistics
const stats = configCache.getStats();
console.log(stats);
// {
//   defaultTtl: 0,
//   cacheCount: 1,
//   caches: {
//     database: { hasValue: true, age: 5000, lastUpdate: '...' }
//   }
// }
```

## Startup Logging

On startup, the cache logs its TTL setting:

```
[ConfigCache] TTL enabled: 1000ms (config updates delayed by up to 1000ms)
```

or

```
[ConfigCache] TTL disabled: instant config updates
```

## Related Modules

- [server-utils-tty-factories.md](./server-utils-tty-factories.md) - Uses config cache
- [server-utils-router-env.md](./server-utils-router-env.md) - Router environment
