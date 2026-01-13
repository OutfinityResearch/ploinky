# cli/services/profileService.js - Profile Service

## Overview

Manages the profile system for Ploinky agents. Profiles (dev, qa, prod) control container mount modes, environment settings, and deployment configurations.

## Source File

`cli/services/profileService.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { PROFILE_FILE, PLOINKY_DIR, REPOS_DIR } from './config.js';
import { debugLog, findAgent } from './utils.js';
```

## Constants

```javascript
const VALID_PROFILES = ['dev', 'qa', 'prod'];
```

## Public API

### getActiveProfile()

**Purpose**: Gets the currently active profile

**Returns**: (string) Profile name (defaults to 'dev')

**Storage**: `.ploinky/profile`

**Implementation**:
```javascript
export function getActiveProfile() {
    try {
        if (fs.existsSync(PROFILE_FILE)) {
            const profile = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
            if (profile && VALID_PROFILES.includes(profile)) {
                return profile;
            }
        }
    } catch (_) {}
    return 'dev';
}
```

### setActiveProfile(profileName)

**Purpose**: Sets the active profile

**Parameters**:
- `profileName` (string): Profile to set

**Returns**: `{ success: boolean, message: string }`

**Implementation**:
```javascript
export function setActiveProfile(profileName) {
    const normalizedProfile = profileName.toLowerCase().trim();

    if (!VALID_PROFILES.includes(normalizedProfile)) {
        return {
            success: false,
            message: `Invalid profile '${profileName}'. Valid profiles are: ${VALID_PROFILES.join(', ')}`
        };
    }

    try {
        if (!fs.existsSync(PLOINKY_DIR)) {
            fs.mkdirSync(PLOINKY_DIR, { recursive: true });
        }

        fs.writeFileSync(PROFILE_FILE, normalizedProfile);
        return {
            success: true,
            message: `Profile set to '${normalizedProfile}'`
        };
    } catch (err) {
        return {
            success: false,
            message: `Failed to set profile: ${err.message}`
        };
    }
}
```

### getProfileConfig(agentName, profileName)

**Purpose**: Gets profile configuration from agent's manifest

**Parameters**:
- `agentName` (string): Agent name or `repo/agent`
- `profileName` (string): Profile name

**Returns**: (Object|null) Profile configuration or null

**Implementation**:
```javascript
export function getProfileConfig(agentName, profileName) {
    try {
        const { manifestPath } = findAgent(agentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        if (!manifest.profiles || !manifest.profiles[profileName]) {
            return null;
        }

        return manifest.profiles[profileName];
    } catch (err) {
        debugLog(`getProfileConfig: ${err.message}`);
        return null;
    }
}
```

### validateProfile(agentName, profileName)

**Purpose**: Validates profile configuration for an agent

**Parameters**:
- `agentName` (string): Agent name
- `profileName` (string): Profile name

**Returns**:
```javascript
{
    valid: boolean,
    issues: string[],
    config: Object|null
}
```

**Validation Checks**:
1. Manifest has profiles section
2. Profile exists in manifest
3. Required secrets are present in environment
4. Host hook scripts exist
5. Mount modes are valid (rw/ro)

**Implementation**:
```javascript
export function validateProfile(agentName, profileName) {
    const issues = [];
    let config = null;

    try {
        const { manifestPath } = findAgent(agentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        if (!manifest.profiles) {
            issues.push('Manifest has no profiles section');
            return { valid: false, issues, config: null };
        }

        if (!manifest.profiles[profileName]) {
            const availableProfiles = Object.keys(manifest.profiles);
            issues.push(`Profile '${profileName}' not found. Available: ${availableProfiles.join(', ')}`);
            return { valid: false, issues, config: null };
        }

        config = manifest.profiles[profileName];

        // Validate required secrets
        if (config.secrets && Array.isArray(config.secrets)) {
            for (const secretName of config.secrets) {
                const secretValue = process.env[secretName];
                if (!secretValue) {
                    issues.push(`Missing required secret: ${secretName}`);
                }
            }
        }

        // Validate hook scripts exist
        const hookFields = ['hosthook_aftercreation', 'hosthook_postinstall'];
        for (const hookField of hookFields) {
            if (config[hookField]) {
                const agentPath = path.dirname(manifestPath);
                const hookPath = path.join(agentPath, config[hookField]);
                if (!fs.existsSync(hookPath)) {
                    issues.push(`Host hook script not found: ${config[hookField]}`);
                }
            }
        }

        // Check mounts configuration
        if (config.mounts) {
            const validMountModes = ['rw', 'ro'];
            if (config.mounts.code && !validMountModes.includes(config.mounts.code)) {
                issues.push(`Invalid mount mode for code: ${config.mounts.code}`);
            }
            if (config.mounts.skills && !validMountModes.includes(config.mounts.skills)) {
                issues.push(`Invalid mount mode for skills: ${config.mounts.skills}`);
            }
        }

        return {
            valid: issues.length === 0,
            issues,
            config
        };
    } catch (err) {
        issues.push(`Validation error: ${err.message}`);
        return { valid: false, issues, config: null };
    }
}
```

