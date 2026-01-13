# cli/services/repos.js - Repository Management Service

## Overview

Manages Ploinky agent repositories including predefined and custom repositories. Handles enabling, disabling, adding, and updating repositories.

## Source File

`cli/services/repos.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { PLOINKY_DIR } from './config.js';
```

## Constants & Configuration

```javascript
// Path to enabled repos configuration
export const ENABLED_REPOS_FILE = path.join(PLOINKY_DIR, 'enabled_repos.json');

// Predefined repository definitions
const PREDEFINED_REPOS = {
    basic: {
        url: 'https://github.com/PloinkyRepos/Basic.git',
        description: 'Default base agents'
    },
    cloud: {
        url: 'https://github.com/PloinkyRepos/cloud.git',
        description: 'Cloud infrastructure agents'
    },
    vibe: {
        url: 'https://github.com/PloinkyRepos/vibe.git',
        description: 'Vibe coding agents'
    },
    security: {
        url: 'https://github.com/PloinkyRepos/security.git',
        description: 'Security and scanning tools'
    },
    extra: {
        url: 'https://github.com/PloinkyRepos/extra.git',
        description: 'Additional utility agents'
    },
    demo: {
        url: 'https://github.com/PloinkyRepos/demo.git',
        description: 'Demo agents and examples'
    }
};
```

## Data Structures

```javascript
/**
 * Predefined repository definition
 * @typedef {Object} RepoDefinition
 * @property {string} url - Git clone URL
 * @property {string} description - Human-readable description
 */

/**
 * Add repo result
 * @typedef {Object} AddRepoResult
 * @property {'exists'|'cloned'} status - Result status
 * @property {string} path - Path to repository
 */
```

## Internal Functions

### ensureReposDir()

**Purpose**: Ensures the repos directory exists

**Returns**: (string) Path to repos directory

**Implementation**:
```javascript
function ensureReposDir() {
    const dir = path.join(PLOINKY_DIR, 'repos');
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    return dir;
}
```

## Public API

### loadEnabledRepos()

**Purpose**: Loads the list of enabled repository names

**Returns**: (string[]) Array of enabled repo names

**Implementation**:
```javascript
export function loadEnabledRepos() {
    try {
        const raw = fs.readFileSync(ENABLED_REPOS_FILE, 'utf8');
        const data = JSON.parse(raw || '[]');
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}
```

### saveEnabledRepos(list)

**Purpose**: Saves the list of enabled repository names

**Parameters**:
- `list` (string[]): Array of repo names to save

**Implementation**:
```javascript
export function saveEnabledRepos(list) {
    try {
        fs.mkdirSync(PLOINKY_DIR, { recursive: true });
        fs.writeFileSync(ENABLED_REPOS_FILE, JSON.stringify(list || [], null, 2));
    } catch (_) {}
}
```

### getInstalledRepos(REPOS_DIR)

**Purpose**: Gets list of installed (cloned) repositories

**Parameters**:
- `REPOS_DIR` (string): Path to repos directory

**Returns**: (string[]) Array of installed repo names

**Implementation**:
```javascript
export function getInstalledRepos(REPOS_DIR) {
    try {
        return fs
            .readdirSync(REPOS_DIR)
            .filter(name => {
                try {
                    return fs.statSync(path.join(REPOS_DIR, name)).isDirectory();
                } catch (_) {
                    return false;
                }
            });
    } catch (_) {
        return [];
    }
}
```

### getActiveRepos(REPOS_DIR)

**Purpose**: Gets list of active repositories (enabled or all installed if none enabled)

**Parameters**:
- `REPOS_DIR` (string): Path to repos directory

**Returns**: (string[]) Array of active repo names

**Implementation**:
```javascript
export function getActiveRepos(REPOS_DIR) {
    const enabled = loadEnabledRepos();
    if (enabled && enabled.length) return enabled;
    return getInstalledRepos(REPOS_DIR);
}
```

### getPredefinedRepos()

**Purpose**: Returns the predefined repository definitions

**Returns**: `Object.<string, RepoDefinition>`

**Implementation**:
```javascript
export function getPredefinedRepos() {
    return PREDEFINED_REPOS;
}
```

### resolveRepoUrl(name, url)

**Purpose**: Resolves repository URL from name (predefined) or provided URL

**Parameters**:
- `name` (string): Repository name
- `url` (string): Optional explicit URL

**Returns**: (string|null) Repository URL or null

**Implementation**:
```javascript
export function resolveRepoUrl(name, url) {
    if (url && url.trim()) return url;
    const preset = PREDEFINED_REPOS[String(name || '').toLowerCase()];
    return preset ? preset.url : null;
}
```

### addRepo(name, url)

