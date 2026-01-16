# Ploinky Profile System Specification

## Overview

This specification defines a profile-based configuration system for Ploinky that enables environment-specific behavior (dev, qa, prod) with dedicated lifecycle hooks and secure secret injection from GitHub Actions.

> **Note**: Throughout this document, `$CWD` refers to the current working directory where `ploinky` commands are executed. This is typically the project root directory.

---

## Current vs Proposed: Side-by-Side Comparison

### Directory Structure Comparison

| Aspect | Current Implementation | Proposed Implementation |
|--------|----------------------|------------------------|
| **Working Directory** | `$CWD` (where ploinky runs) | `$CWD` (unchanged) |
| **Root node_modules** | `$CWD/node_modules/` (shared) | **REMOVED** - No root node_modules |
| **Agent node_modules** | Inside container or shared | `$CWD/agents/<name>/node_modules/` (isolated per agent) |
| **Agent source code** | `$CWD/.ploinky/repos/<repo>/<agent>/` | Same location + symlink at `$CWD/code/<agent>/` |
| **Agent skills** | `$CWD/.ploinky/repos/<repo>/<agent>/.AchillesSkills/` | Same location + symlink at `$CWD/skills/<agent>/` |
| **Agent working dir** | Varies / inside container | `$CWD/agents/<agent>/` (centralized) |
| **Runtime data** | Mixed locations | `$CWD/agents/<agent>/` (in agent working dir) |

### Workspace Layout Comparison

**CURRENT Structure:**
```
$CWD/                                    # Current working directory
├── node_modules/                        # Shared dependencies (PROBLEM: pollutes project)
│   ├── achillesAgentLib/
│   ├── mcp-sdk/
│   └── ...
│
├── .ploinky/
│   ├── agents                           # Agent registry
│   ├── repos/
│   │   └── <repo>/<agent>/
│   │       ├── manifest.json
│   │       ├── code/                    # Only accessible via full path
│   │       └── .AchillesSkills/         # Only accessible via full path
│   └── ...
│
└── (project files)
```

**PROPOSED Structure:**
```
$CWD/                                    # Current working directory
├── .ploinky/                            # [FOLDER] Config & repos (unchanged)
│   ├── agents
│   ├── profile                          # NEW: Active profile
│   └── repos/<repo>/<agent>/
│       ├── manifest.json
│       ├── code/
│       └── .AchillesSkills/
│
├── agents/                              # [NEW FOLDER] Agent working directories
│   ├── agent1/
│   │   ├── node_modules/                # Isolated dependencies
│   │   ├── package.json
│   │   └── data/
│   └── agent2/
│       └── ...
│
├── code/                                # [NEW SYMLINKS] Easy access to agent code
│   ├── agent1 -> ../.ploinky/repos/<repo>/agent1/code/
│   └── agent2 -> ../.ploinky/repos/<repo>/agent2/code/
│
├── skills/                              # [NEW SYMLINKS] Easy access to skills
│   ├── agent1 -> ../.ploinky/repos/<repo>/agent1/.AchillesSkills/
│   └── agent2 -> ../.ploinky/repos/<repo>/agent2/.AchillesSkills/
│
└── (project files)                      # No node_modules pollution!
```

### Container Creation Comparison

**CURRENT Implementation:**

```bash
# Current container creation (simplified)
docker run -d \
  --name ${agentName} \
  -v "$CWD:$CWD"                                           \  # Mount entire CWD
  -v "$PLOINKY_ROOT/Agent:/Agent:ro"                       \  # Mount Agent tools
  -v "$CWD/.ploinky/repos/$repo/$agent/code:/code:ro"      \  # Mount agent code
  -e "NODE_PATH=$CWD/node_modules"                         \  # Use shared node_modules
  ${containerImage}
```

**PROPOSED Implementation:**

```bash
# Proposed container creation (simplified)
docker run -d \
  --name ${agentName} \
  -v "$CWD:$CWD"                                                 \  # CWD passthrough (rw)
  -v "$CWD/code/$agentName:/code:ro"                             \  # Via symlink
  -v "$CWD/agents/$agentName/node_modules:/code/node_modules:ro" \  # Node modules
  -v "$CWD/skills/$agentName:/.AchillesSkills:ro"                \  # Via symlink
  -v "$PLOINKY_ROOT/Agent:/Agent:ro"                             \  # Agent tools
  -e "WORKSPACE_PATH=$CWD/agents/$agentName"                     \  # Runtime data path
  ${containerImage}

# After container starts, npm install runs INSIDE the container via CWD mount:
docker exec -w "$CWD/agents/$agentName" ${agentName} npm install
# node_modules persisted on host at $CWD/agents/$agentName/node_modules/
```

### Volume Mount Comparison

**CURRENT Mounts:**

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `$CWD` | `$CWD` | Full $CWD (same path inside) |
| `$CWD/.ploinky/repos/<repo>/<agent>/code` | `/code` | Agent source code |
| `$PLOINKY_ROOT/Agent` | `/Agent` | Ploinky agent tools |
| `$CWD/node_modules` (via NODE_PATH) | - | Shared dependencies |

**PROPOSED Mounts:**

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `$CWD` | `$CWD` | CWD passthrough (provides access to agents/<name>/) |
| `$CWD/code/<agent>` (symlink) | `/code` | Agent source code (**profile-dependent: rw in dev, ro in qa/prod**) |
| `$CWD/agents/<agent>/node_modules` | `/code/node_modules` | Node modules (ro) |
| `$CWD/skills/<agent>` (symlink) | `/code/.AchillesSkills` | Agent skills (**profile-dependent: rw in dev, ro in qa/prod**) |
| `$PLOINKY_ROOT/Agent` | `/Agent` | Ploinky agent tools (ro) |

**Note:** npm install runs inside the container via CWD mount. Runtime data (logs, cache) is written to `$CWD/agents/<agent>/` accessed via the CWD passthrough mount.

### Lifecycle Comparison

**CURRENT Lifecycle:**

```
1. Container Creation
2. preinstall (if defined)
3. install (if defined)
4. postinstall (if defined)
5. Agent Ready
```

**PROPOSED Lifecycle:**

