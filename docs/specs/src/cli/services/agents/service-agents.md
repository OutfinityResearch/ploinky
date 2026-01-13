# cli/services/agents.js - Agent Management Service

## Overview

Provides agent lifecycle management including enabling, disabling, and resolving agent configurations. Handles agent aliasing, run modes (isolated/global/devel), and workspace structure creation.

## Source File

`cli/services/agents.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadAgents, saveAgents } from './workspace.js';
import {
    getAgentContainerName,
    parseManifestPorts,
    containerExists,
    isContainerRunning,
    collectLiveAgentContainers
} from './docker/index.js';
import { findAgent } from './utils.js';
import { REPOS_DIR } from './config.js';
import {
    createAgentSymlinks,
    removeAgentSymlinks,
    createAgentWorkDir,
    removeAgentWorkDir
} from './workspaceStructure.js';
```

## Constants & Configuration

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reserved keys in agents configuration that cannot be used as aliases
const RESERVED_AGENT_KEYS = new Set(['_config']);

// Pattern for valid alias names
const ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
```

## Data Structures

```javascript
/**
 * Agent record stored in .ploinky/agents
 * @typedef {Object} AgentRecord
 * @property {string} agentName - Short agent name
 * @property {string} repoName - Repository name
 * @property {string} containerImage - Container image to use
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} projectPath - Path to project directory
 * @property {'isolated'|'global'|'devel'} runMode - Run mode
 * @property {string} [develRepo] - Repository path for devel mode
 * @property {'agent'} type - Always 'agent'
 * @property {string} [alias] - Optional alias
 * @property {AgentConfig} config - Container configuration
 */

/**
 * Agent container configuration
 * @typedef {Object} AgentConfig
 * @property {Array<{source: string, target: string}>} binds - Volume bindings
 * @property {string[]} env - Environment variables
 * @property {Array<{containerPort: number, hostPort?: number}>} ports - Port mappings
 */

/**
 * Enable agent result
 * @typedef {Object} EnableResult
 * @property {string} containerName - Container name
 * @property {string} repoName - Repository name
 * @property {string} shortAgentName - Agent short name
 * @property {string} [alias] - Alias if specified
 */

/**
 * Disable agent result
 * @typedef {Object} DisableResult
 * @property {'removed'|'not-found'|'static-removed'|'ambiguous'|'container-exists'} status
 * @property {string} [containerName] - Container name
 * @property {string} [shortAgentName] - Agent short name
 * @property {string} [repoName] - Repository name
 * @property {string} [requested] - Original requested identifier
 * @property {string[]} [matches] - Ambiguous matches
 */

/**
 * Resolved agent record
 * @typedef {Object} ResolvedAgent
 * @property {string} containerName - Container name/key
 * @property {AgentRecord} record - Agent record
 */
