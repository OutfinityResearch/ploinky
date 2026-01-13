# cli/services/docker/shellDetection.js - Shell Detection

## Overview

Detects available shell interpreters in container images. Supports both Podman image mount inspection and container-based probing for Docker compatibility.

## Source File

`cli/services/docker/shellDetection.js`

## Dependencies

```javascript
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { containerRuntime } from './common.js';
```

## Constants

```javascript
const SHELL_PROBE_PATHS = ['/bin/bash', '/bin/sh', '/bin/ash', '/bin/dash', '/bin/zsh', '/bin/fish', '/bin/ksh'];
const SHELL_FALLBACK_DIRECT = Symbol('no-shell');
const shellDetectionCache = new Map();
```

## Internal Functions

### normalizeMountPath(raw)

**Purpose**: Extracts mount path from podman image mount output

**Parameters**:
- `raw` (string): Raw output from `podman image mount`

**Returns**: (string) Mount path

### findShellInMount(mountPath)

**Purpose**: Finds first available shell in mounted image filesystem

**Parameters**:
- `mountPath` (string): Path to mounted image

**Returns**: (string) Shell path or empty string

**Implementation**:
```javascript
function findShellInMount(mountPath) {
    for (const shellPath of SHELL_PROBE_PATHS) {
        const relPath = shellPath.replace(/^\/+/, '');
        const candidate = path.join(mountPath, relPath);
        try {
            const stats = fs.statSync(candidate);
            if (stats.isFile() && (stats.mode & 0o111)) {
                return shellPath;
            }
        } catch (_) {}
    }
    return '';
}
```

### detectShellViaImageMount(image)

**Purpose**: Detects shell by mounting image (Podman only)

**Parameters**:
- `image` (string): Image name/tag

**Returns**: (string) Shell path or empty string

**Behavior**:
1. Mounts image filesystem
2. Scans for executable shells
3. Unmounts image in finally block

**Implementation**:
```javascript
function detectShellViaImageMount(image) {
    if (containerRuntime !== 'podman') return '';
    let mountPoint = '';
    try {
        const mountRes = spawnSync(containerRuntime, ['image', 'mount', image], { stdio: ['ignore', 'pipe', 'pipe'] });
        if (mountRes.status !== 0) return '';
        mountPoint = normalizeMountPath(mountRes.stdout || mountRes.stderr);
        if (!mountPoint) return '';
        const shellPath = findShellInMount(mountPoint);
        return shellPath;
    } finally {
        if (mountPoint) {
            try { spawnSync(containerRuntime, ['image', 'unmount', mountPoint], { stdio: 'ignore' }); } catch (_) {}
        }
    }
}
```

### detectShellViaContainerRun(image)

**Purpose**: Detects shell by running test containers (Docker/Podman)

**Parameters**:
- `image` (string): Image name/tag

**Returns**: (string) Shell path or empty string

**Behavior**:
- Runs `test -x /bin/shell` for each candidate
- Returns first shell that exists and is executable

**Implementation**:
```javascript
function detectShellViaContainerRun(image) {
    for (const shellPath of SHELL_PROBE_PATHS) {
        const res = spawnSync(containerRuntime, ['run', '--rm', image, 'test', '-x', shellPath], { stdio: 'ignore' });
        if (res.status === 0) {
            return shellPath;
        }
    }
    return '';
}
```

## Public API

### detectShellForImage(agentName, image)

**Purpose**: Detects the best available shell for an image

**Parameters**:
- `agentName` (string): Agent name for error messages
- `image` (string): Container image name/tag

**Returns**: (string|Symbol) Shell path or `SHELL_FALLBACK_DIRECT`

**Caching**: Results are cached per image

**Detection Order**:
1. Check cache
2. Try Podman image mount (faster, no container)
3. Try container-based probing
4. Return Symbol if no shell found

**Implementation**:
```javascript
function detectShellForImage(agentName, image) {
    if (!agentName || !image) {
        throw new Error('[start] Missing agent or image for shell detection.');
    }
    if (shellDetectionCache.has(image)) {
        return shellDetectionCache.get(image);
    }
    const fromMount = detectShellViaImageMount(image);
    const shellPath = fromMount || detectShellViaContainerRun(image);
    const finalShell = shellPath || SHELL_FALLBACK_DIRECT;
    shellDetectionCache.set(image, finalShell);
    return finalShell;
}
```

## Exports

```javascript
export {
    SHELL_FALLBACK_DIRECT,
    detectShellForImage
};
```

## Shell Priority Order

1. `/bin/bash` - Full-featured Bash
2. `/bin/sh` - POSIX shell
3. `/bin/ash` - Alpine shell
4. `/bin/dash` - Debian default
5. `/bin/zsh` - Z shell
6. `/bin/fish` - Friendly interactive shell
7. `/bin/ksh` - Korn shell

## Detection Methods

### Podman Image Mount (Fast)

```
podman image mount <image>
# Returns: /path/to/mounted/filesystem
# Check: stat /path/bin/bash
podman image unmount /path
```

**Advantages**:
- No container creation
- Fast filesystem access
- Works offline

### Container Probe (Universal)

```
docker/podman run --rm <image> test -x /bin/bash
# Exit 0 = shell exists
# Exit 1 = shell not found
```

**Advantages**:
- Works with Docker and Podman
- Handles remote images
- Respects image entrypoint

## Usage Example

```javascript
import { detectShellForImage, SHELL_FALLBACK_DIRECT } from './shellDetection.js';

const shell = detectShellForImage('node-dev', 'node:18-alpine');

if (shell === SHELL_FALLBACK_DIRECT) {
    // Image has no shell; run command directly
    console.log('No shell available, running directly');
} else {
    // Use detected shell
    console.log('Using shell:', shell); // e.g., '/bin/ash'
}
```

## Related Modules

- [docker-common.md](./docker-common.md) - Container runtime detection
- [docker-agent-service-manager.md](./docker-agent-service-manager.md) - Uses shell detection