```
1.  Workspace Structure Init [HOST]
2.  Symbolic Links Creation [HOST]
3.  Container Creation
4.  hosthook_aftercreation [HOST]             # NEW
5.  Container Start
6.  Core Dependencies Installation [CONTAINER]     # NEW (npm install inside container)
7.  Agent Dependencies Installation [CONTAINER]    # NEW (npm install inside container)
8.  preinstall [CONTAINER]
9.  install [CONTAINER]
10. postinstall [CONTAINER]
11. hosthook_postinstall [HOST]               # NEW
12. Agent Ready
```

### Key Benefits of Proposed Changes

| Benefit | Description |
|---------|-------------|
| **No root pollution** | Project root stays clean - no `node_modules/` folder |
| **Isolated dependencies** | Each agent has its own `node_modules/` - no version conflicts |
| **Easy code access** | `$CWD/code/<agent>/` symlinks provide quick access |
| **Easy skills access** | `$CWD/skills/<agent>/` symlinks for skill management |
| **Profile support** | Environment-specific configuration (dev/qa/prod) |
| **Host hooks** | Execute scripts on host before/after container lifecycle |
| **Centralized working dirs** | All agent data in `$CWD/agents/` |
| **Faster rebuilds** | Dependencies cached per agent, not rebuilt each time |

---

## Feature Summary

- **New Command**: `ploinky profile <profileName>`
- **Supported Profiles**: `dev`, `qa`, `prod` (extensible)
- **Secret Management**: GitHub Actions secrets injected into environment
- **Profile-Specific Scripts**: Environment-aware pre/post install scripts
- **Extended Lifecycle Hooks**: Host-side and container-side hooks

---

## Command Syntax

```bash
# Set active profile
ploinky profile <profileName>

# Examples
ploinky profile dev
ploinky profile qa
ploinky profile prod

# Show current profile
ploinky profile

# List available profiles
ploinky profile list

# Validate profile configuration
ploinky profile validate <profileName>
```

---

## Manifest Schema Extension

### Profile Definition in `manifest.json`

The profile system uses a **default profile** that is always applied as a base, with active profiles merged on top. This eliminates the need for top-level `env`, `install`, `postinstall` fields.

**Hook format**: All hooks must be single command strings (not arrays).

```json
{
  "container": "node:20-bullseye",
  "about": "My application agent",

  "profiles": {
    "default": {
      "env": {
        "MY_VAR": "value",
        "API_KEY": { "required": true }
      },
      "install": "npm install",
      "postinstall": "scripts/setup.sh"
    },
    "dev": {
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "true",
        "LOG_LEVEL": "debug"
      },
      "preinstall": "scripts/dev-setup.sh",
      "secrets": ["DEV_API_KEY", "DEV_DATABASE_URL"]
    },

    "qa": {
      "env": {
        "NODE_ENV": "test",
        "DEBUG": "false",
        "LOG_LEVEL": "info"
      },
      "secrets": ["QA_API_KEY", "QA_DATABASE_URL", "QA_TEST_TOKEN"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    },

    "prod": {
      "env": {
        "NODE_ENV": "production",
        "DEBUG": "false",
        "LOG_LEVEL": "error"
      },
      "hosthook_postinstall": "scripts/register-service.sh",
      "secrets": ["PROD_API_KEY", "PROD_DATABASE_URL", "PROD_SSL_CERT"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    }
  }
}
```

### Profile Merging Logic

When a profile is active (e.g., "dev"), the effective configuration is computed by merging the `default` profile with the active profile:

1. **Start with `profiles.default`** as the base configuration
2. **Deep merge the active profile** on top:
   - **Env variables**: Active profile overrides default (deep merge)
   - **Hooks**: Active profile hooks override default hooks (not concatenate)
   - **Secrets**: Concatenate (active profile secrets added to default secrets)
   - **Mounts**: Active profile overrides default (deep merge)

**Example with "dev" active:**
```javascript
// profiles.default:
{
  env: { MY_VAR: "value", API_KEY: { required: true } },
  install: "npm install",
  postinstall: "scripts/setup.sh"
}

// profiles.dev:
{
  env: { NODE_ENV: "development", DEBUG: "true" },
  preinstall: "scripts/dev-setup.sh",
  secrets: ["DEV_API_KEY"]
}

// Effective merged config:
{
  env: {
    MY_VAR: "value",              // from default
    API_KEY: { required: true },   // from default
    NODE_ENV: "development",       // from dev
    DEBUG: "true"                  // from dev
  },
  install: "npm install",          // from default
  postinstall: "scripts/setup.sh", // from default
  preinstall: "scripts/dev-setup.sh", // from dev
  secrets: ["DEV_API_KEY"]         // from dev
}
```

### Profile Field Reference

| Field | Type | Execution Context | Description |
|-------|------|-------------------|-------------|
| `hosthook_aftercreation` | string | **Host** | Script executed on host immediately after container creation |
| `preinstall` | string | **Container** | Script executed in container before install |
| `install` | string | **Container** | Main installation script |
| `postinstall` | string | **Container** | Script executed in container after install |
| `hosthook_postinstall` | string | **Host** | Script executed on host after container postinstall completes |
| `env` | object | **Container** | Profile-specific environment variables |
| `secrets` | array | **Container** | List of secret names to inject from GitHub Actions |
| `mounts` | object | **Container** | Profile-specific mount modes (see below) |

**Note:** All hook fields must be single command strings, not arrays. This is a breaking change from previous versions.

### Profile-Specific Mount Modes

Each profile can specify whether `/code` and `/.AchillesSkills` are mounted read-write or read-only:

```json
{
  "profiles": {
    "dev": {
      "mounts": {
        "code": "rw",
        "skills": "rw"
      }
    },
    "qa": {
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    },
    "prod": {
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    }
  }
}
```

**Default mount modes by profile:**

| Profile | `/code` | `/.AchillesSkills` | Rationale |
|---------|---------|---------------------|-----------|
| `dev` | **rw** (read-write) | **rw** (read-write) | Developers need to edit code and skills |
| `qa` | **ro** (read-only) | **ro** (read-only) | Testing should not modify source |
| `prod` | **ro** (read-only) | **ro** (read-only) | Production must be immutable |

**Note:** Runtime data is written to `$CWD/agents/<agent>/` via the CWD passthrough mount.

---

