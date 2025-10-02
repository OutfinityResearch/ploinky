import crypto from 'crypto';
import { base64UrlEncode } from './utils.js';

const MIN_VERIFIER_LENGTH = 43;
const MAX_VERIFIER_LENGTH = 128;

function createVerifier(length = 64) {
    const len = Math.min(Math.max(length, MIN_VERIFIER_LENGTH), MAX_VERIFIER_LENGTH);
    const entropy = crypto.randomBytes(len);
    return base64UrlEncode(entropy).slice(0, len);
}

function createChallenge(verifier) {
    return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

function createPkcePair(length) {
    const verifier = createVerifier(length);
    const challenge = createChallenge(verifier);
    return { verifier, challenge, method: 'S256' };
}

export {
    createPkcePair
};
