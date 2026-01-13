# cli/services/status.js - Status Display Service

## Overview

Provides workspace status display functionality including repository listings, agent listings, route information, and comprehensive workspace status output with SSO and router state.

## Source File

`cli/services/status.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import net from 'net';
import { PLOINKY_DIR } from './config.js';
import * as reposSvc from './repos.js';
import { collectLiveAgentContainers, getAgentsRegistry } from './docker/index.js';
import { findAgent } from './utils.js';
import { gatherSsoStatus } from './sso.js';
```

## Constants & Configuration

```javascript
const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const PREDEFINED_REPOS = reposSvc.getPredefinedRepos();

// ANSI color codes
const ANSI = {
    reset: '\u001B[0m',
    bold: '\u001B[1m',
    dim: '\u001B[2m',
    red: '\u001B[31m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    blue: '\u001B[34m',
    magenta: '\u001B[35m',
    cyan: '\u001B[36m',
    gray: '\u001B[90m'
};

const supportsColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
```

## Data Structures

```javascript
/**
 * Agent summary entry
 * @typedef {Object} AgentSummary
 * @property {string} repo - Repository name
 * @property {string} name - Agent name
 * @property {string} about - Description from manifest
 * @property {string} manifestPath - Path to manifest.json
 */

/**
 * Repository summary
 * @typedef {Object} RepoSummary
 * @property {string} repo - Repository name
 * @property {boolean} installed - Whether repo is installed
 * @property {AgentSummary[]} agents - Agents in this repo
 */

/**
 * Repository status row
 * @typedef {Object} RepoStatusRow
 * @property {string} name - Repository name
 * @property {boolean} enabled - Whether enabled
 * @property {boolean} installed - Whether installed
 * @property {boolean} predefined - Whether predefined
 */
```

## Style Helpers

```javascript
// Color application helper
function colorize(text, ...styles) {
    if (!supportsColor || styles.length === 0) return text;
    return `${styles.join('')}${text}${ANSI.reset}`;
}

// Predefined style functions
const styles = {
    header: (text) => colorize(text, ANSI.bold, ANSI.cyan),
    label: (text) => colorize(text, ANSI.dim),
    name: (text) => colorize(text, ANSI.cyan),
    success: (text) => colorize(text, ANSI.green),
    warn: (text) => colorize(text, ANSI.yellow),
    danger: (text) => colorize(text, ANSI.red),
    info: (text) => colorize(text, ANSI.blue),
    accent: (text) => colorize(text, ANSI.magenta),
    muted: (text) => colorize(text, ANSI.gray),
    bold: (text) => colorize(text, ANSI.bold)
};

const bulletSymbol = supportsColor ? `${ANSI.gray}\u2022${ANSI.reset}` : '-';

function formatBadge(text, formatter = (value) => value) {
    return formatter(`[${text}]`);
}
```

## Public API

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

### listRepos()

**Purpose**: Lists all repositories with their status

**Output Format**:
```
Available repositories:
- basic: https://github.com/PloinkyRepos/Basic.git [installed] [enabled]
- cloud: https://github.com/PloinkyRepos/cloud.git
- custom: (local) [installed]
```

### listCurrentAgents()

**Purpose**: Lists currently running agent containers with detailed status

**Output Format**:
```
Running agent containers:
  • ploinky_basic_node-dev [running] pid 12345
     agent: node-dev  repo: basic
     image: node:18-alpine
     created: 2024-01-15T10:30:00.000Z
     cwd: /home/user/project
     binds: 3  env: 5  ports: 7000->8080
```

### collectAgentsSummary(options)

**Purpose**: Collects summary of all agents across repositories

**Parameters**:
- `options.includeInactive` (boolean): Include inactive repos (default: true)

**Returns**: `RepoSummary[]`

