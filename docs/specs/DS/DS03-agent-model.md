# DS03 - Agent Model

## Summary

An "agent" is the fundamental unit in Ploinky - a self-contained, containerized service defined by a `manifest.json` file. Agents can be anything from development environments to microservices, databases, or AI assistants. This specification defines the agent concept, lifecycle, configuration, and communication patterns.

## Background / Problem Statement

Ploinky needs a consistent model for:
- Defining what an agent is and how it behaves
- Managing agent lifecycle (create, start, stop, destroy)
- Configuring agent resources (ports, volumes, environment)
- Enabling agent-to-agent communication
- Supporting multiple agent types (CLI tools, services, AI agents)

## Goals

1. **Universal Interface**: Any stdin/stdout program can be an agent
2. **Declarative Configuration**: Agents defined via JSON manifests
3. **Isolated Execution**: Each agent runs in its own container
4. **Predictable Lifecycle**: Clear states and transitions
5. **Flexible Communication**: Support HTTP, MCP, and direct I/O

## Non-Goals

- Agent clustering across multiple hosts
- Built-in service mesh features
- Custom container runtimes (only Docker/Podman)
- Agent versioning and rollback

## Architecture Overview

### Agent Structure

```
┌─────────────────────────────────────────────────────────────┐
│                         AGENT                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    CONTAINER                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ AgentServer  │  │ User Code    │  │ Skills       │  │ │
│  │  │ (MCP Server) │  │ (/code)      │  │ (.Achilles)  │  │ │
│  │  │ Port 7000    │  │              │  │              │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │                                                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │              Volume Mounts                        │  │ │
│  │  │  /code  /code/node_modules  /code/.AchillesSkills │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ manifest.json│  │ Env Vars     │  │ Port Mapping │       │
│  │              │  │              │  │ 7000->random │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Agent Types

| Type | Description | Example |
|------|-------------|---------|
| **CLI Tool** | Interactive command-line tool | `shell`, `alpine-bash` |
| **Service** | Long-running HTTP service | `postgres`, `keycloak` |
| **AI Agent** | LLM-powered assistant | `claude-code`, `node-dev` |
| **Development Environment** | Full dev environment | `python-dev`, `rust-dev` |

## Data Models

### Agent Registry Entry

```javascript
/**
 * @typedef {Object} AgentRegistryEntry
 * @property {string} agentName - Unique agent identifier
 * @property {string} repoName - Source repository name
 * @property {string} containerImage - Docker image URI
 * @property {string} containerId - Docker container ID (runtime)
 * @property {string} containerName - Docker container name
 * @property {Date} createdAt - Creation timestamp
 * @property {string} projectPath - Host project directory
 * @property {string} runMode - "isolated" | "global" | "devel"
 * @property {string} type - "agent" | "service"
 * @property {AgentConfig} config - Container configuration
 * @property {string} profile - Active profile (dev/qa/prod)
 */

/**
 * @typedef {Object} AgentConfig
 * @property {BindMount[]} binds - Volume bind mounts
 * @property {EnvVar[]} env - Environment variables
 * @property {PortMapping[]} ports - Port mappings
 */

/**
 * @typedef {Object} BindMount
 * @property {string} source - Host path
 * @property {string} target - Container path
 * @property {boolean} ro - Read-only flag
 */

/**
 * @typedef {Object} EnvVar
 * @property {string} name - Variable name
 * @property {string} [value] - Optional value
 * @property {boolean} [required] - Required flag
 */

/**
 * @typedef {Object} PortMapping
 * @property {number} containerPort - Port inside container
 * @property {number} hostPort - Port on host
 * @property {string} [hostIp] - Optional host IP
 */
```

### Container Naming Convention

```javascript
/**
 * Generate container name from agent properties
 * @param {string} repoName - Repository name
 * @param {string} agentName - Agent name
 * @param {string} projectPath - Project directory
 * @returns {string} Container name
 */
function generateContainerName(repoName, agentName, projectPath) {
  const projectHash = crypto
    .createHash('md5')
    .update(projectPath)
    .digest('hex')
    .substring(0, 8);

  return `ploinky_${repoName}_${agentName}_${projectHash}`;
}