**Purpose**: Adds (clones) a repository

**Parameters**:
- `name` (string): Repository name
- `url` (string): Optional Git URL

**Returns**: `AddRepoResult`

**Throws**: `Error` if name missing or URL cannot be resolved

**Implementation**:
```javascript
export function addRepo(name, url) {
    if (!name) throw new Error('Missing repository name.');

    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);

    if (fs.existsSync(repoPath)) {
        return { status: 'exists', path: repoPath };
    }

    const actualUrl = resolveRepoUrl(name, url);
    if (!actualUrl) throw new Error(`Missing repository URL for '${name}'.`);

    execSync(`git clone ${actualUrl} ${repoPath}`, { stdio: 'inherit' });
    return { status: 'cloned', path: repoPath };
}
```

### enableRepo(name)

**Purpose**: Enables a repository (clones if not installed)

**Parameters**:
- `name` (string): Repository name

**Returns**: (boolean) true on success

**Throws**: `Error` if name missing or URL not found for non-installed repo

**Implementation**:
```javascript
export function enableRepo(name) {
    if (!name) throw new Error('Missing repository name.');

    const list = loadEnabledRepos();
    if (!list.includes(name)) {
        list.push(name);
        saveEnabledRepos(list);
    }

    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);

    if (!fs.existsSync(repoPath)) {
        const url = resolveRepoUrl(name, null);
        if (!url) throw new Error(`No URL configured for repo '${name}'.`);
        execSync(`git clone ${url} ${repoPath}`, { stdio: 'inherit' });
    }

    return true;
}
```

### disableRepo(name)

**Purpose**: Disables a repository (removes from enabled list)

**Parameters**:
- `name` (string): Repository name

**Returns**: (boolean) true on success

**Implementation**:
```javascript
export function disableRepo(name) {
    const list = loadEnabledRepos();
    const filtered = list.filter(r => r !== name);
    saveEnabledRepos(filtered);
    return true;
}
```

### updateRepo(name, options)

**Purpose**: Updates a repository via git pull

**Parameters**:
- `name` (string): Repository name
- `options.rebase` (boolean): Use --rebase (default: true)
- `options.autostash` (boolean): Use --autostash (default: true)

**Returns**: (boolean) true on success

**Throws**: `Error` if repo not installed

**Implementation**:
```javascript
export function updateRepo(name, { rebase = true, autostash = true } = {}) {
    if (!name) throw new Error('Missing repository name.');

    const REPOS_DIR = ensureReposDir();
    const repoPath = path.join(REPOS_DIR, name);

    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository '${name}' is not installed.`);
    }

    const args = ['-C', repoPath, 'pull'];
    if (rebase) args.push('--rebase');
    if (autostash) args.push('--autostash');

    execFileSync('git', args, { stdio: 'inherit' });
    return true;
}
```

## Predefined Repositories

| Name | Description | URL |
|------|-------------|-----|
| `basic` | Default base agents | https://github.com/PloinkyRepos/Basic.git |
| `cloud` | Cloud infrastructure agents | https://github.com/PloinkyRepos/cloud.git |
| `vibe` | Vibe coding agents | https://github.com/PloinkyRepos/vibe.git |
| `security` | Security and scanning tools | https://github.com/PloinkyRepos/security.git |
| `extra` | Additional utility agents | https://github.com/PloinkyRepos/extra.git |
| `demo` | Demo agents and examples | https://github.com/PloinkyRepos/demo.git |

## File Format

### enabled_repos.json

```json
["basic", "cloud", "custom-repo"]
```

## Usage Example

```javascript
import {
    loadEnabledRepos,
    saveEnabledRepos,
    getInstalledRepos,
    addRepo,
    enableRepo,
    disableRepo,
    updateRepo,
    getPredefinedRepos
} from './services/repos.js';

// Get predefined repos
const predefined = getPredefinedRepos();
console.log(predefined.basic.url);

// Add a predefined repo
addRepo('cloud'); // Clones from predefined URL

// Add custom repo
addRepo('myrepo', 'https://github.com/myorg/myrepo.git');

// Enable a repo
enableRepo('security');

// List enabled
const enabled = loadEnabledRepos();
console.log(enabled); // ['basic', 'cloud', 'security']

// Update repo
updateRepo('basic');

// Disable repo
disableRepo('security');
```

## Error Handling

- Missing name throws descriptive error
- Missing URL for unknown repo throws error
- Git operations inherit stdio (shows progress)
- File operations silently fail on error

## Related Modules

- [service-bootstrap.md](../config/service-bootstrap.md) - Bootstrap
- [service-status.md](./service-status.md) - Status display
- [commands-repo-agent.md](../../commands/commands-repo-agent.md) - CLI commands