## Lifecycle Hook Execution Order

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Profile Lifecycle Execution                       │
└─────────────────────────────────────────────────────────────────────┘

1. Workspace Structure Init [HOST]
   └─→ Ensure directories exist: .ploinky/, agents/, code/, skills/
   └─→ Create agent working folder: $CWD/agents/<agentName>/

2. Symbolic Links Creation [HOST]
   └─→ Create code symlink: $CWD/code/<agentName> -> .ploinky/repos/<repo>/<agent>/code/
   └─→ Create skills symlink: $CWD/skills/<agentName> -> .ploinky/repos/<repo>/<agent>/.AchillesSkills/
   └─→ Verify symlinks resolve correctly

3. Container Creation
   └─→ docker/podman create <container>
   └─→ Mount volumes:
       - $CWD -> $CWD (CWD passthrough for runtime data access)
       - $CWD/code/<agent> -> /code
       - $CWD/agents/<agent>/node_modules -> /code/node_modules
       - $CWD/skills/<agent> -> /code/.AchillesSkills

4. hosthook_aftercreation [HOST]
   └─→ Execute: .ploinky/repos/<repo>/<agent>/scripts/<profile>_aftercreation.sh
   └─→ Context: Host machine, has access to host filesystem
   └─→ Use cases: Configure host networking, prepare host volumes, notify external systems

5. Container Start
   └─→ docker/podman start <container>

6. Core Dependencies Installation [CONTAINER] (conditional)
   └─→ Skip if NO package.json exists (neither core template needed nor /code/package.json)
   └─→ If agent needs Node.js deps:
       └─→ Copy generic package.json template to $CWD/agents/<agent>/package.json
       └─→ Execute inside container: cd "$CWD/agents/<agent>" && npm install
       └─→ Installs Ploinky core dependencies (achillesAgentLib, MCP SDK, etc.)
       └─→ node_modules created at $CWD/agents/<agent>/node_modules (persisted on host)

7. Agent Dependencies Installation [CONTAINER] (conditional)
   └─→ Skip if /code/package.json does NOT exist
   └─→ If /code/package.json exists:
       └─→ Merge dependencies into $CWD/agents/<agent>/package.json (core deps take precedence)
       └─→ Execute inside container: cd "$CWD/agents/<agent>" && npm install
       └─→ Installs agent's custom dependencies

8. preinstall [CONTAINER]
   └─→ Execute: scripts/<profile>_preinstall.sh inside container
   └─→ Context: Container, after npm dependencies installed
   └─→ Use cases: System package updates, user creation, directory setup

9. install [CONTAINER]
   └─→ Execute: scripts/<profile>_install.sh inside container
   └─→ Context: Container, main installation phase
   └─→ Use cases: Build application, configure services

10. postinstall [CONTAINER]
    └─→ Execute: scripts/<profile>_postinstall.sh inside container
    └─→ Context: Container, after installation complete
    └─→ Use cases: Database migrations, cache warming, health checks

11. hosthook_postinstall [HOST]
    └─→ Execute: .ploinky/repos/<repo>/<agent>/scripts/<profile>_host_postinstall.sh
    └─→ Context: Host machine, after container fully initialized
    └─→ Use cases: Register with service discovery, update load balancer, send notifications

12. Agent Ready
    └─→ AgentServer.mjs starts accepting requests
```

---

## Workspace Structure

### Overview

The new directory structure eliminates `node_modules` from the project root and organizes agent resources using a combination of dedicated folders and symbolic links. This provides:

- Clean separation between agent working directories and source code
- Easy access to agent code and skills via symbolic links
- Isolated `node_modules` per agent (no root node_modules pollution)

### Directory Layout

```
$CWD/
│
├── .ploinky/                              # [FOLDER] Ploinky configuration & repos
│   ├── agents                             # Agent registry (JSON)
│   ├── enabled_repos.json                 # Enabled repositories
│   ├── .secrets                           # Secrets file
│   ├── profile                            # Active profile
│   ├── routing.json                       # Router config (generated)
│   │
│   └── repos/                             # Cloned agent repositories
│       ├── basic/
│       │   ├── node-dev/
│       │   │   ├── manifest.json
│       │   │   ├── code/                  # Agent source code
│       │   │   │   ├── package.json
│       │   │   │   └── ...
│       │   │   └── .AchillesSkills/       # Agent skills
│       │   │       └── ...
│       │   └── ...
│       └── custom-repo/
│           └── my-agent/
│               ├── manifest.json
│               ├── code/
│               └── .AchillesSkills/
│
├── agents/                                # [FOLDER] Agent working directories
│   ├── agent1/                            # Working directory for agent1
│   │   ├── node_modules/                  # Isolated dependencies
│   │   │   ├── achillesAgentLib/
│   │   │   ├── mcp-sdk/
│   │   │   └── <agent-specific-deps>/
│   │   ├── package.json                   # Merged package.json
│   │   ├── package-lock.json
│   │   └── data/                          # Agent runtime data
│   │
│   ├── agent2/
│   │   ├── node_modules/
│   │   ├── package.json
│   │   └── ...
│   │
│   └── agentN/
│       └── ...
│
├── code/                                  # [SYMLINKS] Links to agent source code
│   ├── agent1 -> ../.ploinky/repos/<repo>/agent1/code/
│   ├── agent2 -> ../.ploinky/repos/<repo>/agent2/code/
│   └── agentN -> ../.ploinky/repos/<repo>/agentN/code/
│
└── skills/                                # [SYMLINKS] Links to agent skills
    ├── agent1 -> ../.ploinky/repos/<repo>/agent1/.AchillesSkills/
    ├── agent2 -> ../.ploinky/repos/<repo>/agent2/.AchillesSkills/
    └── agentN -> ../.ploinky/repos/<repo>/agentN/.AchillesSkills/
```

### Key Changes from Previous Structure

| Aspect | Old Structure | New Structure |
|--------|---------------|---------------|
| Root node_modules | `$CWD/node_modules/` | **REMOVED** - No root node_modules |
| Agent dependencies | Shared or in container | `$CWD/agents/<name>/node_modules/` (isolated per agent) |
| Agent source code | `.ploinky/repos/...` only | Symlinked at `$CWD/code/<agent>/` |
| Agent skills | `.ploinky/repos/.../. AchillesSkills/` | Symlinked at `$CWD/skills/<agent>/` |
| Working directories | Mixed locations | Centralized at `$CWD/agents/` |

### Symbolic Link Management

#### Creation on Agent Enable

When an agent is enabled, symbolic links are created:

```bash
# Enable agent "my-agent" from repo "custom"
ploinky enable agent my-agent

