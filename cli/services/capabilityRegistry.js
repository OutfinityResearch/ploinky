import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import * as workspaceSvc from './workspace.js';
import * as reposSvc from './repos.js';
import { PLOINKY_DIR, REPOS_DIR } from './config.js';
import { findAgent } from './utils.js';
import { deriveAgentPrincipalId } from './agentIdentity.js';

/**
 * capabilityRegistry.js
 *
 * Provider- and contract-driven capability discovery for ploinky core. Replaces
 * the previous hardcoded provider-name branches with a
 * manifest-driven model where:
 *
 *   - every agent can declare `provides["<contract>"]`
 *   - every consumer declares `requires.<alias>`
 *   - workspace bindings pin a consumer's alias to a concrete provider agent
 *
 * The registry itself is pure: it reads agent manifests installed under
 * .ploinky/repos and returns the index. Bindings live in `_config.capabilityBindings`
 * of the agents.json file (kept together with other workspace config).
 */

const CAPABILITY_BINDINGS_KEY = 'capabilityBindings';

function toNonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function canonicalizeAgentRef(input) {
    const raw = toNonEmptyString(input);
    if (!raw) return '';
    return raw.replace(/\s+/g, ' ').replace(/^\.\//, '');
}

function splitRepoAgent(agentRef) {
    const clean = canonicalizeAgentRef(agentRef);
    if (!clean) return { repo: '', agent: '' };
    const parts = clean.split('/').filter(Boolean);
    if (parts.length >= 2) {
        return { repo: parts[0], agent: parts.slice(1).join('/') };
    }
    return { repo: '', agent: parts[0] || '' };
}

function readManifest(manifestPath) {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function normalizeContractName(raw) {
    const clean = toNonEmptyString(raw);
    if (!clean) return '';
    return clean.toLowerCase();
}

function normalizeScopeList(input) {
    if (!Array.isArray(input)) return [];
    const out = new Set();
    for (const entry of input) {
        const v = toNonEmptyString(entry).toLowerCase();
        if (v) out.add(v);
    }
    return Array.from(out);
}

function normalizeOperationList(input) {
    if (!Array.isArray(input)) return [];
    const out = new Set();
    for (const entry of input) {
        const v = toNonEmptyString(entry);
        if (v) out.add(v);
    }
    return Array.from(out);
}

function normalizeProvidesBlock(rawProvides) {
    const provides = {};
    if (!rawProvides || typeof rawProvides !== 'object') return provides;
    for (const [contractKey, descriptorRaw] of Object.entries(rawProvides)) {
        const contract = normalizeContractName(contractKey);
        if (!contract) continue;
        const descriptor = descriptorRaw && typeof descriptorRaw === 'object' ? descriptorRaw : {};
        provides[contract] = {
            contract,
            operations: normalizeOperationList(descriptor.operations),
            supportedScopes: normalizeScopeList(descriptor.supportedScopes || descriptor.scopes)
        };
    }
    return provides;
}

function normalizeRequiresBlock(rawRequires) {
    const requires = {};
    if (!rawRequires || typeof rawRequires !== 'object') return requires;
    for (const [alias, descriptorRaw] of Object.entries(rawRequires)) {
        const aliasName = toNonEmptyString(alias);
        if (!aliasName) continue;
        const descriptor = descriptorRaw && typeof descriptorRaw === 'object' ? descriptorRaw : {};
        const contract = normalizeContractName(descriptor.contract);
        if (!contract) continue;
        requires[aliasName] = {
            alias: aliasName,
            contract,
            maxScopes: normalizeScopeList(descriptor.maxScopes || descriptor.scopes),
            optional: Boolean(descriptor.optional)
        };
    }
    return requires;
}

function normalizeRuntimeResources(rawRuntime) {
    if (!rawRuntime || typeof rawRuntime !== 'object') return {};
    const resources = rawRuntime.resources && typeof rawRuntime.resources === 'object'
        ? rawRuntime.resources
        : {};
    const persistent = resources.persistentStorage && typeof resources.persistentStorage === 'object'
        ? resources.persistentStorage
        : null;
    const normalized = {};
    if (persistent) {
        const key = toNonEmptyString(persistent.key);
        const containerPath = toNonEmptyString(persistent.containerPath);
        if (key && containerPath) {
            normalized.persistentStorage = {
                key,
                containerPath,
                chmod: typeof persistent.chmod === 'number' ? persistent.chmod : null
            };
        }
    }
    if (resources.env && typeof resources.env === 'object') {
        const envOut = {};
        for (const [envName, envValue] of Object.entries(resources.env)) {
            if (!envName) continue;
            envOut[String(envName)] = envValue == null ? '' : String(envValue);
        }
        if (Object.keys(envOut).length) normalized.env = envOut;
    }
    return normalized;
}

function buildAgentDescriptor(repoName, agentName, manifest) {
    const provides = normalizeProvidesBlock(manifest?.provides);
    const requires = normalizeRequiresBlock(manifest?.requires);
    const runtimeResources = normalizeRuntimeResources(manifest?.runtime);
    const principalId = deriveAgentPrincipalId(repoName, agentName);
    return {
        repo: repoName,
        agent: agentName,
        agentRef: `${repoName}/${agentName}`,
        principalId,
        provides,
        requires,
        runtimeResources
    };
}

function collectInstalledAgents() {
    const out = [];
    let repoNames = [];
    try {
        repoNames = reposSvc.getInstalledRepos(REPOS_DIR);
    } catch (_) {
        repoNames = [];
    }
    for (const repo of repoNames) {
        const repoPath = path.join(REPOS_DIR, repo);
        let entries;
        try {
            entries = fs.readdirSync(repoPath);
        } catch (_) {
            entries = [];
        }
        for (const entry of entries) {
            const agentDir = path.join(repoPath, entry);
            const manifestPath = path.join(agentDir, 'manifest.json');
            try {
                if (!fs.statSync(agentDir).isDirectory()) continue;
                if (!fs.existsSync(manifestPath)) continue;
            } catch (_) {
                continue;
            }
            const manifest = readManifest(manifestPath);
            out.push({
                repo,
                agent: entry,
                agentPath: agentDir,
                manifestPath,
                manifest,
                descriptor: buildAgentDescriptor(repo, entry, manifest)
            });
        }
    }
    return out;
}

/**
 * Build an in-memory capability index over all installed agents.
 *
 * Shape:
 * {
 *   agents: Map<"repo/agent", AgentDescriptor>,
 *   byContract: Map<contract, AgentDescriptor[]>,
 *   byPrincipal: Map<principalId, AgentDescriptor>
 * }
 */
export function buildCapabilityIndex() {
    const agents = new Map();
    const byContract = new Map();
    const byPrincipal = new Map();
    for (const installed of collectInstalledAgents()) {
        const descriptor = installed.descriptor;
        agents.set(descriptor.agentRef, { ...descriptor, manifestPath: installed.manifestPath });
        if (descriptor.principalId) {
            byPrincipal.set(descriptor.principalId, descriptor);
        }
        for (const contract of Object.keys(descriptor.provides)) {
            if (!byContract.has(contract)) byContract.set(contract, []);
            byContract.get(contract).push(descriptor);
        }
    }
    return { agents, byContract, byPrincipal };
}

export function listProvidersForContract(contract) {
    const normalized = normalizeContractName(contract);
    if (!normalized) return [];
    const index = buildCapabilityIndex();
    return index.byContract.get(normalized) || [];
}

export function resolveAgentDescriptor(agentRef) {
    const canonical = canonicalizeAgentRef(agentRef);
    if (!canonical) return null;
    const index = buildCapabilityIndex();
    if (index.agents.has(canonical)) return index.agents.get(canonical);
    try {
        const resolved = findAgent(canonical);
        const repoName = resolved.repo;
        const shortName = resolved.shortAgentName;
        const full = `${repoName}/${shortName}`;
        return index.agents.get(full) || null;
    } catch (_) {
        return null;
    }
}

export function getAgentDescriptorByPrincipal(principalId) {
    const clean = toNonEmptyString(principalId);
    if (!clean) return null;
    const index = buildCapabilityIndex();
    return index.byPrincipal.get(clean) || null;
}

// ---------- Capability bindings (workspace-scoped) ----------

function loadBindings() {
    const cfg = workspaceSvc.getConfig() || {};
    const bindings = cfg[CAPABILITY_BINDINGS_KEY];
    return bindings && typeof bindings === 'object' ? { ...bindings } : {};
}

function saveBindings(next) {
    const cfg = workspaceSvc.getConfig() || {};
    cfg[CAPABILITY_BINDINGS_KEY] = next && typeof next === 'object' ? next : {};
    workspaceSvc.setConfig(cfg);
}

function normalizeBindingRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const provider = canonicalizeAgentRef(record.provider);
    const contract = normalizeContractName(record.contract);
    if (!provider || !contract) return null;
    return {
        provider,
        contract,
        approvedScopes: normalizeScopeList(record.approvedScopes),
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Identifier for a binding: "<consumer>:<alias>". For first-party (workspace)
 * bindings such as SSO, the consumer may be "workspace".
 */
function bindingId(consumerRef, alias) {
    const consumer = canonicalizeAgentRef(consumerRef) || 'workspace';
    const aliasName = toNonEmptyString(alias);
    if (!aliasName) {
        throw new Error('capabilityBinding: alias is required');
    }
    return `${consumer}:${aliasName}`;
}

function parseBindingId(id) {
    const raw = toNonEmptyString(id);
    if (!raw) return { consumer: '', alias: '' };
    const idx = raw.indexOf(':');
    if (idx === -1) return { consumer: raw, alias: '' };
    return {
        consumer: raw.slice(0, idx),
        alias: raw.slice(idx + 1)
    };
}

export function setCapabilityBinding({ consumer, alias, provider, contract, approvedScopes }) {
    const id = bindingId(consumer, alias);
    const existing = loadBindings();
    const normalized = normalizeBindingRecord({
        provider,
        contract,
        approvedScopes,
        createdAt: existing[id]?.createdAt
    });
    if (!normalized) {
        throw new Error('capabilityBinding: provider and contract are required');
    }
    existing[id] = normalized;
    saveBindings(existing);
    return { id, ...normalized };
}

export function removeCapabilityBinding({ consumer, alias }) {
    const id = bindingId(consumer, alias);
    const existing = loadBindings();
    if (!existing[id]) return false;
    delete existing[id];
    saveBindings(existing);
    return true;
}

export function getCapabilityBinding({ consumer, alias }) {
    const id = bindingId(consumer, alias);
    const existing = loadBindings();
    const record = existing[id];
    if (!record) return null;
    return { id, ...record };
}

export function listCapabilityBindings() {
    const existing = loadBindings();
    return Object.entries(existing).map(([id, rec]) => ({ id, ...rec }));
}

export function getFirstPartyBindingForContract(contract) {
    const normalized = normalizeContractName(contract);
    if (!normalized) return null;
    const bindings = listCapabilityBindings();
    const match = bindings.find((b) => b.contract === normalized && b.id.startsWith('workspace:'));
    return match || null;
}

/**
 * Validate a consumer's requires alias against the bound provider:
 *
 * - binding exists
 * - provider's manifest exposes the contract
 * - requested scopes ⊆ consumer.maxScopes ∩ binding.approvedScopes ∩ provider.supportedScopes
 */
export function resolveAliasForConsumer({ consumerAgentRef, alias, requestedScopes = [] }) {
    const consumer = canonicalizeAgentRef(consumerAgentRef);
    if (!consumer) {
        throw new Error('capabilityBinding: consumer agent ref is required');
    }
    const consumerDescriptor = resolveAgentDescriptor(consumer);
    if (!consumerDescriptor) {
        throw new Error(`capabilityBinding: consumer agent '${consumer}' not found`);
    }
    const requirement = consumerDescriptor.requires?.[alias];
    if (!requirement) {
        throw new Error(`capabilityBinding: consumer '${consumer}' has no requires.${alias}`);
    }
    const binding = getCapabilityBinding({ consumer, alias });
    if (!binding) {
        if (requirement.optional) return null;
        throw new Error(`capabilityBinding: no binding for ${consumer}:${alias}`);
    }
    if (binding.contract !== requirement.contract) {
        throw new Error(`capabilityBinding: contract mismatch for ${consumer}:${alias} (required=${requirement.contract}, binding=${binding.contract})`);
    }
    const providerDescriptor = resolveAgentDescriptor(binding.provider);
    if (!providerDescriptor) {
        throw new Error(`capabilityBinding: bound provider '${binding.provider}' not installed`);
    }
    const providerContract = providerDescriptor.provides?.[requirement.contract];
    if (!providerContract) {
        throw new Error(`capabilityBinding: provider '${binding.provider}' does not implement ${requirement.contract}`);
    }
    const requested = normalizeScopeList(requestedScopes);
    const allowedByRequirement = new Set(requirement.maxScopes);
    const allowedByBinding = new Set(binding.approvedScopes);
    const allowedByProvider = new Set(providerContract.supportedScopes);
    const intersectingAllowed = (value) => {
        return (!requirement.maxScopes.length || allowedByRequirement.has(value))
            && (!binding.approvedScopes.length || allowedByBinding.has(value))
            && (!providerContract.supportedScopes.length || allowedByProvider.has(value));
    };
    const granted = requested.filter(intersectingAllowed);
    const denied = requested.filter((v) => !intersectingAllowed(v));
    return {
        binding,
        requirement,
        consumer: consumerDescriptor,
        provider: providerDescriptor,
        providerContract,
        grantedScopes: granted,
        deniedScopes: denied
    };
}

export function resolveBindingsForConsumer(consumerAgentRef) {
    const consumer = canonicalizeAgentRef(consumerAgentRef);
    if (!consumer) {
        throw new Error('capabilityBinding: consumer agent ref is required');
    }
    const consumerDescriptor = resolveAgentDescriptor(consumer);
    if (!consumerDescriptor) {
        throw new Error(`capabilityBinding: consumer agent '${consumer}' not found`);
    }
    const resolved = {};
    for (const [alias, requirement] of Object.entries(consumerDescriptor.requires || {})) {
        const entry = resolveAliasForConsumer({
            consumerAgentRef: consumer,
            alias,
            requestedScopes: requirement.maxScopes || []
        });
        if (!entry) continue;
        resolved[alias] = {
            id: entry.binding.id,
            consumer: entry.consumer.agentRef,
            provider: entry.binding.provider,
            providerPrincipal: entry.provider.principalId,
            providerRouteName: entry.provider.agent,
            contract: entry.binding.contract,
            approvedScopes: [...entry.binding.approvedScopes],
            maxScopes: [...entry.requirement.maxScopes],
            grantedScopes: [...entry.grantedScopes],
            deniedScopes: [...entry.deniedScopes]
        };
    }
    return resolved;
}

export function resolveBindingsForProvider(providerAgentRef) {
    const provider = canonicalizeAgentRef(providerAgentRef);
    if (!provider) {
        throw new Error('capabilityBinding: provider agent ref is required');
    }
    const providerDescriptor = resolveAgentDescriptor(provider);
    if (!providerDescriptor) {
        throw new Error(`capabilityBinding: provider agent '${provider}' not found`);
    }
    const resolved = {};
    for (const binding of listCapabilityBindings()) {
        if (binding.provider !== providerDescriptor.agentRef) continue;
        const { consumer, alias } = parseBindingId(binding.id);
        const consumerDescriptor = consumer && consumer !== 'workspace'
            ? resolveAgentDescriptor(consumer)
            : null;
        resolved[binding.id] = {
            id: binding.id,
            consumer,
            consumerPrincipal: consumerDescriptor?.principalId || (consumer === 'workspace' ? 'router:first-party' : ''),
            alias,
            provider: providerDescriptor.agentRef,
            providerPrincipal: providerDescriptor.principalId,
            providerRouteName: providerDescriptor.agent,
            contract: binding.contract,
            approvedScopes: [...binding.approvedScopes]
        };
    }
    return resolved;
}

// ---------- Utility: deterministic body hash for wire signing ----------

export function canonicalJsonHash(obj) {
    const str = canonicalJsonStringify(obj);
    return crypto.createHash('sha256').update(str, 'utf8').digest('base64url');
}

function canonicalJsonStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJsonStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(value[k])}`);
    return `{${parts.join(',')}}`;
}

export const __internal = {
    normalizeContractName,
    normalizeScopeList,
    canonicalizeAgentRef,
    splitRepoAgent,
    canonicalJsonStringify
};
