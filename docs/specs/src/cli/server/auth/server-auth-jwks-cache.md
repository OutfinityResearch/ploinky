# cli/server/auth/jwksCache.js - JWKS Cache

## Overview

Caches JSON Web Key Sets (JWKS) from OAuth/OIDC providers for JWT signature verification. Implements automatic refresh when keys are not found.

## Source File

`cli/server/auth/jwksCache.js`

## Dependencies

None (uses built-in fetch)

## Constants

```javascript
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

## Public API

### createJwksCache(options)

**Purpose**: Creates a JWKS cache instance

**Parameters**:
- `options` (Object):
  - `ttlMs` (number): Cache TTL in milliseconds (default: 5 minutes)

**Returns**: Cache object with methods

**Cache Methods**:

| Method | Description |
|--------|-------------|
| `getKey(jwksUri, kid)` | Get JWK by key ID |
| `clear()` | Clear all cached keys |

**Implementation**:
```javascript
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
            // Refresh once if key missing (key rotation scenario)
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
```

## Cache Methods

### getKey(jwksUri, kid)

**Purpose**: Retrieves a JWK by key ID, with automatic refresh on miss

**Parameters**:
- `jwksUri` (string): JWKS endpoint URL
- `kid` (string): Key ID from JWT header

**Returns**: (Promise<Object|null>) JWK or null if not found

**Behavior**:
1. Check cache for JWKS
2. If cached and not expired, look up key by kid
3. If key found, return it
4. If key not found, refresh cache once (handles key rotation)
5. Return key or null

**Throws**: Error if jwksUri or kid missing

### clear()

**Purpose**: Clears all cached JWKS data

**Use case**: Configuration reload, force refresh

## JWK Structure

```javascript
{
    kty: "RSA",           // Key type
    kid: "key-id-123",    // Key ID
    use: "sig",           // Key usage (signature)
    alg: "RS256",         // Algorithm
    n: "base64url...",    // RSA modulus
    e: "AQAB"             // RSA exponent
}
```

## JWKS Endpoint Response

```javascript
{
    keys: [
        {
            kty: "RSA",
            kid: "key-1",
            use: "sig",
            alg: "RS256",
            n: "...",
            e: "AQAB"
        },
        {
            kty: "RSA",
            kid: "key-2",
            use: "sig",
            alg: "RS256",
            n: "...",
            e: "AQAB"
        }
    ]
}
```

## Exports

```javascript
export { createJwksCache };
```

## Key Rotation Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                    Key Rotation Handling                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Token arrives with kid="key-2"                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────┐                                           │
│  │ Check cache for  │                                           │
│  │ JWKS endpoint    │                                           │
│  └────────┬─────────┘                                           │
│           │                                                     │
│     Cache hit?                                                  │
│     ┌─────┴─────┐                                               │
│     ▼           ▼                                               │
│   Yes          No                                               │
│     │           │                                               │
│     │     ┌─────┴─────┐                                         │
│     │     │  Fetch    │                                         │
│     │     │  JWKS     │                                         │
│     │     └─────┬─────┘                                         │
│     │           │                                               │
│     └─────┬─────┘                                               │
│           │                                                     │
│     Key "key-2" found?                                          │
│     ┌─────┴─────┐                                               │
│     ▼           ▼                                               │
│   Yes          No                                               │
│     │           │                                               │
│     │     ┌─────┴─────┐                                         │
│     │     │  Clear    │  (Key might have been rotated)          │
│     │     │  cache &  │                                         │
│     │     │  re-fetch │                                         │
│     │     └─────┬─────┘                                         │
│     │           │                                               │
│     │     Key "key-2" found?                                    │
│     │     ┌─────┴─────┐                                         │
│     │     ▼           ▼                                         │
│     │   Yes         No                                          │
│     │     │           │                                         │
│     │     │     return null                                     │
│     └─────┴─────┐     │                                         │
│                 ▼     │                                         │
│           Return JWK  │                                         │
│                       │                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { createJwksCache } from './jwksCache.js';
import { decodeJwt, verifySignature } from './jwt.js';

const jwksCache = createJwksCache({ ttlMs: 10 * 60 * 1000 }); // 10 minutes

async function verifyToken(token, jwksUri) {
    const decoded = decodeJwt(token);
    const kid = decoded.header.kid;

    // Get JWK from cache (or fetch if not cached)
    const jwk = await jwksCache.getKey(jwksUri, kid);

    if (!jwk) {
        throw new Error('Unable to resolve signing key');
    }

    const isValid = verifySignature(decoded, jwk);

    if (!isValid) {
        throw new Error('Invalid token signature');
    }

    return decoded.payload;
}

// On config change
function onConfigReload() {
    jwksCache.clear();
}
```

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses JWKS cache
- [server-auth-jwt.md](./server-auth-jwt.md) - JWT verification
