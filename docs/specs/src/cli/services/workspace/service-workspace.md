# cli/services/workspace.js - Workspace Persistence Service

## Overview

Provides low-level persistence operations for agent configuration. Manages reading and writing of the `.ploinky/agents` file which stores all enabled agent records and workspace configuration.

## Source File

`cli/services/workspace.js`

## Dependencies

```javascript
import fs from 'fs';
import { AGENTS_FILE, PLOINKY_DIR } from './config.js';
```

## Constants & Configuration

Uses paths from config.js:
- `PLOINKY_DIR`: `.ploinky/` directory
- `AGENTS_FILE`: `.ploinky/agents` JSON file

## Data Structures

```javascript
/**
 * Agents map structure stored in .ploinky/agents
 * @typedef {Object} AgentsMap
 * @property {Object} _config - Workspace configuration (reserved key)
 * @property {Object.<string, AgentRecord>} [containerName] - Agent records keyed by container name
 */

/**
 * Workspace configuration stored in _config
 * @typedef {Object} WorkspaceConfig
 * @property {Object} [static] - Static agent configuration
 * @property {string} static.agent - Static agent name
 * @property {number} static.port - Static agent port
 * @property {string} [static.container] - Container name
 */

/**
 * Agent record
 * @typedef {Object} AgentRecord
 * @property {string} agentName - Short agent name
 * @property {string} repoName - Repository name
 * @property {string} containerImage - Container image
 * @property {string} createdAt - ISO timestamp
 * @property {string} projectPath - Project directory path
 * @property {'isolated'|'global'|'devel'} runMode - Run mode
 * @property {'agent'} type - Record type
 * @property {Object} config - Container configuration
 */
```

## Internal Functions

### ensureDirs()

**Purpose**: Ensures the .ploinky directory exists

**Implementation**:
```javascript
function ensureDirs() {
    try {
        fs.mkdirSync(PLOINKY_DIR, { recursive: true });
    } catch (_) {}
}
```

## Public API

### loadAgents()

**Purpose**: Loads the agents configuration from disk

**Returns**: `AgentsMap` - The agents map or empty object on error

**Implementation**:
```javascript
export function loadAgents() {
    ensureDirs();
    try {
        if (!fs.existsSync(AGENTS_FILE)) return {};
        const data = fs.readFileSync(AGENTS_FILE, 'utf8');
        return JSON.parse(data || '{}') || {};
    } catch (_) {
        return {};
    }
}
```

### saveAgents(map)

**Purpose**: Saves the agents configuration to disk

**Parameters**:
- `map` (AgentsMap): The agents map to save

**Implementation**:
```javascript
export function saveAgents(map) {
    ensureDirs();
    try {
        fs.writeFileSync(AGENTS_FILE, JSON.stringify(map || {}, null, 2));
    } catch (_) {}
}
```

### listAgents()

**Purpose**: Returns all agent records as an array

**Returns**: `AgentRecord[]` - Array of all agent records

**Implementation**:
```javascript
export function listAgents() {
    return Object.values(loadAgents());
}
```

### getAgentRecord(containerName)

**Purpose**: Gets a specific agent record by container name

**Parameters**:
- `containerName` (string): The container name/key

**Returns**: `AgentRecord|null` - The agent record or null

**Implementation**:
```javascript
export function getAgentRecord(containerName) {
    const map = loadAgents();
    return map[containerName] || null;
}
```

### upsertAgent(containerName, record)

**Purpose**: Creates or updates an agent record

**Parameters**:
- `containerName` (string): The container name/key
- `record` (AgentRecord): The agent record

**Implementation**:
```javascript
export function upsertAgent(containerName, record) {
    const map = loadAgents();
    map[containerName] = { ...(record || {}) };
    saveAgents(map);
}
```

### removeAgent(containerName)

**Purpose**: Removes an agent record

**Parameters**:
- `containerName` (string): The container name/key

**Implementation**:
```javascript
export function removeAgent(containerName) {
    const map = loadAgents();
    delete map[containerName];
    saveAgents(map);
}
```

### getConfig()

**Purpose**: Gets the workspace configuration (_config key)

**Returns**: `WorkspaceConfig` - Configuration object

**Implementation**:
```javascript
export function getConfig() {
    const map = loadAgents();
    return map._config || {};
}
```

### setConfig(cfg)

**Purpose**: Sets the workspace configuration

**Parameters**:
- `cfg` (WorkspaceConfig): Configuration to save

**Implementation**:
```javascript
export function setConfig(cfg) {
    const map = loadAgents();
    map._config = cfg || {};
    saveAgents(map);
}
```

## File Format

The `.ploinky/agents` file is JSON with this structure:

```json
{
  "_config": {
    "static": {
      "agent": "node-dev",
      "port": 8088,
      "container": "ploinky-basic-node-dev"
    }
  },
  "ploinky-basic-node-dev": {
    "agentName": "node-dev",
    "repoName": "basic",
    "containerImage": "node:18-alpine",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "projectPath": "/home/user/project",
    "runMode": "global",
    "type": "agent",
    "config": {
      "binds": [
        { "source": "/home/user/project", "target": "/home/user/project" },
        { "source": "/path/to/Agent", "target": "/Agent" },
        { "source": "/path/to/agent/code", "target": "/code" }
      ],
      "env": [],
      "ports": [{ "containerPort": 7000 }]
    }
  }
}
```

## Usage Examples

```javascript
import {
    loadAgents,
    saveAgents,
    listAgents,
    getAgentRecord,
    upsertAgent,
    removeAgent,
    getConfig,
    setConfig
} from './services/workspace.js';

// Load all agents
const agents = loadAgents();
console.log(Object.keys(agents));

// Get specific agent
const agent = getAgentRecord('ploinky-basic-node-dev');
if (agent) {
    console.log(agent.projectPath);
}

// Update agent
upsertAgent('ploinky-basic-node-dev', {
    ...agent,
    projectPath: '/new/path'
});

// Remove agent
removeAgent('ploinky-basic-node-dev');

// Manage workspace config
const config = getConfig();
setConfig({
    ...config,
    static: { agent: 'postgres', port: 8088 }
});

// List all as array
const list = listAgents();
list.forEach(a => console.log(a.agentName));
```

## Error Handling

- All operations silently catch errors and return safe defaults
- `loadAgents()` returns `{}` on any error
- `saveAgents()` fails silently if write fails
- Ensures directory existence before any operation

## Integration Points

- Used by `services/agents.js` for agent management
- Used by `services/status.js` for status display
- Used by `commands/cli.js` for workspace commands
- Used by `services/docker/` for container operations

## Related Modules

- [service-config.md](../config/service-config.md) - Path constants
- [service-agents.md](../agents/service-agents.md) - Agent management
- [service-status.md](../utils/service-status.md) - Status display
