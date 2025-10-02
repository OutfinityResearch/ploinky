import crypto from 'crypto';
import { base64UrlDecode } from './utils.js';

function decodeSegment(segment) {
    try {
        const buf = base64UrlDecode(segment);
        return JSON.parse(buf.toString('utf8'));
    } catch (err) {
        throw new Error('Invalid JWT segment');
    }
}

function decodeJwt(token) {
    if (typeof token !== 'string') throw new Error('Missing token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWT must have three parts');
    const [rawHeader, rawPayload, signature] = parts;
    const header = decodeSegment(rawHeader);
    const payload = decodeSegment(rawPayload);
    return { header, payload, signature, rawHeader, rawPayload };
}

function verifySignature({ rawHeader, rawPayload, signature }, jwk) {
    if (!signature) throw new Error('JWT missing signature');
    if (!jwk || !jwk.kty) throw new Error('Missing JWK');
    const sig = base64UrlDecode(signature);
    const data = Buffer.from(`${rawHeader}.${rawPayload}`);
    const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify('RSA-SHA256', data, keyObject, sig);
}

function validateClaims(payload, { issuer, clientId, nonce }) {
    if (!payload) throw new Error('Missing JWT payload');
    if (issuer && payload.iss !== issuer) {
        throw new Error('Invalid token issuer');
    }
    if (clientId) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!aud.includes(clientId)) {
            throw new Error('Audience mismatch');
        }
    }
    const now = Math.floor(Date.now() / 1000) - 30; // small clock skew allowance
    if (typeof payload.exp === 'number' && now > payload.exp) {
        throw new Error('Token expired');
    }
    if (typeof payload.nbf === 'number' && now < payload.nbf) {
        throw new Error('Token not yet valid');
    }
    if (nonce && payload.nonce && payload.nonce !== nonce) {
        throw new Error('Nonce mismatch');
    }
}

export {
    decodeJwt,
    verifySignature,
    validateClaims
};
