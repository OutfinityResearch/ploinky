import fs from 'fs';
import path from 'path';
import { parseEnableDirective } from './bootstrapManifest.js';
import { findAgent } from './utils.js';

function normalizeAuthMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'local' || normalized === 'pwd') return 'local';
    if (normalized === 'sso') return 'sso';
    return 'none';
}

function parsePloinkyDirectives(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.flatMap((item) => parsePloinkyDirectives(item)).filter(Boolean);
    }
    if (typeof rawValue !== 'string') {
        return [];
    }
    return rawValue
        .split(/[,\n;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function resolveManifestAuthMode(manifest, registryRecord = null) {
    const registryMode = normalizeAuthMode(registryRecord?.auth?.mode);
    if (registryMode !== 'none') {
        return registryMode;
    }

    const ploinkyDirectives = parsePloinkyDirectives(manifest?.ploinky);
    if (ploinkyDirectives.includes('pwd enable')) {
        return 'local';
    }
    if (ploinkyDirectives.includes('sso enable')) {
        return 'sso';
    }
    return 'none';
}

function shouldEnableManifestDependency(agentRef, authMode) {
    const normalizedRef = String(agentRef || '').trim().toLowerCase();
    if (!normalizedRef) return false;
    if (normalizedRef === 'keycloak' || normalizedRef.startsWith('basic/keycloak')) {
        return authMode === 'sso';
    }
    return true;
}

function parseManifestDependencyRef(agentRef) {
    try {
        const parsed = parseEnableDirective(agentRef);
        const spec = String(parsed?.spec || '').trim();
        if (!spec) return '';
        const colonIndex = spec.indexOf(':');
        if (colonIndex !== -1) {
            return spec.slice(0, colonIndex).trim();
        }
        const tokens = spec.split(/\s+/).filter(Boolean);
        if (!tokens.length) return '';
        return tokens[0];
    } catch (_) {
        const raw = String(agentRef || '').trim();
        if (!raw) return '';
        const colonIndex = raw.indexOf(':');
        if (colonIndex !== -1) {
            return raw.slice(0, colonIndex).trim();
        }
        const tokens = raw.split(/\s+/).filter(Boolean);
        return tokens[0] || '';
    }
}

function createGraphNodeId(repoName, shortAgentName, alias = '') {
    return alias
        ? `${repoName}/${shortAgentName} as ${alias}`
        : `${repoName}/${shortAgentName}`;
}

function readManifest(manifestPath) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function findRegistryRecord(registry, { repoName, shortAgentName, alias = '' }) {
    const entries = Object.values(registry || {});
    if (alias) {
        return entries.find((record) => (
            record && record.type === 'agent'
            && record.repoName === repoName
            && record.agentName === shortAgentName
            && record.alias === alias
        )) || null;
    }
    return entries.find((record) => (
        record && record.type === 'agent'
        && record.repoName === repoName
        && record.agentName === shortAgentName
        && !record.alias
    )) || null;
}

function resolveWorkspaceDependencyGraph({ staticAgentRef, registry = {} } = {}) {
    if (!staticAgentRef || typeof staticAgentRef !== 'string') {
        throw new Error('Missing static agent reference.');
    }

    const nodes = new Map();
    const state = new Map();

    function visit(agentRef, { alias = '', enableSpec = '', isStatic = false, stack = [] } = {}) {
        const resolved = findAgent(agentRef);
        const nodeId = createGraphNodeId(resolved.repo, resolved.shortAgentName, alias);

        if (stack.includes(nodeId)) {
            throw new Error(`Dependency cycle detected: ${[...stack, nodeId].join(' -> ')}`);
        }

        let node = nodes.get(nodeId);
        if (!node) {
            const manifest = readManifest(resolved.manifestPath);
            const registryRecord = findRegistryRecord(registry, {
                repoName: resolved.repo,
                shortAgentName: resolved.shortAgentName,
                alias
            });
            node = {
                id: nodeId,
                agentRef: `${resolved.repo}/${resolved.shortAgentName}`,
                enableSpec: String(enableSpec || agentRef || `${resolved.repo}/${resolved.shortAgentName}`).trim(),
                repoName: resolved.repo,
                shortAgentName: resolved.shortAgentName,
                alias,
                manifestPath: resolved.manifestPath,
                agentPath: path.dirname(resolved.manifestPath),
                manifest,
                authMode: resolveManifestAuthMode(manifest, registryRecord),
                dependencies: new Set(),
                dependents: new Set(),
                isStatic: Boolean(isStatic)
            };
            nodes.set(nodeId, node);
        } else if (isStatic) {
            node.isStatic = true;
        }

        const status = state.get(nodeId);
        if (status === 'visiting') {
            throw new Error(`Dependency cycle detected: ${[...stack, nodeId].join(' -> ')}`);
        }
        if (status === 'visited') {
            return nodeId;
        }

        state.set(nodeId, 'visiting');
        const nextStack = [...stack, nodeId];
        for (const rawDependency of Array.isArray(node.manifest.enable) ? node.manifest.enable : []) {
            try {
                const parsedDependency = parseEnableDirective(rawDependency);
                if (!parsedDependency) continue;

                const dependencyRef = parseManifestDependencyRef(parsedDependency.spec);
                if (!shouldEnableManifestDependency(dependencyRef, node.authMode)) {
                    continue;
                }

                const childId = visit(dependencyRef, {
                    alias: parsedDependency.alias || '',
                    enableSpec: parsedDependency.spec || dependencyRef,
                    stack: nextStack
                });
                node.dependencies.add(childId);
                nodes.get(childId)?.dependents.add(nodeId);
            } catch (dependencyError) {
                const message = dependencyError?.message || String(dependencyError);
                console.error(`[manifest enable] Failed to resolve dependency '${rawDependency}' for '${node.agentRef}': ${message}`);
            }
        }
        state.set(nodeId, 'visited');
        return nodeId;
    }

    const staticNodeId = visit(staticAgentRef, {
        enableSpec: staticAgentRef,
        isStatic: true
    });
    return {
        staticNodeId,
        nodes
    };
}

function topologicallyGroupDependencyGraph(graph) {
    const nodes = graph?.nodes instanceof Map ? graph.nodes : new Map();
    const indegree = new Map();
    for (const [nodeId, node] of nodes.entries()) {
        indegree.set(nodeId, node.dependencies.size);
    }

    const waves = [];
    let remaining = Array.from(nodes.keys());
    while (remaining.length) {
        const wave = remaining
            .filter((nodeId) => (indegree.get(nodeId) || 0) === 0)
            .sort((a, b) => a.localeCompare(b));
        if (!wave.length) {
            throw new Error('Dependency graph contains a cycle.');
        }
        waves.push(wave);

        for (const nodeId of wave) {
            for (const dependentId of nodes.get(nodeId)?.dependents || []) {
                indegree.set(dependentId, Math.max(0, (indegree.get(dependentId) || 0) - 1));
            }
            indegree.delete(nodeId);
        }
        remaining = remaining.filter((nodeId) => !wave.includes(nodeId));
    }

    return waves;
}

export {
    createGraphNodeId,
    parseManifestDependencyRef,
    resolveWorkspaceDependencyGraph,
    topologicallyGroupDependencyGraph
};
