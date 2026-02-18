# DS11 - Container Runtime & Dependencies

## Summary

Ploinky uses Docker or Podman as the container runtime for agent isolation. This specification documents container creation, lifecycle management, networking, volume mounting, runtime detection, and Node.js dependency installation.

## Background / Problem Statement

Agent isolation requires:
- Consistent container lifecycle management
- Support for multiple container runtimes (Docker, Podman)
- Proper volume mounting for code, skills, and working directories
- Network configuration for inter-agent communication
- Health monitoring and automatic restart

## Goals

1. **Runtime Agnostic**: Support both Docker and Podman
2. **Lifecycle Management**: Create, start, stop, restart, remove containers
3. **Volume Mounting**: Proper mounts for code, skills, working dirs
4. **Health Probes**: Liveness and readiness checks
5. **Container Fleet**: Manage multiple containers as a unit

## Non-Goals

- Kubernetes integration
- Container orchestration across hosts
- Custom OCI runtime support
- Container registry management

## Architecture Overview

### Container Layer

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PLOINKY CLI                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    Docker Service Layer                              ││
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    ││
│  │  │   common   │  │ container  │  │   agent    │  │   health   │    ││
│  │  │   .js      │  │  Fleet.js  │  │Commands.js │  │ Probes.js  │    ││
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘    ││
│  │        │               │               │               │            ││
│  │        └───────────────┴───────┬───────┴───────────────┘            ││
│  │                                │                                     ││
│  │                        ┌───────▼───────┐                            ││
│  │                        │ Runtime API   │                            ││
│  │                        │ (docker/podman│                            ││
│  │                        │   CLI)        │                            ││
│  │                        └───────┬───────┘                            ││
│  └────────────────────────────────┼────────────────────────────────────┘│
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONTAINER RUNTIME (Docker/Podman)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Container 1 │  │ Container 2 │  │ Container 3 │  │ Container N │    │
│  │ Agent: A    │  │ Agent: B    │  │ Agent: C    │  │ Agent: N    │    │
│  │ Port: 7001  │  │ Port: 7002  │  │ Port: 7003  │  │ Port: 700N  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Models

### Container Configuration

```javascript
/**
 * @typedef {Object} ContainerConfig
 * @property {string} name - Container name
 * @property {string} image - Docker image URI
 * @property {EnvVar[]} env - Environment variables
 * @property {BindMount[]} binds - Volume bind mounts
 * @property {PortMapping[]} ports - Port mappings
 * @property {string} [workdir] - Working directory
 * @property {string} [user] - User to run as
 * @property {string[]} [cmd] - Command to run
 * @property {Object} [labels] - Container labels
 */

/**
 * @typedef {Object} BindMount
 * @property {string} source - Host path
 * @property {string} target - Container path
 * @property {boolean} [ro] - Read-only flag
 */

/**
 * @typedef {Object} PortMapping
 * @property {number} containerPort - Port inside container
 * @property {number} hostPort - Port on host (0 = random)
 * @property {string} [hostIp] - Host IP to bind
 * @property {string} [protocol] - tcp or udp
 */

/**
 * @typedef {Object} ContainerStatus
 * @property {string} id - Container ID
 * @property {string} name - Container name
 * @property {string} state - running, stopped, created, exited
 * @property {number} [exitCode] - Exit code if exited
 * @property {string} health - healthy, unhealthy, starting, none
 * @property {Date} startedAt - Start timestamp
 * @property {Object} ports - Port mappings
 */
```

### Runtime Detection

```javascript
/**
 * Detected container runtime
 * @typedef {Object} RuntimeInfo
 * @property {string} type - "docker" | "podman"
 * @property {string} path - Path to CLI binary
 * @property {string} version - Runtime version
 * @property {boolean} rootless - Running in rootless mode
 */
```

## API Contracts

### Runtime Detection

```javascript
// cli/services/docker/common.js

/**
 * Detect available container runtime
 * @returns {Promise<RuntimeInfo>}
 */
export async function detectRuntime() {
  // Check for podman first (preferred for rootless)
  try {
    const podmanVersion = await exec('podman --version');
    return {
      type: 'podman',
      path: 'podman',
      version: podmanVersion.trim(),
      rootless: true
    };
  } catch (e) {
    // Podman not available
  }

  // Fall back to docker
  try {
    const dockerVersion = await exec('docker --version');
    const info = await exec('docker info --format "{{.SecurityOptions}}"');
    const rootless = info.includes('rootless');

    return {
      type: 'docker',
      path: 'docker',
      version: dockerVersion.trim(),
      rootless
    };
  } catch (e) {
    throw new Error('No container runtime found. Install Docker or Podman.');
  }
}

/**
 * Get runtime command (docker or podman)
 * @returns {string}
 */
export function getRuntime() {
  return process.env.CONTAINER_RUNTIME || 'docker';
}

/**
 * Execute runtime command
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @returns {Promise<string>}
 */
export async function runtimeExec(command, options = {}) {
  const runtime = getRuntime();
  return exec(`${runtime} ${command}`, options);
}
```

