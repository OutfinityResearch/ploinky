# cli/services/workspaceStructure.js - Workspace Directory Structure

## Overview

Manages workspace directory structure including initialization, symlink creation for agent code and skills, and workspace verification. Implements the new workspace layout with `agents/`, `code/`, and `skills/` directories.

## Source File

`cli/services/workspaceStructure.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR, AGENTS_WORK_DIR, CODE_DIR, SKILLS_DIR, REPOS_DIR } from './config.js';
```

## Public API

### initWorkspaceStructure(workspacePath)

**Purpose**: Initializes workspace directory structure

**Parameters**:
- `workspacePath` (string): Workspace path (default: process.cwd())

**Creates**:
- `.ploinky/`
- `agents/`
- `code/`
- `skills/`

**Implementation**:
```javascript
export function initWorkspaceStructure(workspacePath = process.cwd()) {
    const dirs = [
        path.join(workspacePath, '.ploinky'),
        path.join(workspacePath, 'agents'),
        path.join(workspacePath, 'code'),
        path.join(workspacePath, 'skills')
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
```

### createAgentSymlinks(agentName, repoName, agentPath)

**Purpose**: Creates symlinks for agent code and skills directories

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `agentPath` (string): Full path to agent directory in repos

**Symlinks Created**:
- `$CWD/code/<agentName>` → `.ploinky/repos/<repo>/<agent>/code/` (or agent dir if no code subfolder)
- `$CWD/skills/<agentName>` → `.ploinky/repos/<repo>/<agent>/.AchillesSkills/` (if exists)

**Implementation**:
```javascript
export function createAgentSymlinks(agentName, repoName, agentPath) {
    const cwd = process.cwd();

    // Ensure directories exist
    const codeDir = path.join(cwd, 'code');
    const skillsDir = path.join(cwd, 'skills');

    if (!fs.existsSync(codeDir)) {
        fs.mkdirSync(codeDir, { recursive: true });
    }
    if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
    }

    // Code symlink
    const codeSymlinkPath = path.join(codeDir, agentName);
    const codeTargetPath = path.join(agentPath, 'code');
    const actualCodeTarget = fs.existsSync(codeTargetPath) ? codeTargetPath : agentPath;

    // Remove existing symlink, warn if blocked by real directory
    let codeBlocked = false;
    try {
        const stat = fs.lstatSync(codeSymlinkPath);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(codeSymlinkPath);
        } else {
            console.warn(`Warning: ${codeSymlinkPath} exists and is not a symlink. Skipping code symlink for ${agentName}.`);
            codeBlocked = true;
        }
    } catch (_) {}

    if (!codeBlocked) {
        try {
            fs.symlinkSync(actualCodeTarget, codeSymlinkPath, 'dir');
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error(`Failed to create code symlink for ${agentName}: ${err.message}`);
            }
        }
    }

    // Skills symlink (only if .AchillesSkills exists)
    const skillsSymlinkPath = path.join(skillsDir, agentName);
    const skillsTargetPath = path.join(agentPath, '.AchillesSkills');

    if (fs.existsSync(skillsTargetPath)) {
        let skillsBlocked = false;
        try {
            const stat = fs.lstatSync(skillsSymlinkPath);
            if (stat.isSymbolicLink()) {
                fs.unlinkSync(skillsSymlinkPath);
            } else {
                console.warn(`Warning: ${skillsSymlinkPath} exists and is not a symlink. Skipping skills symlink for ${agentName}.`);
                skillsBlocked = true;
            }
        } catch (_) {}

        if (!skillsBlocked) {
            try {
                fs.symlinkSync(skillsTargetPath, skillsSymlinkPath, 'dir');
            } catch (err) {
                if (err.code !== 'EEXIST') {
                    console.error(`Failed to create skills symlink for ${agentName}: ${err.message}`);
                }
            }
        }
    }
}
```

### removeAgentSymlinks(agentName)

**Purpose**: Removes symlinks for agent

**Parameters**:
- `agentName` (string): Agent name

**Implementation**:
```javascript
export function removeAgentSymlinks(agentName) {
    const cwd = process.cwd();
    const codeSymlinkPath = path.join(cwd, 'code', agentName);
    const skillsSymlinkPath = path.join(cwd, 'skills', agentName);

    // Only remove if it's a symlink (don't accidentally delete real directories)
    try {
        if (fs.lstatSync(codeSymlinkPath).isSymbolicLink()) {
            fs.unlinkSync(codeSymlinkPath);
        }
    } catch (_) {}

    try {
        if (fs.lstatSync(skillsSymlinkPath).isSymbolicLink()) {
            fs.unlinkSync(skillsSymlinkPath);
        }
    } catch (_) {}
}
```

### getAgentWorkDir(agentName)

**Purpose**: Gets agent working directory path

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Path to `$CWD/agents/<agentName>/`

**Implementation**:
```javascript
export function getAgentWorkDir(agentName) {
    return path.join(process.cwd(), 'agents', agentName);
}
```

### getAgentCodePath(agentName)

**Purpose**: Gets agent code symlink path

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Path to `$CWD/code/<agentName>/`

**Implementation**:
```javascript
export function getAgentCodePath(agentName) {
    return path.join(process.cwd(), 'code', agentName);
}
```

### getAgentSkillsPath(agentName)

**Purpose**: Gets agent skills symlink path

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Path to `$CWD/skills/<agentName>/`

