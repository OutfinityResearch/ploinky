# Folder Structure Comparison: Before vs After

This document compares the workspace folder structure before and after the recent architectural changes.

---

## Host Machine Folder Structure

### BEFORE

```
workspace/
├── .ploinky/                         # Config directory
│   ├── agents.json                   # Agent registry
│   ├── .secrets                      # Secrets file
│   ├── routing.json                  # Router configuration
│   └── repos/                        # Cloned repositories
│       └── <repo-name>/
│           └── <agent-name>/         # Agent source code (mixed with runtime)
│               ├── index.js
│               ├── package.json
│               ├── mcp-config.json   # Config lived here
│               ├── node_modules/     # Dependencies here
│               └── .AchillesSkills/
└── [user files]
```

**Characteristics:**
- Agent source code and runtime data mixed together in `.ploinky/repos/`
- `mcp-config.json` stored alongside source code
- `node_modules/` installed directly in agent source directory
- Working directory based on `process.cwd()` (inconsistent)
- No dedicated working directories for agents

### AFTER

```
workspace/
├── .ploinky/                         # Config directory (hidden)
│   ├── agents.json                   # Agent registry
│   ├── .secrets                      # Secrets file
│   ├── profile                       # NEW: Active profile (dev/qa/prod)
│   ├── routing.json                  # Router configuration
│   └── repos/                        # Cloned repositories
│       └── <repo-name>/
│           └── <agent-name>/         # Agent source code ONLY
│               ├── code/             # Source code subfolder
│               │   ├── index.js
│               │   └── package.json
│               └── .AchillesSkills/  # Skills directory
│
├── agents/                           # NEW: Agent working directories
│   └── <agent-name>/                 # Per-agent runtime data
│       ├── node_modules/             # Agent dependencies
│       ├── mcp-config.json           # Staged config
│       └── [runtime files]           # Logs, cache, etc.
│
├── code/                             # NEW: Symlinks to agent source
│   └── <agent-name> -> ../.ploinky/repos/<repo>/<agent>/code/
│
├── skills/                           # NEW: Symlinks to agent skills
│   └── <agent-name> -> ../.ploinky/repos/<repo>/<agent>/.AchillesSkills/
│
└── [user files]
```

**Characteristics:**
- Clean separation between source code and runtime data
- Dedicated `agents/` directory for working directories
- Convenient symlinks for code and skills access from workspace root
- Profile-based configuration for different environments
- Workspace root discovered by searching for `.ploinky` marker

---

## Container Mount Structure

### BEFORE

| Host Path | Container Path | Mode | Purpose |
|-----------|----------------|------|---------|
| `.ploinky/repos/<repo>/<agent>/` | `/code` | rw or ro* | Agent code + runtime |
| `$PLOINKY_ROOT/node_modules/` (optional) | `/node_modules` | ro | Shared dependencies |
| `$CWD` | `$CWD` | rw | Project passthrough |
| `/path/to/Agent` | `/Agent` | ro | Agent library |
| `/path/to/shared` | `/shared` | rw | Shared directory |

*Mode controlled by `PLOINKY_CODE_WRITABLE` environment variable

