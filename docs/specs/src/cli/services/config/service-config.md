# cli/services/config.js - Configuration Service

## Overview

Provides core configuration paths and environment initialization for the Ploinky CLI. This module defines the standard directory structure and manages debug mode settings.

## Source File

`cli/services/config.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
```

## Constants & Configuration

```javascript
// Base Ploinky configuration directory
export const PLOINKY_DIR = path.join(process.cwd(), '.ploinky');

// Repository storage directory
export const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');

// Agent configuration file (JSON map of enabled agents)
export const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents');

// Secrets storage file
export const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');

// Current profile file
export const PROFILE_FILE = path.join(PLOINKY_DIR, 'profile');

// Workspace directory structure (new layout)
export const AGENTS_WORK_DIR = path.join(process.cwd(), 'agents');
export const CODE_DIR = path.join(process.cwd(), 'code');
export const SKILLS_DIR = path.join(process.cwd(), 'skills');

// Templates directory (relative to module location)
export const TEMPLATES_DIR = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../../templates'
);

// Debug mode flag (default from environment)
let DEBUG_MODE = process.env.PLOINKY_DEBUG === '1';
```

## Directory Structure

```
workspace/
├── .ploinky/                    # Ploinky configuration
│   ├── repos/                   # Cloned repositories
│   │   ├── basic/              # Predefined basic repo
│   │   ├── cloud/              # Cloud tools repo
│   │   └── custom/             # User custom repos
│   ├── agents                   # JSON: enabled agents config
│   ├── .secrets                 # Secrets file
│   └── profile                  # Current profile name
├── agents/                      # Agent working directories
├── code/                        # Shared code directory
├── skills/                      # Shared skills directory
└── .env                         # Environment variables
```

## Public API

### setDebugMode(enabled)

**Purpose**: Enables or disables debug mode globally

**Parameters**:
- `enabled` (boolean): Whether to enable debug mode

**Implementation**:
```javascript
export function setDebugMode(enabled) {
    DEBUG_MODE = Boolean(enabled);
}
```

### isDebugMode()

**Purpose**: Checks if debug mode is currently enabled

**Returns**: (boolean) Current debug mode state

**Implementation**:
```javascript
export function isDebugMode() {
    return DEBUG_MODE;
}
```

### initEnvironment()

**Purpose**: Initializes the Ploinky environment directories and files

**Behavior**:
1. Creates `.ploinky/` directory if it doesn't exist
2. Creates `repos/` subdirectory
3. Creates empty `agents` JSON file
4. Creates `.secrets` file with comment header

**Implementation**:
```javascript
export function initEnvironment() {
    let firstInit = false;

    // Create main Ploinky directory
    if (!fs.existsSync(PLOINKY_DIR)) {
        console.log(`Initializing Ploinky environment in ${path.resolve(PLOINKY_DIR)}...`);
        fs.mkdirSync(PLOINKY_DIR);
        firstInit = true;
    }

    // Create repos directory
    if (!fs.existsSync(REPOS_DIR)) {
        fs.mkdirSync(REPOS_DIR);
    }

    // Initialize agents configuration file
    if (!fs.existsSync(AGENTS_FILE)) {
        fs.writeFileSync(AGENTS_FILE, JSON.stringify({}, null, 2));
    }

    // Initialize secrets file
    if (!fs.existsSync(SECRETS_FILE)) {
        fs.writeFileSync(SECRETS_FILE, '# This file stores secrets for Ploinky agents.\n');
    }
}
```

## Data Structures

### Agents File Format

```javascript
/**
 * Agents configuration (stored in .ploinky/agents)
 * @typedef {Object.<string, AgentConfig>} AgentsConfig
 * Maps agent names to their configurations
 */

/**
 * Individual agent configuration
 * @typedef {Object} AgentConfig
 * @property {string} repo - Repository name
 * @property {string} [container] - Container name/ID
 * @property {number} [port] - Exposed port
 * @property {boolean} [enabled] - Whether agent is enabled
 */
```

### Secrets File Format

```
# This file stores secrets for Ploinky agents.
# Format: KEY=value (one per line)
# Lines starting with # are comments

ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
```

### Profile File Format

```
# Single line containing profile name
dev
```

## Error Handling

- `initEnvironment()` creates directories synchronously; any filesystem errors propagate to caller
- Missing directories are created automatically
- No error thrown if files already exist (idempotent)

## State Management

- `DEBUG_MODE`: Module-level flag, initialized from `PLOINKY_DEBUG` environment variable
- Can be toggled at runtime via `setDebugMode()`

## Integration Points

- Used by `cli/index.js` for startup initialization
- Used by `services/workspace.js` for workspace operations
- Used by `services/agents.js` for agent management
- Used by `services/secretVars.js` for secrets handling

## Usage Example

```javascript
import {
    initEnvironment,
    setDebugMode,
    isDebugMode,
    PLOINKY_DIR,
    REPOS_DIR,
    AGENTS_FILE
} from './services/config.js';

// Initialize on startup
initEnvironment();

// Enable debug mode
setDebugMode(true);

// Check debug state
if (isDebugMode()) {
    console.log('Debug output enabled');
}

// Use paths
console.log(`Config directory: ${PLOINKY_DIR}`);
console.log(`Repos stored in: ${REPOS_DIR}`);
```

## Edge Cases & Constraints

- All paths are relative to `process.cwd()` (current working directory)
- Template path is relative to the module file location
- Environment variable `PLOINKY_DEBUG=1` enables debug mode by default
- First initialization logs a message to console

## Related Modules

- [service-workspace.md](../workspace/service-workspace.md) - Workspace management
- [service-agents.md](../agents/service-agents.md) - Agent management
- [service-secret-vars.md](../utils/service-secret-vars.md) - Secret handling
- [cli-main.md](../../cli-main.md) - Main entry point