### Container Lifecycle

```javascript
// cli/services/docker/containerFleet.js

/**
 * Create a container
 * @param {ContainerConfig} config - Container configuration
 * @returns {Promise<string>} Container ID
 */
export async function createContainer(config) {
  const runtime = getRuntime();
  const args = ['create'];

  // Name
  args.push('--name', config.name);

  // Environment variables
  for (const env of config.env) {
    if (env.value !== undefined) {
      args.push('-e', `${env.name}=${env.value}`);
    } else {
      args.push('-e', env.name);
    }
  }

  // Volume mounts
  for (const bind of config.binds) {
    const ro = bind.ro ? ':ro' : '';
    args.push('-v', `${bind.source}:${bind.target}${ro}`);
  }

  // Port mappings
  for (const port of config.ports) {
    const hostIp = port.hostIp ? `${port.hostIp}:` : '';
    const hostPort = port.hostPort || '';
    args.push('-p', `${hostIp}${hostPort}:${port.containerPort}`);
  }

  // Working directory
  if (config.workdir) {
    args.push('-w', config.workdir);
  }

  // Labels
  args.push('--label', 'ploinky=true');
  args.push('--label', `ploinky.agent=${config.agentName}`);

  // Image
  args.push(config.image);

  // Command
  if (config.cmd) {
    args.push(...config.cmd);
  }

  const result = await runtimeExec(args.join(' '));
  return result.trim(); // Container ID
}

/**
 * Start a container
 * @param {string} containerId - Container ID or name
 * @returns {Promise<void>}
 */
export async function startContainer(containerId) {
  await runtimeExec(`start ${containerId}`);
}

/**
 * Stop a container
 * @param {string} containerId - Container ID or name
 * @param {number} [timeout=10] - Timeout in seconds
 * @returns {Promise<void>}
 */
export async function stopContainer(containerId, timeout = 10) {
  await runtimeExec(`stop -t ${timeout} ${containerId}`);
}

/**
 * Remove a container
 * @param {string} containerId - Container ID or name
 * @param {boolean} [force=false] - Force removal
 * @returns {Promise<void>}
 */
export async function removeContainer(containerId, force = false) {
  const forceFlag = force ? '-f' : '';
  await runtimeExec(`rm ${forceFlag} ${containerId}`);
}

/**
 * Get container status
 * @param {string} containerId - Container ID or name
 * @returns {Promise<ContainerStatus>}
 */
export async function getContainerStatus(containerId) {
  const format = '{{json .}}';
  const result = await runtimeExec(`inspect --format '${format}' ${containerId}`);
  const info = JSON.parse(result);

  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ''),
    state: info.State.Status,
    exitCode: info.State.ExitCode,
    health: info.State.Health?.Status || 'none',
    startedAt: new Date(info.State.StartedAt),
    ports: info.NetworkSettings?.Ports || {}
  };
}

/**
 * List all Ploinky containers
 * @returns {Promise<ContainerStatus[]>}
 */
export async function listPloinkyContainers() {
  const format = '{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}';
  const filter = '--filter label=ploinky=true';
  const result = await runtimeExec(`ps -a ${filter} --format '${format}'`);

  const containers = [];
  for (const line of result.split('\n').filter(Boolean)) {
    const [id, name, status, ports] = line.split('\t');
    const fullStatus = await getContainerStatus(id);
    containers.push(fullStatus);
  }

  return containers;
}

/**
 * Remove all Ploinky containers
 * @returns {Promise<number>} Number of containers removed
 */
export async function removeAllPloinkyContainers() {
  const containers = await listPloinkyContainers();

  for (const container of containers) {
    await removeContainer(container.id, true);
  }

  return containers.length;
}
```

### Container Commands

