# cli/server/auth/pkce.js - PKCE Generation

## Overview

Implements PKCE (Proof Key for Code Exchange) for OAuth 2.0 authorization code flow. Generates cryptographically secure verifier and SHA256 challenge pairs.

## Source File

`cli/server/auth/pkce.js`

## Dependencies

```javascript
import crypto from 'crypto';
import { base64UrlEncode } from './utils.js';
```

## Constants

```javascript
const MIN_VERIFIER_LENGTH = 43;
const MAX_VERIFIER_LENGTH = 128;
```

## Internal Functions

### createVerifier(length)

**Purpose**: Creates a cryptographically secure code verifier

**Parameters**:
- `length` (number): Desired length (default: 64, clamped to 43-128)

**Returns**: (string) Base64URL-encoded verifier

**Implementation**:
```javascript
function createVerifier(length = 64) {
    const len = Math.min(Math.max(length, MIN_VERIFIER_LENGTH), MAX_VERIFIER_LENGTH);
    const entropy = crypto.randomBytes(len);
    return base64UrlEncode(entropy).slice(0, len);
}
```

### createChallenge(verifier)

**Purpose**: Creates SHA256 challenge from verifier

**Parameters**:
- `verifier` (string): Code verifier

**Returns**: (string) Base64URL-encoded challenge

**Implementation**:
```javascript
function createChallenge(verifier) {
    return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}
```

## Public API

### createPkcePair(length)

**Purpose**: Creates a PKCE verifier/challenge pair

**Parameters**:
- `length` (number): Verifier length (optional, default: 64)

**Returns**:
```javascript
{
    verifier: string,  // Random code verifier
    challenge: string, // SHA256(verifier) base64url encoded
    method: 'S256'     // Challenge method (always S256)
}
```

**Implementation**:
```javascript
function createPkcePair(length) {
    const verifier = createVerifier(length);
    const challenge = createChallenge(verifier);
    return { verifier, challenge, method: 'S256' };
}
```

## Exports

```javascript
export {
    createPkcePair
};
```

## PKCE Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        PKCE Flow                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                        Authorization Server              │
│    │                                                            │
│    │  1. Generate verifier (random string)                      │
│    │  2. Generate challenge = SHA256(verifier)                  │
│    │                                                            │
│    │──────── Authorization Request ────────────────────────────►│
│    │         code_challenge = challenge                         │
│    │         code_challenge_method = S256                       │
│    │                                                            │
│    │◄─────── Authorization Code ───────────────────────────────│
│    │                                                            │
│    │──────── Token Request ────────────────────────────────────►│
│    │         code = authorization_code                          │
│    │         code_verifier = verifier                           │
│    │                                                            │
│    │         Server verifies:                                   │
│    │         SHA256(code_verifier) == stored_challenge          │
│    │                                                            │
│    │◄─────── Access Token ─────────────────────────────────────│
│    │                                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Security Properties

1. **Entropy**: Uses `crypto.randomBytes()` for cryptographic randomness
2. **Length**: Enforces RFC 7636 minimum (43) and maximum (128) lengths
3. **Challenge**: SHA256 hash is one-way; verifier cannot be derived from challenge
4. **Method**: Only supports S256 (SHA256), not plain method

## Usage Example

```javascript
import { createPkcePair } from './pkce.js';

// Generate PKCE pair
const { verifier, challenge, method } = createPkcePair();

console.log('Verifier:', verifier);
// Example: "kQd3hJX7mZ9pL2nW8vT5yB6cR4fA1gE0jK..."

console.log('Challenge:', challenge);
// Example: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

console.log('Method:', method);
// Always: "S256"

// Use in authorization request
const authUrl = new URL('https://auth.example.com/authorize');
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', method);

// Store verifier securely for token exchange
// Later, use verifier in token request
const tokenRequest = {
    grant_type: 'authorization_code',
    code: authorizationCode,
    code_verifier: verifier
};
```

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses PKCE
- [server-auth-keycloak-client.md](./server-auth-keycloak-client.md) - Token exchange
- [server-auth-utils.md](./server-auth-utils.md) - Base64URL encoding