### listProfiles(agentName)

**Purpose**: Lists available profiles for an agent

**Parameters**:
- `agentName` (string): Agent name

**Returns**: `{ profiles: string[], defaultProfile: string|null }`

**Implementation**:
```javascript
export function listProfiles(agentName) {
    try {
        const { manifestPath } = findAgent(agentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const profiles = manifest.profiles ? Object.keys(manifest.profiles) : [];
        const defaultProfile = manifest.defaultProfile || (profiles.includes('dev') ? 'dev' : profiles[0] || null);

        return { profiles, defaultProfile };
    } catch (err) {
        debugLog(`listProfiles: ${err.message}`);
        return { profiles: [], defaultProfile: null };
    }
}
```

### getDefaultMountModes(profile)

**Purpose**: Gets default mount modes for a profile

**Parameters**:
- `profile` (string): Profile name

**Returns**: `{ code: string, skills: string }`

**Mount Modes by Profile**:

| Profile | Code | Skills |
|---------|------|--------|
| dev | rw | rw |
| qa | ro | ro |
| prod | ro | ro |

**Implementation**:
```javascript
export function getDefaultMountModes(profile) {
    if (profile === 'dev') {
        return { code: 'rw', skills: 'rw' };
    }
    // qa and prod default to read-only
    return { code: 'ro', skills: 'ro' };
}
```

### getProfileEnvironment(profile)

**Purpose**: Gets environment identifier for profile

**Parameters**:
- `profile` (string): Profile name

**Returns**: (string) Environment identifier

**Mapping**:
| Profile | Environment |
|---------|-------------|
| dev | development |
| qa | qa |
| prod | production |

### getProfileEnvVars(agentName, repoName, profile, containerInfo)

**Purpose**: Gets all profile-related environment variables

**Parameters**:
- `agentName` (string): Agent name
- `repoName` (string): Repository name
- `profile` (string): Profile name
- `containerInfo` (Object): Container information

**Returns**: (Object) Environment variables map

**Variables**:
- `PLOINKY_PROFILE` - Active profile
- `PLOINKY_PROFILE_ENV` - Environment identifier
- `PLOINKY_AGENT_NAME` - Agent name
- `PLOINKY_REPO_NAME` - Repository name
- `PLOINKY_CWD` - Current working directory
- `PLOINKY_CONTAINER_NAME` - Container name (if provided)
- `PLOINKY_CONTAINER_ID` - Container ID (if provided)

### getValidProfiles()

**Purpose**: Gets list of valid profile names

**Returns**: (string[]) `['dev', 'qa', 'prod']`

## Manifest Profile Configuration

```json
{
    "profiles": {
        "dev": {
            "env": {
                "DEBUG": "true",
                "LOG_LEVEL": "debug"
            },
            "mounts": {
                "code": "rw",
                "skills": "rw"
            }
        },
        "qa": {
            "env": {
                "LOG_LEVEL": "info"
            },
            "secrets": ["QA_API_KEY"],
            "mounts": {
                "code": "ro",
                "skills": "ro"
            }
        },
        "prod": {
            "env": {
                "LOG_LEVEL": "warn"
            },
            "secrets": ["PROD_API_KEY", "PROD_DB_PASSWORD"],
            "mounts": {
                "code": "ro",
                "skills": "ro"
            },
            "hosthook_postinstall": "scripts/prod-setup.sh"
        }
    },
    "defaultProfile": "dev"
}
```

## Usage Example

```javascript
import {
    getActiveProfile,
    setActiveProfile,
    getDefaultMountModes,
    validateProfile,
    getProfileEnvVars
} from './profileService.js';

// Get current profile
const current = getActiveProfile();
console.log('Current profile:', current); // 'dev'

// Set profile
const result = setActiveProfile('qa');
if (result.success) {
    console.log(result.message);
}

// Get mount modes
const mounts = getDefaultMountModes('prod');
console.log(mounts); // { code: 'ro', skills: 'ro' }

// Validate profile for agent
const validation = validateProfile('basic/node-dev', 'prod');
if (!validation.valid) {
    console.error('Issues:', validation.issues);
}

// Get environment variables
const envVars = getProfileEnvVars('node-dev', 'basic', 'prod', {
    containerName: 'ploinky_basic_node-dev_proj_abc'
});
```

## Related Modules

- [commands-profile.md](../../commands/commands-profile.md) - Profile CLI commands
- [service-config.md](../config/service-config.md) - PROFILE_FILE constant
- [docker-agent-service-manager.md](../docker/docker-agent-service-manager.md) - Uses profile mounts