# Creates:
# $CWD/code/my-agent -> $CWD/.ploinky/repos/custom/my-agent/code/
# $CWD/skills/my-agent -> $CWD/.ploinky/repos/custom/my-agent/.AchillesSkills/
```

#### Removal on Agent Disable

When an agent is disabled, symbolic links are removed:

```bash
# Disable agent "my-agent"
ploinky disable agent my-agent

# Removes:
# $CWD/code/my-agent (symlink)
# $CWD/skills/my-agent (symlink)
# Optionally: $CWD/agents/my-agent/ (working directory)
```

### Implementation Interface

```javascript
// cli/services/workspaceStructure.js

/**
 * Initialize workspace directory structure
 * Creates: .ploinky/, agents/, code/, skills/ directories
 * @param {string} workspacePath - Root workspace path
 * @returns {Promise<void>}
 */
export async function initWorkspaceStructure(workspacePath) { }

/**
 * Create symbolic links for an agent
 * @param {string} agentName - Agent name
 * @param {string} repoPath - Path to agent in repos
 * @returns {Promise<{codeLink: string, skillsLink: string}>}
 */
export async function createAgentSymlinks(agentName, repoPath) { }

/**
 * Remove symbolic links for an agent
 * @param {string} agentName - Agent name
 * @returns {Promise<void>}
 */
export async function removeAgentSymlinks(agentName) { }

/**
 * Get agent working directory path
 * @param {string} agentName - Agent name
 * @returns {string} Path to $CWD/agents/<agentName>/
 */
export function getAgentWorkDir(agentName) { }

/**
 * Get agent code path (via symlink)
 * @param {string} agentName - Agent name
 * @returns {string} Path to $CWD/code/<agentName>/
 */
export function getAgentCodePath(agentName) { }

/**
 * Get agent skills path (via symlink)
 * @param {string} agentName - Agent name
 * @returns {string} Path to $CWD/skills/<agentName>/
 */
export function getAgentSkillsPath(agentName) { }

/**
 * Verify workspace structure integrity
 * @returns {{valid: boolean, issues: string[]}}
 */
export function verifyWorkspaceStructure() { }
```

---

## Agent Dependency Installation

### Overview

Agent dependencies are installed in a two-phase process on the host before container creation. This ensures all Node.js dependencies (both Ploinky core and agent-specific) are ready and mounted into the container.

### Directory Structure

```
$CWD/agents/<agentName>/
├── node_modules/                  # Combined dependencies (isolated per agent)
│   ├── achillesAgentLib/          # Core: LLM agent library
│   ├── mcp-sdk/                   # Core: MCP protocol
│   ├── <agent-deps>/              # Agent-specific packages
│   └── ...
├── package.json                   # Merged package.json
├── package-lock.json              # Lock file
└── data/                          # Agent runtime data
```

### Installation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                Agent Dependency Installation Flow                    │
└─────────────────────────────────────────────────────────────────────┘

Step 1: Create Agent Working Directory [HOST]
        ┌─────────────────────────────────────────────┐
        │  mkdir -p $CWD/agents/<agentName>           │
        └─────────────────────────────────────────────┘
                              │
                              ▼
Step 2: Create Container with Volume Mounts [HOST]
        ┌─────────────────────────────────────────────┐
        │  docker create ...                          │
        │    -v $CWD:$CWD                             │  # CWD passthrough (rw)
        │    -v $CWD/code/<agentName>:/code:ro        │  # Source code (ro)
        │    -v $CWD/agents/<agentName>/node_modules:/code/node_modules:ro │
        │    -v $CWD/skills/<agentName>:/code/.AchillesSkills:ro │
        │    ...                                      │
        │                                             │
        │  docker start <container>                   │
        └─────────────────────────────────────────────┘
                              │
                              ▼
Step 3: Check for package.json [CONTAINER]
        ┌─────────────────────────────────────────────┐
        │  # Check if /code/package.json exists       │
        │  test -f /code/package.json                 │
        │                                             │
        │  ┌─────────────────┐  ┌──────────────────┐  │
        │  │ EXISTS          │  │ NOT EXISTS       │  │
        │  │ → Continue to   │  │ → Skip Steps 4-5 │  │
        │  │   Step 4        │  │ → Go to Step 6   │  │
        │  └─────────────────┘  └──────────────────┘  │
        └─────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ (if exists)       │ (if not exists)
                    ▼                   ▼
Step 4: Install Core Ploinky Dependencies [CONTAINER] (conditional)
        ┌─────────────────────────────────────────────┐
        │  # Only if package.json needed              │
        │                                             │
        │  Copy: package.base.json → $CWD/agents/<agentName>/package.json │
        │                                             │
        │  cd "$CWD/agents/<agentName>" && npm install│
        │                                             │
        │  # Installs core deps:                      │
        │  {                                          │
        │    "dependencies": {                        │
        │      "achillesAgentLib": "...",            │
        │      "mcp-sdk": "...",                     │
        │      "node-pty": "..."                     │
        │    }                                        │
        │  }                                          │
        │                                             │
        │  # node_modules persisted on host at:       │
        │  # $CWD/agents/<agentName>/node_modules/    │
        └─────────────────────────────────────────────┘
                              │
                              ▼
Step 5: Install Agent-Specific Dependencies [CONTAINER] (conditional)
        ┌─────────────────────────────────────────────┐
        │  # Only if /code/package.json exists        │
        │                                             │
        │  Merge /code/package.json dependencies      │
        │  into $CWD/agents/<agentName>/package.json  │
        │  (core deps take precedence)                │
        │                                             │
        │  cd "$CWD/agents/<agentName>" && npm install│
        │                                             │
        │  # Agent-specific deps now installed        │
        └─────────────────────────────────────────────┘
                              │
                              ▼
Step 6: Continue with Profile Lifecycle [CONTAINER]
        ┌─────────────────────────────────────────────┐
        │  Execute: preinstall script                 │
        │  Execute: install script                    │
        │  Execute: postinstall script                │
        │  Start: AgentServer.mjs                     │
        └─────────────────────────────────────────────┘
```