**Implementation**:
```javascript
export function collectAgentsSummary({ includeInactive = true } = {}) {
    const repoList = includeInactive
        ? reposSvc.getInstalledRepos(REPOS_DIR)
        : reposSvc.getActiveRepos(REPOS_DIR);

    const summary = [];
    if (!repoList || repoList.length === 0) return summary;

    for (const repo of repoList) {
        const repoPath = path.join(REPOS_DIR, repo);
        const installed = fs.existsSync(repoPath);
        const record = { repo, installed, agents: [] };

        if (installed) {
            let dirs = [];
            try {
                dirs = fs.readdirSync(repoPath);
            } catch (_) {
                dirs = [];
            }

            for (const name of dirs) {
                const agentDir = path.join(repoPath, name);
                const manifestPath = path.join(agentDir, 'manifest.json');
                try {
                    if (!fs.statSync(agentDir).isDirectory() || !fs.existsSync(manifestPath)) continue;
                } catch (_) {
                    continue;
                }

                let about = '-';
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    if (manifest && typeof manifest.about === 'string') {
                        about = manifest.about;
                    }
                } catch (_) {}

                record.agents.push({
                    repo,
                    name,
                    about,
                    manifestPath
                });
            }
        }

        summary.push(record);
    }

    return summary;
}
```

### listAgents()

**Purpose**: Lists all agents grouped by repository

**Output Format**:
```
[Repo] basic:
  - node-dev: Node.js development environment
  - postgres: PostgreSQL database server
  - alpine-bash: Alpine Linux shell

[Repo] cloud (not installed):
  (install with: add repo cloud)
```

### listRoutes()

**Purpose**: Displays routing configuration from .ploinky/routing.json

**Output Format**:
```
Routing configuration (.ploinky/routing.json):
- Port: 8088
- Static agent: node-dev
- Routes:
  node-dev -> agent=node-dev method=mcp hostPort=32001
```

### statusWorkspace()

**Purpose**: Displays comprehensive workspace status

**Async**: Yes

**Output Sections**:
1. SSO status (enabled/disabled, provider, realm, etc.)
2. Router status (listening/not listening)
3. Repository status (enabled, installed, missing)
4. Running agent containers

**Implementation**:
```javascript
export async function statusWorkspace() {
    console.log(styles.header('Workspace status:'));

    // SSO status
    const ssoStatus = gatherSsoStatus();
    printSsoStatusSummary(ssoStatus);

    // Router status
    const routerPort = Number(ssoStatus.routerPort) || 8080;
    const routerListening = await isPortListening(routerPort);
    printRouterStatus(routerPort, routerListening);

    // Repository status
    listReposForStatus();

    // Agent status
    listCurrentAgents();
}
```

## Internal Functions

### isPortListening(port, host, timeoutMs)

**Purpose**: Checks if a port is accepting connections

**Parameters**:
- `port` (number): Port to check
- `host` (string): Host to check (default: '127.0.0.1')
- `timeoutMs` (number): Timeout in ms (default: 500)

**Returns**: `Promise<boolean>`

### collectRepoStatusRows()

**Purpose**: Collects repository status for display

**Returns**: `RepoStatusRow[]`

### listReposForStatus()

**Purpose**: Prints repository section of status output

### printSsoStatusSummary(ssoStatus)

**Purpose**: Prints SSO section of status output

### printRouterStatus(routerPort, isListening)

**Purpose**: Prints router section of status output

## Status Output Example

```
Workspace status:
- SSO: enabled
  • Provider agent: keycloak (kc)
  • Database agent: postgres (pg)
  • Realm / Client: myrealm / myclient
  • Base URL: http://localhost:8180
  • Redirect URI: http://127.0.0.1:8088/auth/callback
  • Logout redirect: http://127.0.0.1:8088/
  • Client secret: [set]
- Router: listening (127.0.0.1:8088)
- Repos:
  • basic [enabled]
  • cloud [enabled]
  • custom [local]
Running agent containers:
  • ploinky_basic_node-dev [running] pid 12345
     agent: node-dev  repo: basic
     ...
```

## Usage Example

```javascript
import {
    listRepos,
    listAgents,
    listCurrentAgents,
    listRoutes,
    statusWorkspace,
    collectAgentsSummary
} from './services/status.js';

// List repositories
listRepos();

// List all agents
listAgents();

// List running agents
listCurrentAgents();

// Show routes
listRoutes();

// Full workspace status (async)
await statusWorkspace();

// Get agent summary programmatically
const summary = collectAgentsSummary();
for (const repo of summary) {
    console.log(`${repo.repo}: ${repo.agents.length} agents`);
}
```

## Related Modules

- [service-repos.md](../agents/service-repos.md) - Repository management
- [service-sso.md](./service-sso.md) - SSO configuration
- [docker-index.md](../docker/docker-index.md) - Container operations