```javascript
// cli/services/docker/agentCommands.js

/**
 * Execute command in container
 * @param {string} containerId - Container ID or name
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function execInContainer(containerId, command, options = {}) {
  const runtime = getRuntime();
  const args = ['exec'];

  // Interactive flag
  if (options.interactive) {
    args.push('-it');
  }

  // Environment variables
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  // Working directory
  if (options.workdir) {
    args.push('-w', options.workdir);
  }

  args.push(containerId);
  args.push('sh', '-c', command);

  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, args.slice(1), {
      stdio: options.interactive ? 'inherit' : 'pipe'
    });

    let stdout = '';
    let stderr = '';

    if (!options.interactive) {
      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });
    }

    proc.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

/**
 * Execute interactive shell in container
 * @param {string} containerId - Container ID or name
 * @param {string} [shell='/bin/sh'] - Shell to use
 * @returns {Promise<void>}
 */
export async function execInteractiveShell(containerId, shell = '/bin/sh') {
  const runtime = getRuntime();

  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, ['exec', '-it', containerId, shell], {
      stdio: 'inherit'
    });

    proc.on('close', resolve);
    proc.on('error', reject);
  });
}

/**
 * Copy file to container
 * @param {string} containerId - Container ID or name
 * @param {string} src - Source path on host
 * @param {string} dest - Destination path in container
 * @returns {Promise<void>}
 */
export async function copyToContainer(containerId, src, dest) {
  await runtimeExec(`cp ${src} ${containerId}:${dest}`);
}

/**
 * Copy file from container
 * @param {string} containerId - Container ID or name
 * @param {string} src - Source path in container
 * @param {string} dest - Destination path on host
 * @returns {Promise<void>}
 */
export async function copyFromContainer(containerId, src, dest) {
  await runtimeExec(`cp ${containerId}:${src} ${dest}`);
}
```

### Health Probes

```javascript
// cli/services/docker/healthProbes.js

/**
 * Check container health
 * @param {string} containerId - Container ID or name
 * @param {ProbeConfig} probe - Probe configuration
 * @returns {Promise<{healthy: boolean, output: string}>}
 */
export async function checkHealth(containerId, probe) {
  try {
    const result = await execInContainer(containerId, probe.script, {
      timeout: probe.timeout * 1000
    });

    return {
      healthy: result.exitCode === 0,
      output: result.stdout
    };
  } catch (error) {
    return {
      healthy: false,
      output: error.message
    };
  }
}

/**
 * Wait for container to become healthy
 * @param {string} containerId - Container ID or name
 * @param {ProbeConfig} probe - Readiness probe configuration
 * @param {number} [maxAttempts=30] - Maximum attempts
 * @returns {Promise<boolean>}
 */
export async function waitForHealthy(containerId, probe, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const { healthy } = await checkHealth(containerId, probe);

    if (healthy) {
      return true;
    }

    await sleep(probe.interval * 1000);
  }

  return false;
}

/**
 * Start health monitoring for a container
 * @param {string} containerId - Container ID or name
 * @param {HealthConfig} config - Health configuration
 * @param {Function} onUnhealthy - Callback when unhealthy
 * @returns {Function} Stop monitoring function
 */
export function startHealthMonitoring(containerId, config, onUnhealthy) {
  let running = true;
  let failureCount = 0;

  const monitor = async () => {
    while (running) {
      if (config.liveness) {
        const { healthy } = await checkHealth(containerId, config.liveness);

        if (!healthy) {
          failureCount++;
          if (failureCount >= (config.liveness.retries || 3)) {
            onUnhealthy('liveness', failureCount);
            failureCount = 0;
          }
        } else {
          failureCount = 0;
        }
      }

      await sleep((config.liveness?.interval || 10) * 1000);
    }
  };

  monitor();

  return () => { running = false; };
}
```

## Behavioral Specification

### Container Creation Flow

```
1. Build ContainerConfig from manifest and profile

2. Generate container name:
   ploinky_<repo>_<agent>_<projectHash>

3. Build docker/podman create command:
   - Add --name
   - Add -e for each env var
   - Add -v for each volume
   - Add -p for each port
   - Add --label ploinky=true
   - Add image and command

4. Execute create command

5. Return container ID
```

### Agent Container Volume Mounts

| Host Path | Container Path | Mode | Purpose |
|---|---|---|---|
| `<ploinky>/Agent/` | `/Agent` | `ro` (always) | Agent runtime framework (AgentServer.mjs, TaskQueue.mjs) |
| `$CWD/code/<agent>/` (resolved) | `/code` | `rw` or `ro` (profile) | Agent source code |
| `$CWD/agents/<agent>/node_modules/` | `/code/node_modules` | `rw` | npm dependencies (for agent code) |
| `$CWD/agents/<agent>/node_modules/` | `/Agent/node_modules` | `rw` | npm dependencies (for AgentServer.mjs) |
| `$CWD/shared/` | `/shared` | `rw` | Shared data between agents |
| `$CWD/agents/<agent>/` | same path | `rw` | CWD passthrough for runtime data |
| `$CWD/skills/<agent>/` (resolved) | `/code/.AchillesSkills` | `rw` or `ro` (profile) | Skills directory (only if exists) |