### Conditional Logic Summary

| Condition | Action |
|-----------|--------|
| `/code/package.json` exists | Copy base template, merge deps, run `npm install` |
| `/code/package.json` does NOT exist | Skip npm install entirely, proceed to preinstall |
| `node_modules` already exists | Skip `npm install` (cached from previous run) |

### Benefits of In-Container npm install

| Benefit | Description |
|---------|-------------|
| **Correct Node version** | Uses container's Node.js version, not host's |
| **Platform compatibility** | Native modules compile for container's Linux |
| **No host Node required** | Host doesn't need Node.js installed |
| **Isolated environment** | npm runs in container's isolated environment |
| **Cached on host** | node_modules persisted at `$CWD/agents/<agent>/node_modules/` |
| **Faster rebuilds** | Skip npm install if node_modules already exists |

### Generic Package.json Template

Located at `ploinky/templates/package.base.json`:

```json
{
  "name": "ploinky-agent-runtime",
  "version": "1.0.0",
  "description": "Ploinky agent runtime dependencies",
  "type": "module",
  "dependencies": {
    "achillesAgentLib": "github:OutfinityResearch/achillesAgentLib",
    "mcp-sdk": "github:PloinkyRepos/MCPSDK#main",
    "node-pty": "^1.0.0",
    "flexsearch": "github:PloinkyRepos/flexsearch#main"
  }
}
```

### Dependency Merge Strategy

When merging agent's `package.json` with core dependencies:

```javascript
// cli/services/dependencyInstaller.js

/**
 * Merge agent package.json with core dependencies
 * Core dependencies take precedence (cannot be overridden)
 */
function mergePackageJson(corePackage, agentPackage) {
  return {
    name: `ploinky-agent-${agentPackage.name || 'custom'}`,
    version: agentPackage.version || '1.0.0',
    type: 'module',
    dependencies: {
      // Core dependencies (locked versions)
      ...corePackage.dependencies,
      // Agent dependencies (merged, core takes precedence)
      ...agentPackage.dependencies,
      // Re-apply core to ensure they're not overridden
      ...corePackage.dependencies
    },
    devDependencies: agentPackage.devDependencies || {}
  };
}
```

### Implementation Interface

```javascript
// cli/services/dependencyInstaller.js

/**
 * Setup agent working directory
 * @param {string} agentName - Agent name
 * @returns {string} Path to agent working directory
 */
export async function setupAgentWorkDir(agentName) { }

/**
 * Install core Ploinky dependencies
 * @param {string} agentWorkDir - Agent working directory path
 * @returns {Promise<void>}
 */
export async function installCoreDependencies(agentWorkDir) { }

/**
 * Install agent-specific dependencies from /code/package.json
 * @param {string} agentWorkDir - Agent working directory path
 * @param {string} codeDir - Path to agent's /code directory
 * @returns {Promise<void>}
 */
export async function installAgentDependencies(agentWorkDir, codeDir) { }

/**
 * Full dependency installation flow
 * @param {string} agentName - Agent name
 * @param {string} codeDir - Path to agent's /code directory
 * @returns {Promise<{workDir: string, nodeModulesPath: string}>}
 */
export async function installAllDependencies(agentName, codeDir) { }

/**
 * Get docker volume mount flags for dependencies
 * @param {string} agentWorkDir - Agent working directory path
 * @returns {string[]} Docker -v flags
 */
export function getDependencyMountFlags(agentWorkDir) { }
```

### Container Mount Configuration

The new directory structure is mounted into the container with the following mappings:

```javascript
// In agentServiceManager.js

// Get mount mode based on profile (dev=rw, qa/prod=ro)
const codeMountMode = profile === 'dev' ? '' : ':ro';
const skillsMountMode = profile === 'dev' ? '' : ':ro';

const containerMounts = [
  // CWD passthrough - provides access to agents/<name>/ for runtime data
  `-v ${CWD}:${CWD}`,

  // Mount agent code - profile-dependent (rw in dev, ro in qa/prod)
  `-v ${CWD}/code/${agentName}:/code${codeMountMode}`,

  // Mount node_modules for ESM resolution (always ro)
  `-v ${CWD}/agents/${agentName}/node_modules:/code/node_modules:ro`,

  // Mount agent skills - profile-dependent (rw in dev, ro in qa/prod)
  `-v ${CWD}/skills/${agentName}:/code/.AchillesSkills${skillsMountMode}`,

  // Mount Ploinky Agent tools (always ro)
  `-v ${PLOINKY_ROOT}/Agent:/Agent:ro`,

  // Set WORKSPACE_PATH to agent runtime data directory
  `-e WORKSPACE_PATH=${CWD}/agents/${agentName}`
];
```

### Container Directory Structure

Inside the container, the structure appears as:

```
/  (container root)
├── code/                      # Mounted from $CWD/code/<agent>/ (rw in dev, ro in qa/prod)
│   ├── package.json           # Agent's source package.json
│   ├── index.js
│   ├── node_modules/          # Mounted from $CWD/agents/<agent>/node_modules/ (ro)
│   │   ├── achillesAgentLib/
│   │   ├── mcp-sdk/
│   │   └── <agent-specific-deps>/
│   └── .AchillesSkills/       # Mounted from $CWD/skills/<agent>/ (rw in dev, ro in qa/prod)
│
├── Agent/                     # Mounted from ploinky/Agent/ (always ro)
│   ├── server/
│   │   └── AgentServer.mjs
│   └── ...
│
└── <$CWD>/                    # CWD passthrough mount
    └── agents/<agent>/        # Agent runtime data (WORKSPACE_PATH points here)
        ├── package.json       # Core deps (copied from template)
        ├── package-lock.json  # Generated after npm install
        ├── node_modules/      # Created by npm install (mounted to /code/node_modules)
        └── ...                # Runtime data (logs, cache)
```

### npm Install Execution Inside Container