```

## Internal Functions

### normalizeAlias(aliasInput)

**Purpose**: Validates and normalizes an alias string

**Parameters**:
- `aliasInput` (string|null|undefined): Input alias

**Returns**: (string) Normalized alias or empty string

**Throws**: `Error` if alias is invalid or reserved

**Implementation**:
```javascript
function normalizeAlias(aliasInput) {
    if (aliasInput === undefined || aliasInput === null) {
        return '';
    }
    if (typeof aliasInput === 'string' && !aliasInput.trim()) {
        return '';
    }
    const alias = String(aliasInput).trim();
    if (!alias) return '';
    if (!ALIAS_PATTERN.test(alias)) {
        throw new Error("Alias must start with a letter or number and may contain only letters, numbers, '.', '_' or '-'.");
    }
    if (RESERVED_AGENT_KEYS.has(alias)) {
        throw new Error(`Alias '${alias}' is reserved. Choose a different alias.`);
    }
    return alias;
}
```

### normalizeEnableArgs(agentName, mode, repoNameParam)

**Purpose**: Parses and normalizes enable agent arguments, handling various input formats

**Parameters**:
- `agentName` (string): Agent name (may include mode inline)
- `mode` (string): Run mode
- `repoNameParam` (string): Repository name for devel mode

**Returns**: `{agentName: string, mode: string, repoNameParam: string}`

**Supported formats**:
- `agent-name`
- `agent-name global`
- `agent-name devel repoName`
- `agent-name: global`
- `agent-name: devel repoName`

**Implementation**:
```javascript
function normalizeEnableArgs(agentName, mode, repoNameParam) {
    if (typeof agentName !== 'string') {
        return { agentName, mode, repoNameParam };
    }
    const trimmed = agentName.trim();
    if (!trimmed) {
        return { agentName: trimmed, mode, repoNameParam };
    }
    if (mode) {
        return { agentName: trimmed, mode, repoNameParam };
    }

    let parsedAgent = trimmed;
    let parsedMode = mode;
    let parsedRepo = repoNameParam;

    // Check for space-separated mode
    const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
    if (spaceTokens.length > 1) {
        const candidateMode = spaceTokens[1].toLowerCase();
        if (candidateMode === 'global' || candidateMode === 'devel') {
            parsedAgent = spaceTokens[0];
            parsedMode = candidateMode;
            if (candidateMode === 'devel' && parsedRepo === undefined) {
                const remainder = spaceTokens.slice(2).join(' ').trim();
                if (remainder) parsedRepo = remainder;
            }
        }
    }

    if (parsedMode) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    // Check for colon-separated mode (agent-name: global)
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const target = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (!target || !remainder) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const tokens = remainder.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const inferredMode = tokens[0].toLowerCase();
    if (inferredMode !== 'global' && inferredMode !== 'devel') {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const repoFromDirective = tokens.slice(1).join(' ');
    return {
        agentName: target,
        mode: inferredMode,
        repoNameParam: inferredMode === 'devel'
            ? (repoNameParam !== undefined ? repoNameParam : repoFromDirective)
            : (repoNameParam !== undefined ? repoNameParam : undefined)
    };
}
```

## Public API

### enableAgent(agentName, mode, repoNameParam, aliasParam)

**Purpose**: Enables an agent in the workspace, creating container configuration and symlinks

**Parameters**:
- `agentName` (string): Agent name
- `mode` (string): Run mode (global/devel/default)
- `repoNameParam` (string): Repository for devel mode
- `aliasParam` (string): Optional alias

**Returns**: `EnableResult`

**Throws**: `Error` on validation failure or preinstall error

**Implementation**:
```javascript
export function enableAgent(agentName, mode, repoNameParam, aliasParam) {
    const normalized = normalizeEnableArgs(agentName, mode, repoNameParam);
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(normalized.agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const alias = normalizeAlias(aliasParam);
    const map = loadAgents();

    // Check for alias collision
    if (alias) {
        const aliasExists = Object.entries(map || {}).some(([key, value]) => {
            if (key === alias) return true;
            return value && value.type === 'agent' && value.alias === alias;
        });
        if (aliasExists) {
            throw new Error('alias already exists');
        }
    }

    const containerBaseName = alias || shortAgentName;
    const containerName = getAgentContainerName(containerBaseName, repoName);

    // Run preinstall commands if specified
    const preinstallEntry = manifest?.preinstall;
    const preinstallCommands = Array.isArray(preinstallEntry)
        ? preinstallEntry.filter(cmd => typeof cmd === 'string' && cmd.trim())
        : (typeof preinstallEntry === 'string' && preinstallEntry.trim() ? [preinstallEntry] : []);

    if (preinstallCommands.length) {
        for (const cmd of preinstallCommands) {
            try {
                console.log(`Running preinstall for '${shortAgentName}': ${cmd}`);
                execSync(cmd, { cwd: agentPath, stdio: 'inherit' });
            } catch (error) {
                throw new Error(`preinstall command failed ('${cmd}'): ${error?.message || error}`);
            }
        }
    }

    // Determine run mode and project path
    const normalizedMode = (normalized.mode || '').toLowerCase();
    let runMode = 'isolated';
    let projectPath = '';

    if (!normalizedMode || normalizedMode === 'default') {
        // Try to reuse existing configuration
        try {
            const existing = Object.values(map || {}).find(
                r => r && r.type === 'agent' && r.agentName === shortAgentName &&
                     r.repoName === repoName && !r.alias
            );
            if (existing && (!existing.runMode || existing.runMode === 'isolated') && existing.projectPath) {
                projectPath = existing.projectPath;
                runMode = 'isolated';
            }
        } catch (_) {}
        if (!projectPath) {
            runMode = 'isolated';
            projectPath = path.join(process.cwd(), shortAgentName);
            try { fs.mkdirSync(projectPath, { recursive: true }); } catch (_) {}
        }
    } else if (normalizedMode === 'global') {
        runMode = 'global';
        projectPath = process.cwd();
    } else if (normalizedMode === 'devel') {
        const repoCandidate = String(normalized.repoNameParam || '').trim();
        if (!repoCandidate) {
            throw new Error("enable agent devel: missing repoName. Usage: enable agent <name> devel <repoName>");
        }
        const repoPath = path.join(REPOS_DIR, repoCandidate);
        if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
            throw new Error(`Repository '${repoCandidate}' not found in ${path.join(REPOS_DIR)}`);
        }
        runMode = 'devel';
        projectPath = repoPath;
    } else {
        throw new Error(`Unknown mode '${normalized.mode || mode}'. Allowed: global | devel`);
    }

    // Parse port mappings
    const { portMappings } = parseManifestPorts(manifest);
    const ports = portMappings.length > 0 ? portMappings : [{ containerPort: 7000 }];

    // Create agent record
    const record = {
        agentName: shortAgentName,
        repoName,
        containerImage: manifest.container || manifest.image || 'node:18-alpine',
        createdAt: new Date().toISOString(),
        projectPath,
        runMode,
        develRepo: runMode === 'devel' ? String(normalized.repoNameParam || '') : undefined,
        type: 'agent',
        config: {
            binds: [
                { source: projectPath, target: projectPath },
                { source: path.resolve(__dirname, '../../../Agent'), target: '/Agent' },
                { source: agentPath, target: '/code' }
            ],
            env: [],
            ports
        }
    };
    if (alias) {
        record.alias = alias;
    }

    // Remove duplicate entries for same agent without alias
    for (const key of Object.keys(map)) {
        if (RESERVED_AGENT_KEYS.has(key)) continue;
        if (!map[key] || typeof map[key] !== 'object') continue;
        if (alias && key === containerName) continue;
        const r = map[key];
        if (!r || r.type !== 'agent') continue;
        const sameAgent = r.agentName === shortAgentName && r.repoName === repoName;
        if (!sameAgent) continue;
        if (alias || r.alias) continue;
        if (key === containerName) continue;
        try { delete map[key]; } catch (_) {}
    }

    map[containerName] = record;
    saveAgents(map);

    // Create workspace structure
    try {
        createAgentWorkDir(shortAgentName);
        createAgentSymlinks(shortAgentName, repoName, agentPath);
    } catch (err) {
        console.error(`Warning: Failed to create workspace structure for ${shortAgentName}: ${err.message}`);
    }

    return { containerName, repoName, shortAgentName, alias: alias || undefined };
}
```

### disableAgent(agentRef)

**Purpose**: Disables an agent, removing its configuration from the workspace

**Parameters**:
- `agentRef` (string): Agent identifier (name, alias, or repo/name)

**Returns**: `DisableResult`

**Implementation**:
```javascript
export function disableAgent(agentRef) {
    const input = typeof agentRef === 'string' ? agentRef.trim() : '';
    if (!input) {
        throw new Error("disable agent: missing agent name. Usage: disable <agentName>");
    }

    const hasNamespace = /[:/]/.test(input);
    let targetRepo = null;
    let targetAgent = input;

    if (hasNamespace) {
        const parts = input.split(/[:/]/).filter(Boolean);
        if (parts.length !== 2) {
            throw new Error(`disable agent: invalid identifier '${input}'. Use <repo>/<agent>.`);
        }
        [targetRepo, targetAgent] = parts;
    }

    const map = loadAgents();
    const config = (map && typeof map._config === 'object') ? map._config : null;
    const directRecord = (map && map[input] && map[input].type === 'agent') ? map[input] : null;

    // Helper to clear static config if matches
    const clearStaticConfig = ({ repoName, shortName, containerName, rawInput }) => {
        if (!config || !config.static) return false;
        // Check various forms of the identifier
        const comparisons = new Set();
        if (shortName) comparisons.add(String(shortName).trim().toLowerCase());
        if (repoName && shortName) {
            const repo = String(repoName).trim().toLowerCase();
            const short = String(shortName).trim().toLowerCase();
            comparisons.add(`${repo}/${short}`);
            comparisons.add(`${repo}:${short}`);
        }
        if (rawInput) comparisons.add(String(rawInput).trim().toLowerCase());

        const staticAgent = String(config.static.agent || '').trim().toLowerCase();
        const staticContainer = String(config.static.container || '').trim();

        const matchesAgent = staticAgent && (comparisons.has(staticAgent));
        const matchesContainer = containerName && staticContainer && staticContainer === containerName;

        if (!matchesAgent && !matchesContainer) return false;

        delete config.static;
        if (Object.keys(config).length === 0) {
            delete map._config;
        } else {
            map._config = config;
        }
        return true;
    };

    // Find matching entries
    const entries = Object.entries(map || {})
        .filter(([key, value]) => key !== '_config' && value && typeof value === 'object')
        .filter(([, value]) => value.type === 'agent');

    // Check for alias match
    const aliasEntry = (!directRecord)
        ? entries.find(([, value]) => {
            if (!value || !value.alias) return false;
            if (value.alias === input) return true;
            if (hasNamespace) {
                return value.alias === targetAgent;
            }
            return false;
        })
        : null;

    let matches;
    if (directRecord) {
        matches = [[input, directRecord]];
    } else if (aliasEntry) {
        matches = [[aliasEntry[0], aliasEntry[1]]];
    } else {
        matches = entries.filter(([, value]) => {
            const repoName = String(value.repoName || '').trim();
            const agentName = String(value.agentName || '').trim();
            if (!agentName) return false;
            if (hasNamespace) {
                return agentName === targetAgent && repoName === targetRepo;
            }
            return agentName === targetAgent;
        });
    }

    if (!matches.length) {
        const staticCleared = clearStaticConfig({
            repoName: targetRepo,
            shortName: targetAgent,
            rawInput: input,
            containerName: null
        });
        if (staticCleared) {
            saveAgents(map);
            return { status: 'static-removed', requested: input };
        }
        return { status: 'not-found', requested: input };
    }

    if (!hasNamespace && !directRecord && matches.length > 1) {
        return {
            status: 'ambiguous',
            requested: input,
            matches: matches.map(([, value]) => `${value.repoName}/${value.agentName}`)
        };
    }

    const [containerName, record] = matches[0];

    // Check if container is active
    let isActive = false;
    try {
        const liveSet = new Set((collectLiveAgentContainers() || []).map(item => item.containerName));
        if (liveSet.size && liveSet.has(containerName)) {
            isActive = true;
        }
    } catch (_) {}

    if (!isActive) {
        try {
            if (isContainerRunning(containerName)) {
                isActive = true;
            }
        } catch (_) {}
    }

    if (!isActive) {
        try {
            if (containerExists(containerName)) {
                isActive = true;
            }
        } catch (error) {
            isActive = true; // Err on safe side
        }
    }

    if (isActive) {
        return {
            status: 'container-exists',
            containerName,
            shortAgentName: record.agentName,
            repoName: record.repoName
        };
    }

    // Remove agent
    delete map[containerName];
    clearStaticConfig({
        repoName: record.repoName,
        shortName: record.agentName,
        containerName,
        rawInput: input
    });
    saveAgents(map);

    // Remove workspace structure
    try {
        removeAgentSymlinks(record.agentName);
    } catch (err) {
        console.error(`Warning: Failed to remove workspace structure for ${record.agentName}: ${err.message}`);
    }

    return {
        status: 'removed',
        containerName,
        shortAgentName: record.agentName,
        repoName: record.repoName
    };
}
```

### resolveEnabledAgentRecord(agentRef)

**Purpose**: Resolves an agent reference to its record in the workspace

**Parameters**:
- `agentRef` (string): Agent identifier

**Returns**: `ResolvedAgent|null`

**Throws**: `Error` with code `AGENT_ALIAS_AMBIGUOUS` if multiple matches

**Implementation**:
```javascript
export function resolveEnabledAgentRecord(agentRef) {
    const input = typeof agentRef === 'string' ? agentRef.trim() : '';
    if (!input) return null;

    const map = loadAgents();
    if (!map || typeof map !== 'object') return null;

    // Direct key lookup
    const direct = map[input];
    if (direct && direct.type === 'agent') {
        return { containerName: input, record: direct };
    }

    const hasNamespace = /[:/]/.test(input);
    let repoFilter = null;
    let agentFilter = input;
    if (hasNamespace) {
        const parts = input.split(/[:/]/).filter(Boolean);
        if (parts.length === 2) {
            [repoFilter, agentFilter] = parts;
        }
    }

    // Alias lookup
    let aliasEntry = Object.entries(map || {})
        .filter(([key]) => !RESERVED_AGENT_KEYS.has(key))
        .find(([, value]) => value && value.type === 'agent' && value.alias === input);
    if (!aliasEntry && hasNamespace) {
        aliasEntry = Object.entries(map || {})
            .filter(([key]) => !RESERVED_AGENT_KEYS.has(key))
            .find(([, value]) => value && value.type === 'agent' && value.alias === agentFilter);
    }
    if (aliasEntry) {
        return { containerName: aliasEntry[0], record: aliasEntry[1] };
    }

    // Name/repo search
    const matches = Object.entries(map)
        .filter(([key, value]) => !RESERVED_AGENT_KEYS.has(key) && value && typeof value === 'object')
        .filter(([, value]) => value.type === 'agent')
        .filter(([, value]) => {
            if (!value.agentName) return false;
            if (repoFilter && value.repoName !== repoFilter) return false;
            return value.agentName === agentFilter;
        });

    if (!matches.length) {
        return null;
    }

    if (matches.length > 1) {
        const aliasList = matches.map(([containerName, value]) => value.alias || containerName);
        const err = new Error(`Multiple containers found for agent '${agentRef}'. Use alias: ${aliasList.join(', ')}`);
        err.code = 'AGENT_ALIAS_AMBIGUOUS';
        throw err;
    }

    const [containerName, record] = matches[0];
    return { containerName, record };
}
```

## Run Modes

| Mode | Description | Project Path |
|------|-------------|--------------|
| `isolated` | Agent runs in its own directory | `$CWD/<agentName>/` |
| `global` | Agent uses workspace root | `$CWD/` |
| `devel` | Agent uses repository for development | `.ploinky/repos/<repoName>/` |

## Usage Examples

```javascript
import { enableAgent, disableAgent, resolveEnabledAgentRecord } from './services/agents.js';

// Enable agent in isolated mode (default)
const result1 = enableAgent('node-dev');

// Enable agent in global mode
const result2 = enableAgent('postgres', 'global');

// Enable agent in devel mode
const result3 = enableAgent('my-agent', 'devel', 'my-repo');

// Enable agent with alias
const result4 = enableAgent('node-dev', null, null, 'frontend');

// Disable agent
const disabled = disableAgent('node-dev');
if (disabled.status === 'removed') {
    console.log('Agent disabled successfully');
}

// Resolve agent
const resolved = resolveEnabledAgentRecord('frontend');
if (resolved) {
    console.log(`Container: ${resolved.containerName}`);
}
```

## Error Handling

- Alias validation errors include descriptive messages
- Preinstall command failures halt enabling process
- Container existence checks prevent accidental disabling of running agents
- Ambiguous references return list of alternatives

## Related Modules

- [service-workspace.md](../workspace/service-workspace.md) - Agent persistence
- [service-workspace-structure.md](../workspace/service-workspace-structure.md) - Directory structure
- [docker-index.md](../docker/docker-index.md) - Container operations