**Mount mode is profile-dependent:**
- `dev` profile: code=`rw`, skills=`rw`
- `qa`/`prod` profiles: code=`ro`, skills=`ro`
- Profiles can override via `manifest.profiles.<profile>.mounts.code` and `.skills`

Additional volumes can be declared via `manifest.volumes` (object mapping host paths to container paths).

### Container Filesystem Layout (at runtime)

Inside a running agent container:

```
/
├── Agent/                        # Ploinky agent framework (ro)
│   ├── server/
│   │   ├── AgentServer.mjs
│   │   ├── AgentServer.sh
│   │   └── TaskQueue.mjs
│   └── node_modules/             # --> host: $CWD/agents/<agent>/node_modules/ (rw)
│
├── code/                         # Agent source code (rw or ro per profile)
│   ├── main.mjs                  # (example agent entry)
│   ├── package.json              # Agent's own package.json
│   ├── .AchillesSkills/          # Skills directory (if mounted)
│   └── node_modules/             # --> host: $CWD/agents/<agent>/node_modules/ (rw)
│
├── shared/                       # Shared data between agents (rw)
│
└── $CWD/agents/<agent>/          # CWD passthrough mount (rw)
```

Note: `/code/node_modules` and `/Agent/node_modules` point to the **same** host directory.

### Dependency Installation

Ploinky manages Node.js dependencies for agents by merging global + agent dependencies on the host, then running `npm install` inside the container entrypoint. Dependencies persist in the workspace `agents/<agent>/` directory.

#### Global Dependencies

Defined in `globalDeps/package.json`, these are available to **every** agent:

```json
{
  "dependencies": {
    "achillesAgentLib": "github:OutfinityResearch/achillesAgentLib",
    "mcp-sdk": "github:PloinkyRepos/MCPSDK#main",
    "flexsearch": "github:PloinkyRepos/flexsearch#main",
    "node-pty": "^1.0.0"
  }
}
```

| Package | Purpose |
|---------|---------|
| `achillesAgentLib` | Agent framework and skill system |
| `mcp-sdk` | MCP protocol implementation |
| `flexsearch` | Full-text search for document indexing |
| `node-pty` | PTY support for interactive terminals |

#### Installation Flow

**Phase 1: Host-Side Preparation** (before container starts)

`dependencyInstaller.js:prepareAgentPackageJson(agentName)`:

1. Reads `globalDeps/package.json` (4 global dependencies)
2. Checks if agent has its own `package.json` at `$CWD/code/<agentName>/package.json`
3. If yes, **merges** agent dependencies into global (agent deps take precedence for conflicts)
4. Writes merged `package.json` to `$CWD/agents/<agentName>/package.json`

Decision logic in `agentServiceManager.js`:
```
if agent does NOT use "start" entry  OR  agent has its own package.json:
    prepareAgentPackageJson()        # merge global + agent deps
else:
    skip npm install entirely        # agent uses start command with no deps
```

**Phase 2: In-Container Entrypoint Install** (when container starts)

`dependencyInstaller.js:buildEntrypointInstallScript()` generates a shell snippet injected before the agent command:

```sh
(
    echo "[deps] <agentName>: Installing dependencies...";
    (
      command -v git >/dev/null 2>&1 ||
      (command -v apk >/dev/null 2>&1 && apk add --no-cache git python3 make g++) ||
      (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y git python3 make g++)
    ) 2>/dev/null;
    npm install --prefix "$WORKSPACE_PATH";
)
```

Build tools (`git`, `python3`, `make`, `g++`) are installed if missing — needed for GitHub dependencies and native modules like `node-pty`.

**Phase 3: Manifest Install Hooks** (after npm install)

If the manifest or active profile defines an `install` command, it runs after entrypoint deps:

```
cd /code && <entrypoint-deps-install> && <manifest-install-hook> && <agent-command>
```

#### Where Dependencies End Up

```
Host:       $CWD/agents/<agentName>/node_modules/   (persists across container restarts)

Container:  /code/node_modules      <── same host directory
            /Agent/node_modules     <── same host directory
```