```javascript
// In agentServiceManager.js - after container start

async function installDependencies(containerName, agentName, agentWorkDir) {
  // agentWorkDir = $CWD/agents/<agentName>/ (accessible via CWD mount)

  // Step 1: Check if agent has a package.json (needs Node.js deps)
  const hasAgentPackage = await dockerExec(containerName, 'test -f /code/package.json && echo "yes"');

  // If no package.json exists, skip npm install entirely
  if (!hasAgentPackage) {
    console.log(`No package.json found for ${agentName}, skipping npm install`);
    return;
  }

  // Step 2: Check if node_modules already exists (cached on host)
  const hasNodeModules = await dockerExec(containerName, `test -d "${agentWorkDir}/node_modules" && echo "yes"`);

  if (hasNodeModules) {
    console.log(`Using cached node_modules for ${agentName}`);
    return;
  }

  // Step 3: Copy base package.json template to agent work dir
  await dockerExec(containerName, `cp /Agent/templates/package.base.json "${agentWorkDir}/package.json"`);

  // Step 4: Install core dependencies
  await dockerExec(containerName, `cd "${agentWorkDir}" && npm install`);

  // Step 5: Merge agent dependencies into package.json (core deps take precedence)
  await dockerExec(containerName, `
    node -e "
      const core = require('${agentWorkDir}/package.json');
      const agent = require('/code/package.json');
      const merged = {
        ...core,
        dependencies: { ...agent.dependencies, ...core.dependencies }
      };
      require('fs').writeFileSync('${agentWorkDir}/package.json', JSON.stringify(merged, null, 2));
    "
  `);

  // Step 6: Install merged dependencies
  await dockerExec(containerName, `cd "${agentWorkDir}" && npm install`);
}
```

### Profile-Specific Dependency Overrides

Profiles can specify additional dependencies:

```json
{
  "profiles": {
    "dev": {
      "dependencies": {
        "nodemon": "^3.0.0",
        "jest": "^29.0.0"
      }
    },
    "prod": {
      "dependencies": {
        "pm2": "^5.0.0"
      }
    }
  }
}
```

### Caching Strategy

Dependencies are cached to speed up subsequent agent starts:

```
$CWD/agents/
├── .cache/
│   ├── package.base.hash          # Hash of base package.json
│   └── <agentName>.deps.hash      # Hash of agent's merged deps
│
└── <agentName>/
    ├── node_modules/              # Reused if hashes match
    └── package.json
```

```javascript
/**
 * Check if dependencies need reinstallation
 * @param {string} agentName - Agent name
 * @param {string} codeDir - Agent code directory
 * @returns {boolean} True if npm install needed
 */
export function needsReinstall(agentName, codeDir) {
  const currentHash = hashPackageFiles(agentName, codeDir);
  const cachedHash = readCachedHash(agentName);
  return currentHash !== cachedHash;
}
```

### Error Handling

```
Error: Failed to install agent dependencies

  Agent: my-agent
  Phase: Agent dependencies (Step 3)

  npm ERR! code ERESOLVE
  npm ERR! ERESOLVE unable to resolve dependency tree

  The agent's package.json has conflicting dependencies.

  Core dependencies (cannot be changed):
    - achillesAgentLib: github:OutfinityResearch/achillesAgentLib
    - mcp-sdk: github:PloinkyRepos/MCPSDK#main

  Conflicting agent dependency:
    - mcp-sdk: ^2.0.0 (conflicts with core)

  Resolution:
    1. Remove conflicting dependency from /code/package.json
    2. Or use a compatible version
```

---

## Secret Management

### GitHub Actions Integration

Secrets are stored in GitHub Actions and injected into the Ploinky environment at runtime.

#### GitHub Actions Workflow Example

```yaml
# .github/workflows/deploy.yml
name: Deploy with Ploinky

on:
  push:
    branches: [main, develop, release/*]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Ploinky
        run: |
          export PATH="$PATH:$(pwd)/ploinky/bin"

      - name: Deploy Dev
        if: github.ref == 'refs/heads/develop'
        env:
          PLOINKY_PROFILE: dev
          DEV_API_KEY: ${{ secrets.DEV_API_KEY }}
          DEV_DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}
        run: |
          ploinky profile dev
          ploinky start my-agent 8088

      - name: Deploy QA
        if: startsWith(github.ref, 'refs/heads/release/')
        env:
          PLOINKY_PROFILE: qa
          QA_API_KEY: ${{ secrets.QA_API_KEY }}
          QA_DATABASE_URL: ${{ secrets.QA_DATABASE_URL }}
          QA_TEST_TOKEN: ${{ secrets.QA_TEST_TOKEN }}
        run: |
          ploinky profile qa
          ploinky start my-agent 8088

      - name: Deploy Prod
        if: github.ref == 'refs/heads/main'
        env:
          PLOINKY_PROFILE: prod
          PROD_API_KEY: ${{ secrets.PROD_API_KEY }}
          PROD_DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
          PROD_SSL_CERT: ${{ secrets.PROD_SSL_CERT }}
        run: |
          ploinky profile prod
          ploinky start my-agent 8088
```

### Secret Injection Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Secret Injection Flow                             │
└─────────────────────────────────────────────────────────────────────┘

1. GitHub Actions runs workflow
   └─→ Secrets loaded from repository settings

2. Environment variables set in workflow
   └─→ DEV_API_KEY, DEV_DATABASE_URL, etc.

3. Ploinky reads profile configuration
   └─→ manifest.profiles[profileName].secrets = ["DEV_API_KEY", ...]

4. Secret validation
   └─→ Check all required secrets exist in environment
   └─→ Fail fast with clear error if missing

5. Secret injection to container
   └─→ Pass via docker -e flags (never written to disk)
   └─→ Available inside container as environment variables

6. Scripts can access secrets
   └─→ $DEV_API_KEY available in preinstall, install, postinstall scripts
```

### Local Development Secret Handling

For local development, secrets can be stored in `.ploinky/.secrets` or `.env` files:

```bash
# .ploinky/.secrets
DEV_API_KEY=local-dev-key-12345
DEV_DATABASE_URL=postgres://localhost:5432/devdb

