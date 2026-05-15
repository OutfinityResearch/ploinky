import fs from 'fs';
import path from 'path';

import {
    resolveCanonicalPathSync,
    isPathWithinRoots,
} from '../utils/workspacePaths.js';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SECRET_LEAF_RE = /\.secrets$/i;
const UPLOAD_FOLDER = 'uploads';
const UPLOAD_METADATA_FOLDER = '.webchat-upload-metadata';
const MAX_SEGMENT_LENGTH = 255;
const MAX_PATH_LENGTH = 4096;

export function normalizeWebchatSessionId(sessionId) {
    const value = String(sessionId || '').trim();
    if (!value) return null;
    if (!SESSION_ID_RE.test(value)) return null;
    if (value === '.' || value === '..') return null;
    return value;
}

function isReservedSecretSegment(segment) {
    return segment === '.secrets' || SECRET_LEAF_RE.test(segment);
}

function isSafeSegment(segment) {
    if (!segment) return false;
    if (segment === '.' || segment === '..') return false;
    if (segment.length > MAX_SEGMENT_LENGTH) return false;
    if (segment.includes('\0')) return false;
    if (segment.includes('/') || segment.includes('\\')) return false;
    if (isReservedSecretSegment(segment)) return false;
    return true;
}

export function sanitizeUploadRelativePath(rawPath, fallbackName) {
    const provided = (typeof rawPath === 'string' && rawPath.trim())
        ? rawPath
        : fallbackName;
    if (typeof provided !== 'string') return null;
    if (!provided.trim()) return null;
    if (provided.includes('\0')) return null;
    if (provided.length > MAX_PATH_LENGTH) return null;
    const slashOnly = provided.replace(/\\+/g, '/');
    if (slashOnly.startsWith('/')) return null;
    if (path.isAbsolute(slashOnly)) return null;
    const normalized = slashOnly.replace(/\/+/g, '/');
    if (!normalized) return null;
    const segments = normalized.split('/').filter((part) => part !== '');
    if (segments.length === 0) return null;
    for (const segment of segments) {
        if (!isSafeSegment(segment)) return null;
    }
    const joined = segments.join('/');
    if (joined.length > MAX_PATH_LENGTH) return null;
    return joined;
}

export function buildSessionUploadRoot(cwd, sessionId) {
    const safeSession = normalizeWebchatSessionId(sessionId);
    if (!safeSession) return null;
    if (!cwd || typeof cwd !== 'string') return null;
    return path.join(path.resolve(cwd), UPLOAD_FOLDER, safeSession);
}

export function buildSessionUploadMetadataRoot(cwd, sessionId) {
    const safeSession = normalizeWebchatSessionId(sessionId);
    if (!safeSession) return null;
    if (!cwd || typeof cwd !== 'string') return null;
    return path.join(path.resolve(cwd), UPLOAD_FOLDER, UPLOAD_METADATA_FOLDER, safeSession);
}

export function ensureSessionUploadRoot(uploadRoot) {
    if (!uploadRoot) return false;
    try {
        const resolvedUploadRoot = path.resolve(uploadRoot);
        const cwd = path.dirname(path.dirname(resolvedUploadRoot));
        return ensureDirectoryInsideRoot(resolvedUploadRoot, cwd);
    } catch (_) {
        return false;
    }
}

function realPathOrSelf(value) {
    try {
        return fs.realpathSync(value);
    } catch (_) {
        return value;
    }
}

function isInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootPath);
    if (resolvedTarget === resolvedRoot) return true;
    return resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function hasUnsafeExistingPathComponent(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    if (relative === '') return false;
    if (relative.startsWith('..') || path.isAbsolute(relative)) return true;
    let current = rootPath;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) {
            return false;
        }
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            return true;
        }
    }
    return false;
}

function ensureDirectoryInsideRoot(targetPath, rootPath) {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootPath);
    if (!isInsideRoot(resolvedTarget, resolvedRoot)) return false;
    if (hasUnsafeExistingPathComponent(resolvedRoot, resolvedTarget)) return false;
    fs.mkdirSync(resolvedTarget, { recursive: true });
    if (hasUnsafeExistingPathComponent(resolvedRoot, resolvedTarget)) return false;
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTarget = fs.realpathSync(resolvedTarget);
    return isInsideRoot(realTarget, realRoot);
}

export function resolveUploadTarget({
    uploadRoot,
    workspaceRoot,
    relativePath,
    allowMissingLeaf = true,
} = {}) {
    if (!uploadRoot) return null;
    const safeRelative = sanitizeUploadRelativePath(relativePath, '');
    if (!safeRelative) return null;
    const candidate = path.resolve(uploadRoot, safeRelative);
    if (!isInsideRoot(candidate, uploadRoot)) return null;

    const allowedRoots = workspaceRoot ? [workspaceRoot] : [uploadRoot];

    const canonical = resolveCanonicalPathSync(candidate);
    if (!canonical) return null;
    if (!isPathWithinRoots(allowedRoots, canonical, { allowMissing: allowMissingLeaf })) {
        return null;
    }
    const realUploadRoot = realPathOrSelf(uploadRoot);
    if (!isInsideRoot(canonical, realUploadRoot)) return null;

    return {
        relativePath: safeRelative,
        absolutePath: canonical,
    };
}

function splitBaseAndExt(name) {
    if (!name) return { base: '', ext: '' };
    const lastDot = name.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === name.length - 1) {
        return { base: name, ext: '' };
    }
    return { base: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

export function resolveNonCollidingTarget({ uploadRoot, workspaceRoot, relativePath } = {}) {
    if (!uploadRoot || !relativePath) return null;
    const safeRelative = sanitizeUploadRelativePath(relativePath, '');
    if (!safeRelative) return null;
    const parts = safeRelative.split('/');
    const leaf = parts.pop();
    const parentRelative = parts.join('/');
    const { base, ext } = splitBaseAndExt(leaf);

    for (let attempt = 0; attempt < 10000; attempt += 1) {
        const candidateLeaf = attempt === 0 ? leaf : `${base} (${attempt})${ext}`;
        const candidateRelative = parentRelative
            ? `${parentRelative}/${candidateLeaf}`
            : candidateLeaf;
        const resolved = resolveUploadTarget({
            uploadRoot,
            workspaceRoot,
            relativePath: candidateRelative,
        });
        if (!resolved) return null;
        if (!fs.existsSync(resolved.absolutePath)) {
            return resolved;
        }
    }
    return null;
}

function relativeIfInside(rootPath, absolutePath) {
    if (!rootPath || !absolutePath) return '';
    const resolvedAbsolute = path.resolve(absolutePath);
    const rootCandidates = [];
    const resolvedRoot = path.resolve(rootPath);
    rootCandidates.push(resolvedRoot);
    const realRoot = realPathOrSelf(resolvedRoot);
    if (realRoot && realRoot !== resolvedRoot) rootCandidates.push(realRoot);
    for (const candidate of rootCandidates) {
        const rel = path.relative(candidate, resolvedAbsolute).replace(/\\+/g, '/');
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            return rel;
        }
    }
    return '';
}

export function buildSessionRelativePath(uploadRoot, absolutePath) {
    return relativeIfInside(uploadRoot, absolutePath);
}

export function buildCwdRelativePath(cwd, absolutePath) {
    return relativeIfInside(cwd, absolutePath);
}

export function buildWorkspaceRelativePath(workspaceRoot, absolutePath) {
    return relativeIfInside(workspaceRoot, absolutePath);
}

export const __testables = {
    isInsideRoot,
    splitBaseAndExt,
    isSafeSegment,
};
