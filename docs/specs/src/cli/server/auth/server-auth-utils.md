# cli/server/auth/utils.js - Auth Utilities

## Overview

Provides cryptographic utility functions for authentication operations including base64url encoding/decoding and secure random ID generation.

## Source File

`cli/server/auth/utils.js`

## Dependencies

```javascript
import crypto from 'crypto';
```

## Public API

### base64UrlEncode(buffer)

**Purpose**: Encodes a buffer to base64url format (URL-safe base64)

**Parameters**:
- `buffer` (Buffer): Binary data to encode

**Returns**: (string) Base64url-encoded string

**Encoding Rules**:
- Standard base64 with URL-safe character substitutions
- `+` → `-`
- `/` → `_`
- Trailing `=` padding removed

**Implementation**:
```javascript
function base64UrlEncode(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
```

### base64UrlDecode(value)

**Purpose**: Decodes a base64url string to buffer

**Parameters**:
- `value` (string): Base64url-encoded string

**Returns**: (Buffer) Decoded binary data

**Decoding Rules**:
- Reverses URL-safe substitutions
- `-` → `+`
- `_` → `/`
- Restores padding if needed

**Implementation**:
```javascript
function base64UrlDecode(value) {
    const normalized = value
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64');
}
```

### randomId(bytes)

**Purpose**: Generates a cryptographically secure random ID

**Parameters**:
- `bytes` (number): Number of random bytes (default: 32)

**Returns**: (string) Base64url-encoded random ID

**Implementation**:
```javascript
function randomId(bytes = 32) {
    return base64UrlEncode(crypto.randomBytes(bytes));
}
```

## Exports

```javascript
export {
    base64UrlEncode,
    base64UrlDecode,
    randomId
};
```

## Base64 vs Base64URL

```
┌─────────────────────────────────────────────────────────────────┐
│                  Base64 vs Base64URL                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Standard Base64:                                               │
│  - Characters: A-Z, a-z, 0-9, +, /                              │
│  - Padding: = (to make length multiple of 4)                    │
│  - Problem: + and / are URL-unsafe                              │
│                                                                 │
│  Base64URL (RFC 4648):                                          │
│  - Characters: A-Z, a-z, 0-9, -, _                              │
│  - Padding: Optional (often omitted)                            │
│  - URL-safe for query strings, paths, etc.                      │
│                                                                 │
│  Conversion:                                                    │
│  ┌─────────────┐     ┌─────────────┐                            │
│  │  Standard   │ --> │  URL-Safe   │                            │
│  │    Base64   │     │   Base64    │                            │
│  ├─────────────┤     ├─────────────┤                            │
│  │     +       │ --> │     -       │                            │
│  │     /       │ --> │     _       │                            │
│  │     =       │ --> │  (removed)  │                            │
│  └─────────────┘     └─────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Examples

### Encoding Binary Data

```javascript
import { base64UrlEncode } from './utils.js';

// Encode a hash
const hash = crypto.createHash('sha256').update('hello').digest();
const encoded = base64UrlEncode(hash);
console.log(encoded);
// "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ"
```

### Decoding Base64URL

```javascript
import { base64UrlDecode } from './utils.js';

// Decode JWT segment
const payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ';
const decoded = base64UrlDecode(payload);
console.log(decoded.toString('utf8'));
// '{"sub":"1234567890","name":"John"}'
```

### Generating Random IDs

```javascript
import { randomId } from './utils.js';

// Generate session ID (32 bytes = 256 bits)
const sessionId = randomId(32);
console.log(sessionId);
// "kQd3hJX7mZ9pL2nW8vT5yB6cR4fA1gE0jKlM2nO3pQ4"

// Generate shorter state token (16 bytes = 128 bits)
const state = randomId(16);
console.log(state);
// "A1b2C3d4E5f6G7h8I9j0K1l2"

// Generate CSRF token (24 bytes = 192 bits)
const csrf = randomId(24);
console.log(csrf);
// "xY9zW8vU7tS6rQ5pO4nM3lK2jI1hG0fE"
```

## Security Considerations

1. **Cryptographic Randomness**: Uses `crypto.randomBytes()` which provides cryptographically secure pseudo-random data
2. **URL Safety**: Base64URL encoding ensures IDs can be safely used in URLs without encoding
3. **Entropy**: Default 32 bytes provides 256 bits of entropy, suitable for session IDs
4. **No Padding**: Removed padding makes output more compact without information loss

## Related Modules

- [server-auth-jwt.md](./server-auth-jwt.md) - JWT decoding
- [server-auth-pkce.md](./server-auth-pkce.md) - PKCE generation
- [server-auth-session-store.md](./server-auth-session-store.md) - Session ID generation
