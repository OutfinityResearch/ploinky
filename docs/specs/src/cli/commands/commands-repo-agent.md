# cli/commands/repoAgentCommands.js - Repository and Agent Commands

## Overview

Provides CLI commands for managing repositories and agents. Handles adding, updating, enabling, and disabling repos, as well as enabling agents with optional aliases.

## Source File

`cli/commands/repoAgentCommands.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../services/config.js';
import { showHelp } from '../services/help.js';
import * as reposSvc from '../services/repos.js';
import * as agentsSvc from '../services/agents.js';
import { collectAgentsSummary } from '../services/status.js';
import { findAgent } from '../services/utils.js';
```

## Constants

```javascript
const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
```

## Public API

### getRepoNames()

**Purpose**: Gets list of installed repository names

**Returns**: (string[]) Array of repo directory names

**Implementation**:
```javascript
export function getRepoNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    return fs.readdirSync(REPOS_DIR).filter(file =>
        fs.statSync(path.join(REPOS_DIR, file)).isDirectory()
    );
}
```

### getAgentNames()

**Purpose**: Gets list of agent names for autocompletion

**Returns**: (string[]) Array of agent identifiers with various formats

**Formats Returned**:
- `repo/agent` - Full path format
- `repo:agent` - Colon format
- `agent` - Short name (only if unique across repos)

**Implementation**:
```javascript
export function getAgentNames() {
    const summary = collectAgentsSummary();
    if (!summary.length) return [];

    const catalog = [];
    for (const item of summary) {
        if (!item || !Array.isArray(item.agents)) continue;
        for (const agent of item.agents) {
            if (agent && agent.name) {
                catalog.push({ repo: agent.repo, name: agent.name });
            }
        }
    }

    if (!catalog.length) return [];

    // Count occurrences of each agent name
    const counts = {};
    for (const agent of catalog) {
        counts[agent.name] = (counts[agent.name] || 0) + 1;
    }

    // Build suggestions with multiple formats
    const suggestions = new Set();
    for (const agent of catalog) {
        const repoName = agent.repo || '';
        if (repoName) {
            suggestions.add(`${repoName}/${agent.name}`);
            suggestions.add(`${repoName}:${agent.name}`);
        }
        // Only add short name if unique
        if (counts[agent.name] === 1) {
            suggestions.add(agent.name);
        }
    }

    return Array.from(suggestions).sort();
}
```

### addRepo(repoName, repoUrl)

**Purpose**: Adds (clones) a repository

**Parameters**:
- `repoName` (string): Repository name
- `repoUrl` (string): Optional Git URL (uses predefined if not provided)

**Throws**: Error if name missing

**Implementation**:
```javascript
export function addRepo(repoName, repoUrl) {
    if (!repoName) { showHelp(); throw new Error('Missing repository name.'); }
    const res = reposSvc.addRepo(repoName, repoUrl);
    if (res.status === 'exists') console.log(`✓ Repository '${repoName}' already exists.`);
    else console.log(`✓ Repository '${repoName}' added successfully.`);
}
```

### updateRepo(repoName)

**Purpose**: Updates a repository via git pull

**Parameters**:
- `repoName` (string): Repository name

**Async**: Yes

**Throws**: Error if name missing or update fails

**Implementation**:
```javascript
export async function updateRepo(repoName) {
    if (!repoName) throw new Error('Usage: update repo <name>');
    try {
        reposSvc.updateRepo(repoName);
        console.log(`✓ Repo '${repoName}' updated.`);
    } catch (err) {
        throw new Error(`update repo failed: ${err?.message || err}`);
    }
}
```

### enableRepo(repoName)

**Purpose**: Enables a repository (clones if not installed)

**Parameters**:
- `repoName` (string): Repository name

**Throws**: Error if name missing

**Implementation**:
```javascript
export function enableRepo(repoName) {
    if (!repoName) throw new Error('Usage: enable repo <name>');
    reposSvc.enableRepo(repoName);
    console.log(`✓ Repo '${repoName}' enabled. Use 'list agents' to view agents.`);
}
```

### disableRepo(repoName)

**Purpose**: Disables a repository

**Parameters**:
- `repoName` (string): Repository name

**Throws**: Error if name missing

**Implementation**:
```javascript
export function disableRepo(repoName) {
    if (!repoName) throw new Error('Usage: disable repo <name>');
    reposSvc.disableRepo(repoName);
    console.log(`✓ Repo '${repoName}' disabled.`);
}
```

### enableAgent(agentName, mode, repoNameParam, alias)

**Purpose**: Enables an agent in the workspace

**Parameters**:
- `agentName` (string): Agent name or repo/name
- `mode` (string): 'global' or 'devel'
- `repoNameParam` (string): Optional explicit repo name
- `alias` (string): Optional alias for the agent

**Async**: Yes

**Throws**: Error if agent name missing

**Implementation**:
```javascript
export async function enableAgent(agentName, mode, repoNameParam, alias) {
    if (!agentName) throw new Error('Usage: enable agent <name|repo/name> [global|devel [repoName]] [as <alias>]');
    const { shortAgentName, repoName, alias: resolvedAlias } = agentsSvc.enableAgent(agentName, mode, repoNameParam, alias);
    const aliasNote = resolvedAlias ? ` as '${resolvedAlias}'` : '';
    console.log(`✓ Agent '${shortAgentName}' from repo '${repoName}' enabled${aliasNote}. Use 'start' to start all configured agents.`);
}
```

### findAgentManifest(agentName)

**Purpose**: Finds the manifest path for an agent

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Path to manifest.json

**Implementation**:
```javascript
export function findAgentManifest(agentName) {
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}
```

## Exports

```javascript
export {
    getRepoNames,
    getAgentNames,
    addRepo,
    updateRepo,
    enableRepo,
    disableRepo,
    enableAgent,
    findAgentManifest,
};
```

## Usage Example

```javascript
import {
    addRepo,
    enableRepo,
    enableAgent,
    getAgentNames
} from './repoAgentCommands.js';

// Add a predefined repository
addRepo('basic');

// Add a custom repository
addRepo('myrepo', 'https://github.com/myorg/myrepo.git');

// Enable a repository
enableRepo('cloud');

// Enable an agent
await enableAgent('node-dev', 'devel', 'basic');

// Enable with alias
await enableAgent('postgres', 'global', 'basic', 'db');

// Get agent names for autocomplete
const agents = getAgentNames();
// ['basic/node-dev', 'basic:node-dev', 'node-dev', ...]
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `add repo <name> [url]` | Add a repository |
| `update repo <name>` | Update a repository |
| `enable repo <name>` | Enable a repository |
| `disable repo <name>` | Disable a repository |
| `enable agent <name> [mode] [repo] [as alias]` | Enable an agent |

## Related Modules

- [service-repos.md](../services/agents/service-repos.md) - Repository service
- [service-agents.md](../services/agents/service-agents.md) - Agent service
- [service-status.md](../services/utils/service-status.md) - Agent summary
- [service-utils.md](../services/utils/service-utils.md) - Agent lookup