Both container paths mount the **same** host directory. The dual mount is needed because `AgentServer.mjs` runs from `/Agent/server/` — Node.js ESM resolution walks up from script location, so without `/Agent/node_modules/` it can't find dependencies.

#### Core Dependencies Sync (Alternative Path)

`syncCoreDependencies()` can copy core deps directly from ploinky's own `node_modules/` to the agent's `node_modules/` on the host, avoiding npm install for the core packages. It uses `PLOINKY_ROOT` to locate ploinky's `node_modules/`.

Note: The sync list (`CORE_DEPENDENCIES = ['achillesAgentLib', 'mcp-sdk', 'flexsearch']`) differs from the global deps — `node-pty` is excluded because it's a native module that must be compiled inside the container via npm, not copied from the host.

#### Dependency Directory Structure

```
Host Filesystem:
$CWD/
├── agents/
│   └── <agent>/
│       ├── package.json      # Merged package.json (core + agent)
│       ├── package-lock.json
│       └── node_modules/     # Installed dependencies
│           ├── achillesAgentLib/
│           ├── flexsearch/
│           ├── mcp-sdk/
│           └── node-pty/

Container View:
/code/
├── main.mjs                  # Agent source (from .ploinky/repos/...)
├── package.json              # Agent's package.json
└── node_modules/             # Mounted from $CWD/agents/<agent>/node_modules/
```

### Module Resolution Inside Containers

The codebase uses **ES Modules** exclusively (`"type": "module"`).

| Code Location | Resolution Strategy |
|---|---|
| Agent code at `/code/` | Standard ESM — walks up to `/code/node_modules/` |
| `AgentServer.mjs` at `/Agent/server/` | Dual mount at `/Agent/node_modules/` + `NODE_PATH=/code/node_modules` |

```javascript
// In agentServiceManager.js — NODE_PATH for AgentServer.mjs
args.push('-e', 'NODE_PATH=/code/node_modules');
```

No import maps, custom resolvers, or path aliases are used.

### Container Naming Convention

```
ploinky_<repo>_<agent>_<hash>

Examples:
- ploinky_basic_node-dev_a1b2c3d4
- ploinky_cloud_aws-cli_e5f6g7h8
- ploinky_custom_my-agent_i9j0k1l2
```

## Configuration

### Host Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTAINER_RUNTIME` | Force docker or podman | Auto-detected |
| `CONTAINER_TIMEOUT` | Default stop timeout | `10` |

### Container Environment Variables

These are injected into every agent container:

| Variable | Value | Purpose |
|---|---|---|
| `WORKSPACE_PATH` | `$CWD/agents/<agentName>/` | Agent working directory |
| `AGENT_NAME` | `<agentName>` | Agent identifier |
| `NODE_PATH` | `/code/node_modules` | Module resolution for AgentServer.mjs |
| `PLOINKY_MCP_CONFIG_PATH` | `/tmp/ploinky/mcp-config.json` | MCP configuration file path |
| `PLOINKY_ROUTER_PORT` | Port from routing.json (default `8080`) | Router port for inter-agent communication |
| Profile env vars | From `manifest.profiles.<profile>.env` | Profile-specific configuration |
| Secret vars | From `.ploinky/.secrets` | Secret environment variables |

### Container Labels

| Label | Value | Purpose |
|-------|-------|---------|
| `ploinky` | `true` | Identify Ploinky containers |
| `ploinky.agent` | Agent name | Link container to agent |
| `ploinky.repo` | Repo name | Source repository |
| `ploinky.profile` | Profile name | Active profile |

## Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| Runtime not found | Docker/Podman not installed | Install runtime |
| Image pull failed | Network or auth error | Check network, credentials |
| Port conflict | Port already in use | Use different port |
| Mount failed | Path doesn't exist | Create directory |
| Container start failed | Entry point error | Check logs |

## Security Considerations

- **Rootless Mode**: Prefer rootless Docker/Podman
- **Read-Only Mounts**: Use `:ro` for code in production
- **Limited Capabilities**: Don't run as privileged
- **Network Isolation**: Consider container networks
- **Resource Limits**: Set memory and CPU limits

## Success Criteria

1. Both Docker and Podman work correctly
2. Container lifecycle operations reliable
3. Volume mounts work with symlinks
4. Health probes detect failures
5. Container fleet cleanup works

## References

- [DS02 - Architecture](./DS02-architecture.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS08 - Profile System](./DS08-profile-system.md)
- [Docker Documentation](https://docs.docker.com/)
- [Podman Documentation](https://podman.io/docs/)

> **Note:** DS12 (Dependency Installation) has been merged into this document.
