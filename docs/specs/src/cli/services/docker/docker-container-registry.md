# cli/services/docker/containerRegistry.js - Container Registry

## Overview

Provides functions for collecting information about live Ploinky agent containers. Inspects running containers to extract agent metadata, port bindings, mount information, and environment variables.

## Source File

`cli/services/docker/containerRegistry.js`

## Dependencies

```javascript
import { execSync } from 'child_process';
import path from 'path';
import { debugLog } from '../utils.js';
import { containerRuntime, loadAgentsMap } from './common.js';
```

## Internal Functions

### parseAgentInfoFromMounts(mounts)

**Purpose**: Extracts repo and agent names from container mount paths

**Parameters**:
- `mounts` (Array): Container mount information

**Returns**: `{ repoName: string, agentName: string }`

**Logic**:
- Looks for `/code` mount destination
- Parses path: `.../repos/<repoName>/<agentName>/...`

**Implementation**:
```javascript
function parseAgentInfoFromMounts(mounts = []) {
    let repoName = '-';
    let agentName = '-';
    for (const mount of mounts) {
        if (mount.Destination === '/code' && mount.Source) {
            const parts = mount.Source.split(path.sep).filter(Boolean);
            const reposIdx = parts.lastIndexOf('repos');
            if (reposIdx !== -1 && reposIdx + 2 < parts.length) {
                repoName = parts[reposIdx + 1];
                agentName = parts[reposIdx + 2];
                break;
            }
        }
    }
    return { repoName, agentName };
}
```

### formatPortBindings(bindings, defaultContainerPort)

**Purpose**: Formats container port bindings into structured array

**Parameters**:
- `bindings` (Object): Docker/Podman port bindings object
- `defaultContainerPort` (string): Default port if not parsed

**Returns**: Array of port binding objects

**Implementation**:
```javascript
function formatPortBindings(bindings = {}, defaultContainerPort = '') {
    const results = [];
    for (const [containerSpec, hostEntries] of Object.entries(bindings || {})) {
        const containerPort = parseInt(containerSpec, 10) || parseInt(containerSpec.split('/')[0], 10) || defaultContainerPort;
        if (Array.isArray(hostEntries)) {
            for (const entry of hostEntries) {
                if (!entry) continue;
                results.push({
                    hostIp: entry.HostIp || '127.0.0.1',
                    hostPort: entry.HostPort || '',
                    containerPort
                });
            }
        }
    }
    return results;
}
```

## Public API

### getAgentsRegistry()

**Purpose**: Gets the agents registry map from storage

**Returns**: (Object) Agents map from `loadAgentsMap()`

**Implementation**:
```javascript
function getAgentsRegistry() {
    return loadAgentsMap();
}
```

### collectLiveAgentContainers()

**Purpose**: Collects information about all running Ploinky containers

**Returns**: Array of container info objects

**Container Info Structure**:
```javascript
{
    containerName: string,    // Full container name
    agentName: string,        // Agent name
    repoName: string,         // Repository name
    containerImage: string,   // Docker image
    createdAt: string,        // Creation timestamp
    projectPath: string,      // Working directory
    state: {
        status: string,       // Container status
        running: boolean,     // Is running
        pid: number          // Process ID
    },
    config: {
        binds: [{
            source: string,   // Host path
            target: string    // Container path
        }],
        env: [{
            name: string,     // Env var name
            value: string     // Env var value
        }],
        ports: [{
            hostIp: string,       // Host IP
            hostPort: string,     // Host port
            containerPort: number // Container port
        }]
    }
}
```

**Implementation**:
```javascript
function collectLiveAgentContainers() {
    const runtime = containerRuntime;
    let names = [];
    try {
        const raw = execSync(`${runtime} ps --format "{{.Names}}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (raw) {
            names = raw.split(/\n+/).map((n) => n.trim()).filter((n) => n.startsWith('ploinky_'));
        }
    } catch (_) {
        return [];
    }
    const results = [];
    for (const name of names) {
        try {
            const inspectRaw = execSync(`${runtime} inspect ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            const parsed = JSON.parse(inspectRaw);
            if (!Array.isArray(parsed) || !parsed.length) continue;
            const data = parsed[0];
            const mounts = data.Mounts || [];
            const envPairs = Array.isArray(data.Config?.Env) ? data.Config.Env : [];
            const env = envPairs.map((entry) => {
                const idx = entry.indexOf('=');
                const key = idx === -1 ? entry : entry.slice(0, idx);
                return { name: key, value: idx === -1 ? '' : entry.slice(idx + 1) };
            });
            let agentName = env.find((e) => e.name === 'AGENT_NAME')?.value || '-';
            const { repoName, agentName: mountAgent } = parseAgentInfoFromMounts(mounts);
            if (agentName === '-' && mountAgent && mountAgent !== '-') {
                agentName = mountAgent;
            }
            const ports = formatPortBindings(data.NetworkSettings?.Ports || {});
            results.push({
                containerName: name,
                agentName,
                repoName,
                containerImage: data.Config?.Image || '-',
                createdAt: data.Created || '-',
                projectPath: data.Config?.WorkingDir || '-',
                state: {
                    status: data.State?.Status || '-',
                    running: Boolean(data.State?.Running),
                    pid: data.State?.Pid || 0
                },
                config: {
                    binds: mounts.map((m) => ({ source: m.Source, target: m.Destination })),
                    env,
                    ports
                }
            });
        } catch (error) {
            debugLog(`collectLiveAgentContainers: ${name} ${error?.message || error}`);
        }
    }
    return results;
}
```

## Exports

```javascript
export {
    collectLiveAgentContainers,
    formatPortBindings,
    getAgentsRegistry,
    parseAgentInfoFromMounts
};
```

## Container Naming Convention

Ploinky containers follow the pattern:
```
ploinky_<repoName>_<agentName>_<projectName>_<hash>
```

Examples:
- `ploinky_basic_node-dev_myproject_abc123`
- `ploinky_coralFlow_file-parser_tests_def456`

## Usage Example

```javascript
import { collectLiveAgentContainers, getAgentsRegistry } from './containerRegistry.js';

// Get all running Ploinky containers
const containers = collectLiveAgentContainers();

for (const container of containers) {
    console.log(`Agent: ${container.agentName}`);
    console.log(`  Repo: ${container.repoName}`);
    console.log(`  Status: ${container.state.status}`);
    console.log(`  Ports:`, container.config.ports);
}

// Get registered agents (from agents.json)
const registry = getAgentsRegistry();
console.log('Registered agents:', Object.keys(registry));
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container runtime utilities
- [service-workspace.md](../workspace/service-workspace.md) - Agent storage
- [service-status.md](../utils/service-status.md) - Status display