# Or use .env file
# .env.dev
DEV_API_KEY=local-dev-key-12345
DEV_DATABASE_URL=postgres://localhost:5432/devdb
```

**Security Note**: `.ploinky/.secrets` and `.env.*` files should be in `.gitignore`.

---

## File Structure

### Profile Scripts Directory

```
.ploinky/repos/<repo>/<agent>/
├── manifest.json
├── scripts/
│   ├── dev_aftercreation.sh      # Host hook after container creation (dev)
│   ├── dev_preinstall.sh         # Container preinstall (dev)
│   ├── dev_install.sh            # Container install (dev)
│   ├── dev_postinstall.sh        # Container postinstall (dev)
│   ├── dev_host_postinstall.sh   # Host hook after postinstall (dev)
│   │
│   ├── qa_aftercreation.sh       # Host hook after container creation (qa)
│   ├── qa_preinstall.sh          # Container preinstall (qa)
│   ├── qa_install.sh             # Container install (qa)
│   ├── qa_postinstall.sh         # Container postinstall (qa)
│   ├── qa_host_postinstall.sh    # Host hook after postinstall (qa)
│   │
│   ├── prod_aftercreation.sh     # Host hook after container creation (prod)
│   ├── prod_preinstall.sh        # Container preinstall (prod)
│   ├── prod_install.sh           # Container install (prod)
│   ├── prod_postinstall.sh       # Container postinstall (prod)
│   └── prod_host_postinstall.sh  # Host hook after postinstall (prod)
│
└── code/
    └── ... (application code)
```

### Alternative: Unified Script with Profile Argument

```
.ploinky/repos/<repo>/<agent>/
├── manifest.json
├── scripts/
│   ├── aftercreation.sh          # Receives $PLOINKY_PROFILE as argument
│   ├── preinstall.sh
│   ├── install.sh
│   ├── postinstall.sh
│   └── host_postinstall.sh
```

In this case, manifest would be:

```json
{
  "profiles": {
    "dev": {
      "hosthook_aftercreation": "scripts/aftercreation.sh dev",
      "preinstall": "scripts/preinstall.sh dev",
      "install": "scripts/install.sh dev",
      "postinstall": "scripts/postinstall.sh dev",
      "hosthook_postinstall": "scripts/host_postinstall.sh dev"
    }
  }
}
```

---

## Configuration Storage

### Active Profile Storage

The active profile is stored in `.ploinky/profile`:

```bash
# .ploinky/profile
dev
```

### Profile in Agents Registry

```json
{
  "my-agent": {
    "agentName": "my-agent",
    "repoName": "myrepo",
    "containerImage": "node:20-bullseye",
    "profile": "dev",
    "profileConfig": {
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "true"
      },
      "secretsLoaded": ["DEV_API_KEY", "DEV_DATABASE_URL"]
    }
  }
}
```

---

## Implementation Details

### New Files to Create

| File | Purpose |
|------|---------|
| `cli/commands/profileCommands.js` | Profile command handlers |
| `cli/services/profileService.js` | Profile loading, validation, switching |
| `cli/services/secretInjector.js` | Secret validation and injection |
| `cli/services/lifecycleHooks.js` | Hook execution orchestration |
| `cli/services/dependencyInstaller.js` | Agent dependency installation (core + agent deps) |
| `cli/services/workspaceStructure.js` | Workspace directory structure and symlink management |
| `templates/package.base.json` | Generic package.json template for core dependencies |

### Modified Files

| File | Changes |
|------|---------|
| `cli/commands/cli.js` | Add `profile` command routing |
| `cli/services/commandRegistry.js` | Register `profile` subcommands |
| `cli/services/agents.js` | Profile-aware agent enablement, integrate dependency installation |
| `cli/services/docker/agentServiceManager.js` | Execute profile lifecycle hooks, mount node_modules |
| `cli/services/docker/agentCommands.js` | Pass profile env to container, set NODE_PATH |
| `cli/services/docker/common.js` | Add dependency mount volume helpers |
| `cli/services/workspaceUtil.js` | Call dependency installer before container creation |

### Command Registry Update

```javascript
// cli/services/commandRegistry.js
const rawCommands = {
    // ... existing commands
    profile: ['list', 'validate'],  // subcommands
    // ...
};
```

### Profile Service Interface

```javascript
// cli/services/profileService.js

/**
 * Get the currently active profile
 * @returns {string} Profile name (dev, qa, prod)
 */
export function getActiveProfile() { }

/**
 * Set the active profile
 * @param {string} profileName - Profile to activate
 * @returns {Promise<void>}
 */
export async function setActiveProfile(profileName) { }

/**
 * Get profile configuration from manifest
 * @param {string} agentName - Agent name
 * @param {string} profileName - Profile name
 * @returns {object} Profile configuration
 */
export function getProfileConfig(agentName, profileName) { }

/**
 * Validate profile configuration
 * @param {string} agentName - Agent name
 * @param {string} profileName - Profile name
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProfile(agentName, profileName) { }

/**
 * List available profiles for an agent
 * @param {string} agentName - Agent name
 * @returns {string[]} Available profile names
 */
export function listProfiles(agentName) { }
```

### Secret Injector Interface

```javascript
// cli/services/secretInjector.js

/**
 * Validate all required secrets are available
 * @param {string[]} requiredSecrets - List of secret names
 * @returns {{valid: boolean, missing: string[]}}
 */
export function validateSecrets(requiredSecrets) { }

/**
 * Get secrets from environment or .secrets file
 * @param {string[]} secretNames - List of secret names to retrieve
 * @returns {object} Map of secret name to value
 */
export function getSecrets(secretNames) { }

/**
 * Build docker -e flags for secrets
 * @param {object} secrets - Map of secret name to value
 * @returns {string[]} Array of ['-e', 'NAME=value', ...]
 */
export function buildSecretEnvFlags(secrets) { }
```

### Lifecycle Hooks Interface

```javascript
// cli/services/lifecycleHooks.js

/**
 * Execute host hook (runs on host machine)
 * @param {string} scriptPath - Path to script
 * @param {object} env - Environment variables
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function executeHostHook(scriptPath, env) { }

/**
 * Execute container hook (runs inside container)
 * @param {string} containerName - Container name
 * @param {string} script - Script path or command
 * @param {object} env - Environment variables
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function executeContainerHook(containerName, script, env) { }

/**
 * Run full profile lifecycle
 * @param {string} agentName - Agent name
 * @param {string} profileName - Profile name
 * @param {object} options - Additional options
 * @returns {Promise<void>}
 */