**Implementation**:
```javascript
export function getAgentSkillsPath(agentName) {
    return path.join(process.cwd(), 'skills', agentName);
}
```

### createAgentWorkDir(agentName)

**Purpose**: Creates agent working directory

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string) Created directory path

**Implementation**:
```javascript
export function createAgentWorkDir(agentName) {
    const workDir = getAgentWorkDir(agentName);
    if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
    }
    return workDir;
}
```

### removeAgentWorkDir(agentName, force)

**Purpose**: Removes agent working directory

**Parameters**:
- `agentName` (string): Agent name
- `force` (boolean): Remove even if not empty (default: false)

**Implementation**:
```javascript
export function removeAgentWorkDir(agentName, force = false) {
    const workDir = getAgentWorkDir(agentName);
    try {
        if (fs.existsSync(workDir)) {
            if (force) {
                fs.rmSync(workDir, { recursive: true, force: true });
            } else {
                fs.rmdirSync(workDir);
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY') {
            console.error(`Failed to remove agent work dir for ${agentName}: ${err.message}`);
        }
    }
}
```

### verifyWorkspaceStructure()

**Purpose**: Verifies workspace structure integrity

**Returns**: `{ valid: boolean, issues: string[] }`

**Checks**:
- Required directories exist (.ploinky, agents, code, skills)
- Symlinks in code/ and skills/ are not broken

**Implementation**:
```javascript
export function verifyWorkspaceStructure() {
    const cwd = process.cwd();
    const issues = [];

    const requiredDirs = [
        { path: path.join(cwd, '.ploinky'), name: '.ploinky' },
        { path: path.join(cwd, 'agents'), name: 'agents' },
        { path: path.join(cwd, 'code'), name: 'code' },
        { path: path.join(cwd, 'skills'), name: 'skills' }
    ];

    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir.path)) {
            issues.push(`Missing directory: ${dir.name}`);
        } else if (!fs.statSync(dir.path).isDirectory()) {
            issues.push(`${dir.name} exists but is not a directory`);
        }
    }

    // Check symlinks
    const codeDir = path.join(cwd, 'code');
    if (fs.existsSync(codeDir)) {
        for (const entry of fs.readdirSync(codeDir)) {
            const entryPath = path.join(codeDir, entry);
            try {
                const stat = fs.lstatSync(entryPath);
                if (stat.isSymbolicLink()) {
                    const target = fs.readlinkSync(entryPath);
                    const resolvedTarget = path.resolve(codeDir, target);
                    if (!fs.existsSync(resolvedTarget)) {
                        issues.push(`Broken symlink: code/${entry} -> ${target}`);
                    }
                }
            } catch (_) {}
        }
    }

    // Similar check for skills directory...

    return { valid: issues.length === 0, issues };
}
```

### getPackageBaseTemplatePath()

**Purpose**: Gets path to package.base.json template

**Returns**: (string) Template path

**Resolution Order**:
1. Local: `.ploinky/package.base.json`
2. Default: `templates/package.base.json`

### agentHasPackageJson(agentName)

**Purpose**: Checks if agent has package.json

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (boolean)

## Exports

```javascript
export {
    initWorkspaceStructure,
    createAgentSymlinks,
    removeAgentSymlinks,
    getAgentWorkDir,
    getAgentCodePath,
    getAgentSkillsPath,
    createAgentWorkDir,
    removeAgentWorkDir,
    verifyWorkspaceStructure,
    getPackageBaseTemplatePath,
    agentHasPackageJson
};
```

## Workspace Layout

```
workspace/
├── .ploinky/                    # Ploinky configuration
│   ├── agents.json              # Agent records
│   ├── repos/                   # Cloned repositories
│   │   └── basic/
│   │       └── node-dev/
│   │           ├── manifest.json
│   │           ├── code/
│   │           └── .AchillesSkills/
│   └── routing.json
├── agents/                      # Agent working directories (rw)
│   └── node-dev/
├── code/                        # Symlinks to agent code (profile-dependent)
│   └── node-dev -> ../.ploinky/repos/basic/node-dev/code/
└── skills/                      # Symlinks to agent skills (profile-dependent)
    └── node-dev -> ../.ploinky/repos/basic/node-dev/.AchillesSkills/
```

## Container Mount Mapping

| Host Path | Container Path | Mode |
|-----------|----------------|------|
| $CWD | $CWD | rw (CWD passthrough for runtime data) |
| code/<agent>/ | /code | rw (dev) / ro (qa/prod) |
| agents/<agent>/node_modules/ | /code/node_modules | ro (always) |
| skills/<agent>/ | /code/.AchillesSkills | rw (dev) / ro (qa/prod) |

## Usage Example

```javascript
import {
    initWorkspaceStructure,
    createAgentSymlinks,
    verifyWorkspaceStructure,
    getAgentWorkDir
} from './workspaceStructure.js';

// Initialize workspace
initWorkspaceStructure();

// Create symlinks for agent
createAgentSymlinks('node-dev', 'basic', '/path/to/repos/basic/node-dev');

// Verify structure
const { valid, issues } = verifyWorkspaceStructure();
if (!valid) {
    console.error('Workspace issues:', issues);
}

// Get working directory
const workDir = getAgentWorkDir('node-dev');
```

## Related Modules

- [service-config.md](../config/service-config.md) - Directory constants
- [service-workspace.md](./service-workspace.md) - Agent records
- [docker-agent-service-manager.md](../docker/docker-agent-service-manager.md) - Container mounts
