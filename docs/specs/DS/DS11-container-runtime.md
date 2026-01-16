# DS11 - Container Runtime

## Summary

Ploinky uses Docker or Podman as the container runtime for agent isolation. This specification documents container creation, lifecycle management, networking, volume mounting, and runtime detection.

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

```javascript
// Standard agent container mounts
const agentMounts = [
  // Agent source code (profile-dependent)
  {
    source: '$CWD/code/$AGENT',  // Symlink to .ploinky/repos/<repo>/<agent>/code/
    target: '/code',
    ro: profile !== 'dev'  // Read-only in qa/prod
  },

  // Node modules (from workspace agents directory)
  {
    source: '$CWD/agents/$AGENT/node_modules',
    target: '/code/node_modules',
    ro: true  // Read-only in container, installed on host
  },

  // Agent skills (profile-dependent)
  {
    source: '$CWD/skills/$AGENT',  // Symlink to .ploinky/repos/<repo>/<agent>/.AchillesSkills/
    target: '/.AchillesSkills',
    ro: profile !== 'dev'  // Read-only in qa/prod
  },

  // Ploinky Agent tools (always read-only)
  {
    source: '$PLOINKY_ROOT/Agent',
    target: '/Agent',
    ro: true
  },

  // Shared directory (read-write)
  {
    source: '$CWD/.ploinky/shared',
    target: '/shared'
  },

  // CWD passthrough (read-write) - for accessing workspace files
  {
    source: '$CWD',
    target: '$CWD'
  }
];
```

### Dependency Installation

Dependencies are installed in the workspace `agents/<agent>/` directory on the host, then mounted into the container. See [DS12 - Dependency Installation](./DS12-dependency-installation.md) for details.

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
│           ├── @anthropic-ai/
│           └── node-pty/

Container View:
/code/
├── index.js                  # Agent source (from .ploinky/repos/...)
├── package.json              # Agent's package.json
└── node_modules/             # Mounted from $CWD/agents/<agent>/node_modules/
```

### Container Naming Convention

```
ploinky_<repo>_<agent>_<hash>

Examples:
- ploinky_basic_node-dev_a1b2c3d4
- ploinky_cloud_aws-cli_e5f6g7h8
- ploinky_custom_my-agent_i9j0k1l2
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTAINER_RUNTIME` | Force docker or podman | Auto-detected |
| `CONTAINER_TIMEOUT` | Default stop timeout | `10` |

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
