# cli/services/ploinkyboot.js - Bootstrap Service

## Overview

Handles initial bootstrap of the Ploinky environment, ensuring the default 'basic' repository is cloned and enabled on first run.

## Source File

`cli/services/ploinkyboot.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PLOINKY_DIR } from './config.js';
import * as repos from './repos.js';
```

## Constants & Configuration

```javascript
// Default repository URL for the 'basic' repository
const DEFAULT_REPO_URL = 'https://github.com/PloinkyRepos/Basic.git';
```

## Internal Functions

### ensureDefaultRepo()

**Purpose**: Ensures the default 'basic' repository is cloned into the workspace

**Behavior**:
1. Creates the `repos/` directory if it doesn't exist
2. Checks if `repos/basic/` exists
3. If not, clones from DEFAULT_REPO_URL
4. Reports success or failure to console

**Implementation**:
```javascript
function ensureDefaultRepo() {
    const reposDir = path.join(PLOINKY_DIR, 'repos');
    const defaultRepoPath = path.join(reposDir, 'basic');

    // Ensure repos directory exists
    try {
        fs.mkdirSync(reposDir, { recursive: true });
    } catch (_) {}

    // Clone if basic repo doesn't exist
    if (!fs.existsSync(defaultRepoPath)) {
        console.log("Default 'basic' repository not found. Cloning...");
        try {
            execSync(`git clone ${DEFAULT_REPO_URL} ${defaultRepoPath}`, { stdio: 'inherit' });
            console.log('Default repository cloned successfully.');
        } catch (error) {
            console.error(`Error cloning default repository: ${error.message}`);
        }
    }
}
```

## Public API

### bootstrap()

**Purpose**: Main bootstrap function called on CLI startup

**Behavior**:
1. Ensures the default 'basic' repository is cloned
2. Adds 'basic' to the enabled repositories list if not already present

**Implementation**:
```javascript
export function bootstrap() {
    // Clone basic repo if needed
    ensureDefaultRepo();

    // Ensure basic is in enabled repos list
    try {
        const list = repos.loadEnabledRepos();
        const basicPath = path.join(PLOINKY_DIR, 'repos', 'basic');

        if (fs.existsSync(basicPath) && !list.includes('basic')) {
            list.push('basic');
            repos.saveEnabledRepos(list);
        }
    } catch (_) {}
}
```

## Bootstrap Flow

```
CLI Startup
    │
    ▼
bootstrap()
    │
    ├─► ensureDefaultRepo()
    │       │
    │       ├─► Check if .ploinky/repos/basic exists
    │       │       │
    │       │       ├─► Yes: Skip
    │       │       │
    │       │       └─► No: Clone from GitHub
    │       │
    │       └─► Return
    │
    └─► Check enabled repos
            │
            ├─► Load enabled_repos.json
            │
            ├─► If 'basic' not in list and exists on disk
            │       │
            │       └─► Add 'basic' to list
            │
            └─► Save enabled_repos.json
```

## Directory Structure After Bootstrap

```
.ploinky/
├── repos/
│   └── basic/                    # Cloned from GitHub
│       ├── alpine-bash/
│       │   └── manifest.json
│       ├── node-dev/
│       │   └── manifest.json
│       ├── postgres/
│       │   └── manifest.json
│       └── ...
├── agents                        # Created by initEnvironment()
├── .secrets                      # Created by initEnvironment()
└── enabled_repos.json            # Contains ['basic']
```

## Usage

The bootstrap function is called automatically during CLI startup:

```javascript
// In cli/index.js
import { bootstrap } from './services/ploinkyboot.js';

function main() {
    initEnvironment();
    try { bootstrap(); } catch (_) {}
    // ... rest of CLI initialization
}
```

## Error Handling

- Git clone failures are logged but don't halt startup
- Missing directories are created silently
- All operations are wrapped in try/catch to prevent startup failures
- The CLI continues even if bootstrap partially fails

## Network Requirements

- Requires network access on first run to clone from GitHub
- Subsequent runs work offline if basic repo already exists
- No authentication required (public repository)

## Integration Points

- Called by `cli/index.js` during startup
- Uses `services/config.js` for PLOINKY_DIR path
- Uses `services/repos.js` for enabled repos management

## Related Modules

- [service-config.md](./service-config.md) - Configuration paths
- [service-repos.md](../agents/service-repos.md) - Repository management
- [cli-main.md](../../cli-main.md) - CLI entry point