export async function runProfileLifecycle(agentName, profileName, options) { }
```

---

## Environment Variables

### Ploinky Profile Environment Variables

| Variable | Description |
|----------|-------------|
| `PLOINKY_PROFILE` | Currently active profile name |
| `PLOINKY_PROFILE_ENV` | Profile environment (dev/qa/prod) |
| `PLOINKY_SECRETS_SOURCE` | Source of secrets (github_actions/local/env) |

### Variables Available in Scripts

Scripts receive these environment variables:

```bash
# In all scripts
PLOINKY_PROFILE=dev
PLOINKY_AGENT_NAME=my-agent
PLOINKY_REPO_NAME=myrepo
PLOINKY_CWD=$CWD

# Profile-specific env from manifest
NODE_ENV=development
DEBUG=true
LOG_LEVEL=debug

# Secrets (from GitHub Actions or local)
DEV_API_KEY=xxx
DEV_DATABASE_URL=xxx

# In host hooks only
PLOINKY_CONTAINER_NAME=my-agent
PLOINKY_CONTAINER_ID=abc123...
```

---

## Error Handling

### Missing Secret Error

```
Error: Missing required secrets for profile 'prod'

  The following secrets are required but not found:
    - PROD_API_KEY
    - PROD_DATABASE_URL

  Ensure these secrets are:
    1. Set in GitHub Actions repository secrets, OR
    2. Defined in .ploinky/.secrets file, OR
    3. Set as environment variables

  Run 'ploinky profile validate prod' for more details.
```

### Invalid Profile Error

```
Error: Profile 'staging' not found in manifest

  Available profiles for agent 'my-agent':
    - dev
    - qa
    - prod

  To add a new profile, update manifest.json:
    "profiles": {
      "staging": { ... }
    }
```

### Hook Execution Failure

```
Error: Profile hook 'preinstall' failed for profile 'qa'

  Script: scripts/qa_preinstall.sh
  Exit code: 1

  stdout:
    Installing dependencies...

  stderr:
    npm ERR! code ENOENT
    npm ERR! syscall open

  The agent was not started. Fix the script and retry:
    ploinky profile qa
    ploinky start my-agent 8088
```

---

## CLI Output Examples

### Set Profile

```bash
$ ploinky profile dev

Profile set to: dev

Environment:
  NODE_ENV=development
  DEBUG=true
  LOG_LEVEL=debug

Secrets required:
  - DEV_API_KEY ✓ (found)
  - DEV_DATABASE_URL ✓ (found)

Lifecycle hooks:
  1. hosthook_aftercreation: scripts/dev_aftercreation.sh
  2. preinstall: scripts/dev_preinstall.sh
  3. install: scripts/dev_install.sh
  4. postinstall: scripts/dev_postinstall.sh
  5. hosthook_postinstall: scripts/dev_host_postinstall.sh
```

### List Profiles

```bash
$ ploinky profile list

Available profiles:

  Profile  Status   Secrets
  ───────  ──────   ───────
  dev      active   2/2 ✓
  qa       ready    3/3 ✓
  prod     missing  1/3 ✗ (PROD_SSL_CERT missing)
```

### Validate Profile

```bash
$ ploinky profile validate prod

Validating profile 'prod'...

Manifest: ✓ Valid JSON
Profile definition: ✓ Found in manifest

Environment variables:
  NODE_ENV=production ✓
  DEBUG=false ✓
  LOG_LEVEL=error ✓

Secrets:
  PROD_API_KEY: ✗ NOT FOUND
  PROD_DATABASE_URL: ✓ Found in environment
  PROD_SSL_CERT: ✗ NOT FOUND

Scripts:
  scripts/prod_aftercreation.sh: ✓ Exists, executable
  scripts/prod_preinstall.sh: ✓ Exists, executable
  scripts/prod_install.sh: ✓ Exists, executable
  scripts/prod_postinstall.sh: ✓ Exists, executable
  scripts/prod_host_postinstall.sh: ✗ NOT FOUND

Validation FAILED: 3 errors found
```

---

## Migration Guide

### Breaking Change: Profile-Based Configuration Required

**This is a breaking change.** All manifests with top-level `env`, `install`, `postinstall` fields must be migrated to the new profile-based structure. There is no backward compatibility support.

### Migration Steps

1. **Move top-level hooks to `profiles.default`**:

```json
// BEFORE (no longer works):
{
  "container": "node:20-bullseye",
  "install": "npm install",
  "postinstall": "npm run build",
  "env": {
    "MY_VAR": "value"
  }
}

// AFTER (required):
{
  "container": "node:20-bullseye",
  "profiles": {
    "default": {
      "install": "npm install",
      "postinstall": "npm run build",
      "env": {
        "MY_VAR": "value"
      }
    }
  }
}
```

2. **Convert hook arrays to strings** (if applicable):

```json
// BEFORE (arrays no longer supported):
{
  "install": ["npm install", "npm run build"]
}

// AFTER (single command string):
{
  "profiles": {
    "default": {
      "install": "npm install && npm run build"
    }
  }
}
```

### Adding Profile-Specific Overrides

After migrating to the default profile, add environment-specific profiles:

```json
{
  "profiles": {
    "default": {
      "env": { "MY_VAR": "value" },
      "install": "npm install"
    },
    "dev": {
      "env": { "DEBUG": "true" }
    },
    "prod": {
      "env": { "DEBUG": "false" },
      "mounts": { "code": "ro", "skills": "ro" }
    }
  }
}
```

---

## Security Considerations

1. **Never commit secrets**: `.ploinky/.secrets` and `.env.*` must be in `.gitignore`
2. **Secrets in memory only**: Secrets are passed via `-e` flags, never written to container filesystem
3. **Host hooks run with user privileges**: Ensure host hook scripts are trusted
4. **Validate script sources**: Only execute scripts from within the repo directory
5. **Audit secret access**: Log which secrets are accessed (names only, not values)

---

## Future Enhancements

1. **Profile inheritance**: `qa` extends `dev` with overrides
2. **Conditional hooks**: Execute hooks based on conditions
3. **Secret rotation**: Automatic secret rotation support
4. **Remote secret stores**: Integrate with HashiCorp Vault, AWS Secrets Manager
5. **Profile templates**: Predefined profile templates for common scenarios
