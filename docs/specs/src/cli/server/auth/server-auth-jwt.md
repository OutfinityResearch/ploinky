# cli/server/auth/jwt.js - JWT Operations

## Overview

Provides JWT (JSON Web Token) decoding, signature verification, and claims validation for OAuth 2.0/OIDC tokens. Uses RSA-SHA256 for signature verification.

## Source File

`cli/server/auth/jwt.js`

## Dependencies

```javascript
import crypto from 'crypto';
import { base64UrlDecode } from './utils.js';
```

## Internal Functions

### decodeSegment(segment)

**Purpose**: Decodes a base64url-encoded JWT segment

**Parameters**:
- `segment` (string): Base64url-encoded string

**Returns**: (Object) Parsed JSON object

**Throws**: Error if segment is invalid

**Implementation**:
```javascript
function decodeSegment(segment) {
    try {
        const buf = base64UrlDecode(segment);
        return JSON.parse(buf.toString('utf8'));
    } catch (err) {
        throw new Error('Invalid JWT segment');
    }
}
```

## Public API

### decodeJwt(token)

**Purpose**: Decodes a JWT into its component parts without verification

**Parameters**:
- `token` (string): JWT string

**Returns**:
```javascript
{
    header: Object,      // Decoded header (alg, kid, typ)
    payload: Object,     // Decoded payload (claims)
    signature: string,   // Base64url signature
    rawHeader: string,   // Original header segment
    rawPayload: string   // Original payload segment
}
```

**Throws**: Error if token is missing or malformed

**Implementation**:
```javascript
function decodeJwt(token) {
    if (typeof token !== 'string') throw new Error('Missing token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWT must have three parts');
    const [rawHeader, rawPayload, signature] = parts;
    const header = decodeSegment(rawHeader);
    const payload = decodeSegment(rawPayload);
    return { header, payload, signature, rawHeader, rawPayload };
}
```

### verifySignature({ rawHeader, rawPayload, signature }, jwk)

**Purpose**: Verifies JWT signature using RSA-SHA256

**Parameters**:
- `decoded` (Object): Decoded JWT with rawHeader, rawPayload, signature
- `jwk` (Object): JSON Web Key for verification

**Returns**: (boolean) True if signature is valid

**Throws**: Error if signature or JWK is missing

**Implementation**:
```javascript
function verifySignature({ rawHeader, rawPayload, signature }, jwk) {
    if (!signature) throw new Error('JWT missing signature');
    if (!jwk || !jwk.kty) throw new Error('Missing JWK');
    const sig = base64UrlDecode(signature);
    const data = Buffer.from(`${rawHeader}.${rawPayload}`);
    const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify('RSA-SHA256', data, keyObject, sig);
}
```

### validateClaims(payload, { issuer, clientId, nonce })

**Purpose**: Validates JWT claims for security requirements

**Parameters**:
- `payload` (Object): JWT payload with claims
- `options` (Object): Validation options
  - `issuer` (string): Expected issuer (iss claim)
  - `clientId` (string): Expected audience (aud claim)
  - `nonce` (string): Expected nonce value

**Throws**:
- Error if payload is missing
- Error if issuer doesn't match
- Error if audience doesn't include clientId
- Error if token is expired
- Error if token is not yet valid (nbf)
- Error if nonce doesn't match

**Implementation**:
```javascript
function validateClaims(payload, { issuer, clientId, nonce }) {
    if (!payload) throw new Error('Missing JWT payload');

    // Validate issuer
    if (issuer && payload.iss !== issuer) {
        throw new Error('Invalid token issuer');
    }

    // Validate audience
    if (clientId) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!aud.includes(clientId)) {
            throw new Error('Audience mismatch');
        }
    }

    // Validate expiration with 30-second clock skew allowance
    const now = Math.floor(Date.now() / 1000) - 30;
    if (typeof payload.exp === 'number' && now > payload.exp) {
        throw new Error('Token expired');
    }

    // Validate not-before
    if (typeof payload.nbf === 'number' && now < payload.nbf) {
        throw new Error('Token not yet valid');
    }

    // Validate nonce (for replay protection)
    if (nonce && payload.nonce && payload.nonce !== nonce) {
        throw new Error('Nonce mismatch');
    }
}
```

## Exports

```javascript
export {
    decodeJwt,
    verifySignature,
    validateClaims
};
```

## JWT Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      JWT Format                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  header.payload.signature                                    │
│                                                             │
│  Header (Base64URL encoded):                                │
│  {                                                          │
│    "alg": "RS256",      // Algorithm                        │
│    "typ": "JWT",        // Token type                       │
│    "kid": "key-id"      // Key ID for JWKS lookup           │
│  }                                                          │
│                                                             │
│  Payload (Base64URL encoded):                               │
│  {                                                          │
│    "iss": "https://...",    // Issuer                       │
│    "sub": "user-id",        // Subject                      │
│    "aud": "client-id",      // Audience                     │
│    "exp": 1234567890,       // Expiration time              │
│    "nbf": 1234567800,       // Not before                   │
│    "iat": 1234567800,       // Issued at                    │
│    "nonce": "...",          // Nonce (if provided)          │
│    "email": "...",          // User email                   │
│    "preferred_username": "...",                             │
│    "realm_access": { "roles": [...] }                       │
│  }                                                          │
│                                                             │
│  Signature:                                                 │
│  RS256(base64UrlEncode(header) + "." +                      │
│        base64UrlEncode(payload), privateKey)                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
import { decodeJwt, verifySignature, validateClaims } from './jwt.js';

const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xIn0...';

// Decode without verification
const decoded = decodeJwt(token);
console.log('Algorithm:', decoded.header.alg);
console.log('Key ID:', decoded.header.kid);
console.log('Subject:', decoded.payload.sub);

// Verify signature (requires JWK from JWKS endpoint)
const jwk = await fetchJwk(decoded.header.kid);
const isValid = verifySignature(decoded, jwk);

if (!isValid) {
    throw new Error('Invalid signature');
}

// Validate claims
validateClaims(decoded.payload, {
    issuer: 'https://keycloak.example.com/realms/ploinky',
    clientId: 'ploinky-router',
    nonce: 'stored-nonce-from-auth-request'
});

console.log('Token is valid!');
```

## Security Considerations

1. **Clock Skew**: 30-second allowance for clock differences between servers
2. **Signature Verification**: Always verify signatures before trusting claims
3. **Nonce Validation**: Prevents replay attacks in OIDC flows
4. **Audience Validation**: Ensures token was intended for this application

## Related Modules

- [server-auth-service.md](./server-auth-service.md) - Uses JWT operations
- [server-auth-jwks-cache.md](./server-auth-jwks-cache.md) - JWK retrieval
- [server-auth-utils.md](./server-auth-utils.md) - Base64URL utilities