**Working Directory:** Set to `$CWD` (host's current working directory)

### AFTER

| Host Path | Container Path | Mode | Purpose |
|-----------|----------------|------|---------|
| `.ploinky/repos/<repo>/<agent>/code/` | `/code` | profile-based* | Agent source code |
| `agents/<agent>/node_modules/` | `/code/node_modules` | ro | ESM module resolution |
| `.ploinky/repos/<repo>/<agent>/.AchillesSkills/` | `/code/.AchillesSkills` | profile-based* | Skills directory |
| `/path/to/Agent` | `/Agent` | ro | Agent library |
| `/path/to/shared` | `/shared` | rw | Shared directory |
| `$CWD` | `$CWD` | rw | CWD passthrough (provides access to agents/<name>/ at same path) |

*Profile-based modes:
- **dev profile:** `/code` = rw, `/code/.AchillesSkills` = rw
- **qa profile:** `/code` = ro, `/code/.AchillesSkills` = ro
- **prod profile:** `/code` = ro, `/code/.AchillesSkills` = ro

**Working Directory:** Fixed to `/code` (consistent across all agents)

**Environment Variables:**
- `WORKSPACE_PATH=$CWD/agents/<agent>/` - Path to agent runtime data (accessible via CWD mount)

---

## Container Internal Structure

### BEFORE

```
/
├── code/                    # Agent source + runtime (mixed)
│   ├── index.js
│   ├── package.json
│   ├── mcp-config.json
│   ├── node_modules/        # If present locally
│   └── .AchillesSkills/
├── node_modules/            # Optional shared mount
├── Agent/                   # Agent library (read-only)
├── shared/                  # Shared directory
└── <$CWD>/                  # Passthrough mount
```

### AFTER

```
/
├── code/                    # Source code (working directory)
│   ├── index.js
│   ├── package.json
│   ├── mcp-config.json      # Configuration
│   ├── node_modules/        # Mounted from agents/<name>/node_modules/
│   └── .AchillesSkills/     # Skills (separate mount)
├── Agent/                   # Agent library (read-only)
├── shared/                  # Shared directory
└── <$CWD>/                  # CWD passthrough mount
    └── agents/<name>/       # Agent runtime data (WORKSPACE_PATH points here)
        ├── fast-start.log   # Agent logs
        ├── node_modules/    # Installed dependencies
        └── data/            # Agent-created data
```

---

## Key Differences Summary

| Aspect | Before | After |
|--------|--------|-------|
| Source/runtime separation | Mixed together | Source at `/code`, runtime via CWD mount |
| Agent working directory | None (used source dir) | `/code` (source), `$CWD/agents/<name>/` (runtime) |
| Runtime data location | In source dir | In `agents/<name>/` via CWD passthrough mount |
| `mcp-config.json` location | In source code | In `/code` |
| `node_modules` location | In source dir or shared | In `agents/<name>/node_modules/` mounted at `/code/node_modules` |
| Container working dir | Variable (`$CWD`) | Fixed (`/code`) |
| Profile support | None | dev/qa/prod with mount modes |
| Code access from root | Via `.ploinky/repos/...` | Via `code/<agent>` symlink |
| Skills access from root | Via `.ploinky/repos/...` | Via `skills/<agent>` symlink |
| Workspace discovery | `process.cwd()` | Search for `.ploinky` marker |
| WORKSPACE_PATH env var | Not set | `$CWD/agents/<name>/` |

---

## Configuration Constants

### BEFORE (`config.js`)

```javascript
export const PLOINKY_DIR = path.join(process.cwd(), '.ploinky');
export const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
export const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents');
export const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');
```

### AFTER (`config.js`)

```javascript
export const WORKSPACE_ROOT = findWorkspaceRoot();  // Searches for .ploinky
export const PLOINKY_DIR = path.join(WORKSPACE_ROOT, '.ploinky');
export const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
export const AGENTS_FILE = path.join(PLOINKY_DIR, 'agents');
export const SECRETS_FILE = path.join(PLOINKY_DIR, '.secrets');
export const PROFILE_FILE = path.join(PLOINKY_DIR, 'profile');

// NEW workspace directories
export const AGENTS_WORK_DIR = path.join(WORKSPACE_ROOT, 'agents');
export const CODE_DIR = path.join(WORKSPACE_ROOT, 'code');
export const SKILLS_DIR = path.join(WORKSPACE_ROOT, 'skills');
```

---

## Dependency Installation

Dependencies are installed in the workspace `agents/<agent>/` directory on the host, then mounted into the container at `/code/node_modules`. The CWD mount enables npm to run inside the container but write directly to the host filesystem.

### Core Dependencies (Global)

All agents receive these 4 core dependencies from `templates/package.base.json`:

| Package | Purpose |
|---------|---------|
| `achillesAgentLib` | Agent framework and skill system |
| `mcp-sdk` | MCP protocol implementation |
| `flexsearch` | Full-text search for document indexing |
| `node-pty` | PTY support for interactive terminals |

### Installation Flow

All operations run **inside the running agent container** via CWD mount:

```
1. Agent container starts with CWD mounted at same path
2. Lifecycle hook triggers installDependencies()
3. Inside container: mkdir -p $CWD/agents/<agent>/
4. Inside container: Copy core package.json (4 global deps) to $CWD/agents/<agent>/package.json
5. Inside container: Run npm install (installs 4 global deps)
6. If agent has package.json in /code:
   a. Inside container: cp /code/package.json $CWD/agents/<agent>/package.json
   b. Inside container: Run npm install (adds agent deps to existing node_modules)
7. node_modules available at /code/node_modules via mount
```

### Directory Structure for Dependencies

```
$CWD/
├── agents/
│   └── myAgent/
│       ├── package.json       # Agent's package.json (copied from /code)
│       ├── package-lock.json
│       └── node_modules/      # Installed dependencies (core + agent)
│           ├── achillesAgentLib/
│           ├── mcp-sdk/
│           ├── flexsearch/
│           └── node-pty/
│
├── code/
│   └── myAgent -> ../.ploinky/repos/.../code/
│       └── package.json       # Agent's original package.json
```

---

## Benefits of New Structure

1. **Clean separation of concerns** - Source code is isolated from runtime data
2. **Read-only source in production** - Source code can be mounted read-only in qa/prod
3. **Consistent working directory** - Container always starts in `/code`
4. **Easier access** - Symlinks provide quick access to code and skills from workspace root
5. **Profile-aware behavior** - Different mount modes based on environment
6. **Persistent working directories** - Agent runtime data survives container restarts
7. **Flexible workspace commands** - Commands work from any subdirectory
8. **In-container dependency installation** - npm install runs inside the running container via CWD mount, persists to host filesystem
9. **Core dependencies available to all agents** - 4 global packages (achillesAgentLib, mcp-sdk, flexsearch, node-pty) automatically installed