// Example: ploinky_basic_node-dev_a1b2c3d4
```

## API Contracts

### Agent Lifecycle API

```javascript
// cli/services/agents.js

/**
 * Enable an agent from a repository
 * @param {string} agentName - Agent to enable
 * @param {string} [repoName] - Optional repository (auto-discovered if omitted)
 * @param {EnableOptions} [options] - Enable options
 * @returns {Promise<AgentRegistryEntry>}
 */
export async function enableAgent(agentName, repoName, options) {
  // 1. Find agent in repos
  const manifest = await findAgentManifest(agentName, repoName);

  // 2. Validate manifest
  validateManifest(manifest);

  // 3. Create registry entry
  const entry = createRegistryEntry(agentName, repoName, manifest, options);

  // 4. Save to registry
  await saveToRegistry(entry);

  // 5. Create workspace symlinks
  await createAgentSymlinks(agentName, getAgentRepoPath(repoName, agentName));

  return entry;
}

/**
 * Disable an agent
 * @param {string} agentName - Agent to disable
 * @returns {Promise<void>}
 */
export async function disableAgent(agentName) {
  // 1. Stop container if running
  await stopAgent(agentName);

  // 2. Remove from registry
  await removeFromRegistry(agentName);

  // 3. Remove workspace symlinks
  await removeAgentSymlinks(agentName);
}

/**
 * Start an agent
 * @param {string} agentName - Agent to start
 * @param {StartOptions} [options] - Start options
 * @returns {Promise<void>}
 */
export async function startAgent(agentName, options) {
  // 1. Load agent config
  const agent = await loadAgent(agentName);

  // 2. Ensure container exists
  if (!await containerExists(agent.containerName)) {
    await createAgentContainer(agent);
  }

  // 3. Start container
  await startContainer(agent.containerName);

  // 4. Run lifecycle hooks
  await runLifecycleHooks(agent, 'start');

  // 5. Wait for health check
  await waitForHealthy(agent);
}

/**
 * Stop an agent
 * @param {string} agentName - Agent to stop
 * @returns {Promise<void>}
 */
export async function stopAgent(agentName) {
  const agent = await loadAgent(agentName);
  await stopContainer(agent.containerName);
}

/**
 * Restart an agent
 * @param {string} agentName - Agent to restart
 * @returns {Promise<void>}
 */
export async function restartAgent(agentName) {
  await stopAgent(agentName);
  await startAgent(agentName);
}
```

### Agent Communication API

```javascript
// Agent/client/AgentMcpClient.mjs

/**
 * MCP Client for agent-to-agent communication
 */
export class AgentMcpClient {
  /**
   * Get MCP URL for an agent
   * @param {string} agentName - Target agent
   * @returns {string} MCP endpoint URL
   */
  getAgentMcpUrl(agentName) {
    return `/mcps/${agentName}/mcp`;
  }

  /**
   * Call a tool on another agent
   * @param {string} agentName - Target agent
   * @param {string} toolName - Tool to call
   * @param {object} params - Tool parameters
   * @returns {Promise<MCPResponse>}
   */
  async callTool(agentName, toolName, params) {
    const url = this.getAgentMcpUrl(agentName);
    const request = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name: toolName, arguments: params }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    return response.json();
  }

  /**
   * List available tools on an agent
   * @param {string} agentName - Target agent
   * @returns {Promise<Tool[]>}
   */
  async listTools(agentName) {
    // Implementation
  }

  /**
   * Get a resource from an agent
   * @param {string} agentName - Target agent
   * @param {string} resourceUri - Resource URI
   * @returns {Promise<Resource>}
   */
  async getResource(agentName, resourceUri) {
    // Implementation
  }
}
```

## Behavioral Specification

### Agent Lifecycle State Machine

```
                     ┌─────────────────────────────────────────┐
                     │           Agent Lifecycle                │
                     └─────────────────────────────────────────┘

    ┌──────────┐                                          ┌──────────┐
    │ UNKNOWN  │──────── enable agent ──────────────────▶│ ENABLED  │
    │          │                                          │ (no      │
    │ (agent   │                                          │ container│
    │  not in  │◀──────── disable agent ─────────────────│  yet)    │
    │  registry│                                          │          │
    └──────────┘                                          └────┬─────┘
                                                               │
                                                          start│
                                                               ▼
                                                    ┌──────────────────┐
                         ┌─────────────────────────│   CREATING       │
                         │                         │   (container     │
                         │                         │    building)     │
                         │                         └────────┬─────────┘
                         │                                  │
                         │                             created
                         │                                  ▼
                         │                         ┌──────────────────┐
    ┌──────────────────┐ │                         │   STARTING       │
    │   FAILED         │◀┼─────── error ───────────│   (container     │
    │   (error state)  │ │                         │    starting)     │
    └────────┬─────────┘ │                         └────────┬─────────┘
             │           │                                  │
        restart          │                            started│
             │           │                                  ▼
             │           │                         ┌──────────────────┐
             │           │           ┌────────────│   RUNNING        │
             │           │           │            │   (healthy)      │
             └───────────┼───────────┘            └────────┬─────────┘
                         │                                  │
                         │                              stop│
                         │                                  ▼
                         │                         ┌──────────────────┐
                         │                         │   STOPPED        │
                         │◀─────── shutdown ───────│   (container     │
                         │                         │    stopped)      │
                                                   └────────┬─────────┘
                                                            │
                                                       start│
                                                            │
                                                            └──────────▶ STARTING
```

### Container Creation Sequence

```javascript
async function createAgentContainer(agent) {
  // Step 1: Prepare workspace structure
  await initWorkspaceStructure();
  await createAgentSymlinks(agent.agentName, getRepoPath(agent));

  // Step 2: Build container config
  const containerConfig = {
    name: agent.containerName,
    image: agent.containerImage,
    env: [
      ...getProfileEnv(agent.profile),
      ...agent.config.env,
      { name: 'WORKSPACE_PATH', value: getAgentWorkDir(agent.agentName) }
    ],
    binds: [
      { source: CWD, target: CWD },  // CWD passthrough for runtime data access
      { source: getAgentCodePath(agent.agentName), target: '/code', ro: isReadOnly(agent.profile) },
      { source: path.join(getAgentWorkDir(agent.agentName), 'node_modules'), target: '/code/node_modules', ro: true },
      { source: getAgentSkillsPath(agent.agentName), target: '/code/.AchillesSkills', ro: isReadOnly(agent.profile) },
      { source: path.join(PLOINKY_ROOT, 'Agent'), target: '/Agent', ro: true }
    ],
    ports: agent.config.ports
  };

  // Step 3: Create container
  const containerId = await docker.createContainer(containerConfig);

  // Step 4: Execute host hook (after creation)
  await executeHostHook(agent, 'hosthook_aftercreation');

  // Step 5: Start container
  await docker.startContainer(containerId);

  // Step 6: Install dependencies (inside container)
  await installDependencies(containerId, agent);

  // Step 7: Run lifecycle hooks
  await executeContainerHook(containerId, agent, 'preinstall');
  await executeContainerHook(containerId, agent, 'install');
  await executeContainerHook(containerId, agent, 'postinstall');

  // Step 8: Execute host hook (after install)
  await executeHostHook(agent, 'hosthook_postinstall');

  // Step 9: Start AgentServer
  await startAgentServer(containerId);

  return containerId;
}
```

### Run Modes

| Mode | Description | Mount Behavior |
|------|-------------|----------------|
| `isolated` | Agent gets own project directory | `/code` mounted from `.ploinky/repos/...` |
| `global` | Uses current working directory | CWD mounted to container |
| `devel` | Development mode, points to dev repo | Custom repo path mounted |

```javascript
/**
 * Get project path based on run mode
 * @param {string} runMode - Run mode
 * @param {string} agentName - Agent name
 * @param {string} repoName - Repository name
 * @returns {string} Project path
 */
function getProjectPath(runMode, agentName, repoName) {
  switch (runMode) {
    case 'isolated':
      return path.join(WORKSPACE_ROOT, 'agents', agentName);
    case 'global':
      return process.cwd();
    case 'devel':
      return path.join(process.cwd(), '.ploinky', 'repos', repoName, agentName);
    default:
      return path.join(WORKSPACE_ROOT, 'agents', agentName);
  }
}
```

## Configuration

### Container Mounts

```javascript
// Default mount configuration
const defaultMounts = [
  {
    source: '$CWD',
    target: '$CWD',
    mode: 'rw'  // CWD passthrough for runtime data access
  },
  {
    source: '$CWD/code/$AGENT',
    target: '/code',
    mode: 'profile-dependent'  // rw in dev, ro in qa/prod
  },
  {
    source: '$CWD/agents/$AGENT/node_modules',
    target: '/code/node_modules',
    mode: 'ro'  // Always read-only
  },
  {
    source: '$CWD/skills/$AGENT',
    target: '/code/.AchillesSkills',
    mode: 'profile-dependent'  // rw in dev, ro in qa/prod
  },
  {
    source: '$PLOINKY_ROOT/Agent',
    target: '/Agent',
    mode: 'ro'  // Always read-only
  }
];
```

### Environment Variables Injected to Agents

| Variable | Description |
|----------|-------------|
| `PLOINKY_AGENT_NAME` | Current agent name |
| `PLOINKY_REPO_NAME` | Repository name |
| `PLOINKY_PROFILE` | Active profile |
| `WORKSPACE_PATH` | Agent runtime data path (`$CWD/agents/<agent>/`) |
| `AGENT_PORT` | AgentServer HTTP port (default: 7000) |
| `ROUTER_HOST` | Router hostname for inter-agent calls |

## Error Handling

### Agent Error States

| Error | Cause | Recovery |
|-------|-------|----------|
| `MANIFEST_NOT_FOUND` | Missing manifest.json | Check repo path, refresh repo |
| `CONTAINER_CREATE_FAILED` | Docker error during create | Check image, disk space |
| `CONTAINER_START_FAILED` | Container exits immediately | Check logs, fix entrypoint |
| `HEALTH_CHECK_TIMEOUT` | Agent not responding | Check port binding, agent code |
| `DEPENDENCY_INSTALL_FAILED` | npm install error | Check package.json, network |

### Error Messages

```javascript
const errorMessages = {
  MANIFEST_NOT_FOUND: (agent, repo) =>
    `Manifest not found for agent '${agent}' in repository '${repo}'.\n` +
    `Check that the agent exists: ls .ploinky/repos/${repo}/`,

  CONTAINER_CREATE_FAILED: (agent, error) =>
    `Failed to create container for agent '${agent}'.\n` +
    `Error: ${error.message}\n` +
    `Check Docker daemon status: docker info`,

  HEALTH_CHECK_TIMEOUT: (agent, timeout) =>
    `Agent '${agent}' did not become healthy within ${timeout}ms.\n` +
    `Check agent logs: ploinky logs tail ${agent}`
};
```

## Security Considerations

- **Container Isolation**: Agents run in separate containers with limited host access
- **Read-Only Mounts**: `/Agent` and `/code` (in prod) are read-only
- **Environment Isolation**: Secrets only injected to authorized agents
- **Network Isolation**: Containers communicate through router, not directly

## Performance Requirements

| Metric | Target |
|--------|--------|
| Agent enable | < 1s (excluding clone) |
| Container create | < 5s (excluding image pull) |
| Agent start | < 10s (including health check) |
| Agent stop | < 5s (graceful shutdown) |
| MCP call latency | < 100ms (within same host) |

## Success Criteria

1. Any stdin/stdout program can become an agent with minimal manifest
2. Agents start reliably across Docker and Podman
3. Health checks prevent routing to unhealthy agents
4. Agent-to-agent communication works via MCP
5. Environment isolation prevents secret leakage

## References

- [DS01 - Vision](./DS01-vision.md)
- [DS04 - Manifest Schema](./DS04-manifest-schema.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
- [DS08 - Profile System](./DS08-profile-system.md)
- [DS11 - Container Runtime](./DS11-container-runtime.md)
