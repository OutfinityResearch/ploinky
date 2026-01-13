# cli/commands/profileCommands.js - Profile Commands

## Overview

Handles profile management commands for the Ploinky CLI. Provides functionality to view, set, list, and validate profiles (dev, qa, prod) that control container mount modes and environment settings.

## Source File

`cli/commands/profileCommands.js`

## Dependencies

```javascript
import {
    getActiveProfile,
    setActiveProfile,
    validateProfile,
    listProfiles,
    getValidProfiles,
    getDefaultMountModes,
    getProfileConfig
} from '../services/profileService.js';
import { loadAgents } from '../services/workspace.js';
import { colorize } from '../services/utils.js';
```

## Public API

### handleProfileCommand(args)

**Purpose**: Main entry point for profile command handling

**Parameters**:
- `args` (string[]): Command arguments

**Subcommands**:

| Subcommand | Description |
|------------|-------------|
| `list [agent]` | List available profiles |
| `validate <profile> [agent]` | Validate profile configuration |
| `show` / `current` | Show current active profile |
| `<profileName>` | Set active profile (dev/qa/prod) |
| (none) | Show current profile |

**Implementation**:
```javascript
export async function handleProfileCommand(args) {
    const subCommand = args[0]?.toLowerCase();

    switch (subCommand) {
        case 'list':
            return handleListProfiles(args.slice(1));
        case 'validate':
            return handleValidateProfile(args.slice(1));
        case 'show':
        case 'current':
            return showCurrentProfile();
        case undefined:
        case '':
            return showCurrentProfile();
        default:
            // If it's a valid profile name, set it
            if (getValidProfiles().includes(subCommand)) {
                return handleSetProfile(subCommand);
            }
            // Otherwise, show usage
            console.log('Usage: ploinky profile [<profileName>|list|validate|show]');
            console.log('');
            console.log('Commands:');
            console.log('  ploinky profile <name>        Set active profile (dev, qa, prod)');
            console.log('  ploinky profile show          Show current profile');
            console.log('  ploinky profile list [agent]  List available profiles');
            console.log('  ploinky profile validate <profile> [agent]  Validate profile config');
            return;
    }
}
```

## Internal Functions

### handleSetProfile(profileName)

**Purpose**: Sets the active profile

**Parameters**:
- `profileName` (string): Profile name to set (dev/qa/prod)

**Behavior**:
- Calls `setActiveProfile()` service function
- Displays success/failure message with color coding
- Shows profile settings (environment, mount modes)
- Warns about read-only mounts in qa/prod profiles

**Implementation**:
```javascript
function handleSetProfile(profileName) {
    const result = setActiveProfile(profileName);

    if (result.success) {
        console.log(colorize(`✓ ${result.message}`, 'green'));

        // Show profile details
        const profile = profileName.toLowerCase();
        const mountModes = getDefaultMountModes(profile);

        console.log('');
        console.log('Profile settings:');
        console.log(`  Environment: ${getProfileEnvironmentLabel(profile)}`);
        console.log(`  Code mount:  ${mountModes.code === 'rw' ? colorize('read-write', 'yellow') : colorize('read-only', 'cyan')}`);
        console.log(`  Skills mount: ${mountModes.skills === 'rw' ? colorize('read-write', 'yellow') : colorize('read-only', 'cyan')}`);

        if (profile !== 'dev') {
            console.log('');
            console.log(colorize('Note:', 'yellow'), 'In qa/prod profiles, code and skills are read-only.');
            console.log('       Restart running agents to apply the new profile.');
        }
    } else {
        console.error(colorize(`✗ ${result.message}`, 'red'));
    }
}
```

### showCurrentProfile()

**Purpose**: Displays the current active profile and its settings

**Output**:
- Current profile name
- Environment type
- Code mount mode (read-write/read-only)
- Skills mount mode (read-write/read-only)
- List of valid profiles
- Instructions to change profile

**Implementation**:
```javascript
function showCurrentProfile() {
    const profile = getActiveProfile();
    const mountModes = getDefaultMountModes(profile);

    console.log(`Current profile: ${colorize(profile, 'cyan')}`);
    console.log('');
    console.log('Settings:');
    console.log(`  Environment: ${getProfileEnvironmentLabel(profile)}`);
    console.log(`  Code mount:  ${mountModes.code === 'rw' ? 'read-write' : 'read-only'}`);
    console.log(`  Skills mount: ${mountModes.skills === 'rw' ? 'read-write' : 'read-only'}`);
    console.log('');
    console.log('Valid profiles:', getValidProfiles().join(', '));
    console.log('');
    console.log('To change profile: ploinky profile <dev|qa|prod>');
}
```

### handleListProfiles(args)

**Purpose**: Lists available profiles, optionally for a specific agent

**Parameters**:
- `args` (string[]): Optional agent name as first argument

**Behavior**:
- If agent specified: Shows profiles defined for that agent
- If no agent: Shows global profile and all enabled agents with their profile support

**Implementation**:
```javascript
function handleListProfiles(args) {
    const agentName = args[0];

    if (agentName) {
        // List profiles for a specific agent
        const { profiles, defaultProfile } = listProfiles(agentName);

        if (profiles.length === 0) {
            console.log(`Agent '${agentName}' has no defined profiles.`);
            console.log('Using global profiles: dev, qa, prod');
            return;
        }

        console.log(`Profiles for ${colorize(agentName, 'cyan')}:`);
        console.log('');
        for (const profile of profiles) {
            const isDefault = profile === defaultProfile;
            const prefix = isDefault ? colorize('*', 'green') : ' ';
            console.log(`  ${prefix} ${profile}${isDefault ? ' (default)' : ''}`);
        }
    } else {
        // List all agents with their profiles
        const currentProfile = getActiveProfile();
        console.log(`Global profile: ${colorize(currentProfile, 'cyan')}`);
        console.log('');
        console.log('Valid profiles:');
        for (const profile of getValidProfiles()) {
            const isCurrent = profile === currentProfile;
            const prefix = isCurrent ? colorize('*', 'green') : ' ';
            console.log(`  ${prefix} ${profile}${isCurrent ? ' (active)' : ''}`);
        }

        // Show agents and their profile support
        const agents = loadAgents();
        const agentEntries = Object.entries(agents || {})
            .filter(([key, value]) => key !== '_config' && value && value.type === 'agent');

        if (agentEntries.length > 0) {
            console.log('');
            console.log('Enabled agents:');
            for (const [containerName, record] of agentEntries) {
                const agentName = record.agentName;
                const agentProfile = record.profile || 'dev';
                const { profiles } = listProfiles(`${record.repoName}/${agentName}`);
                const profileInfo = profiles.length > 0
                    ? `profiles: ${profiles.join(', ')}`
                    : 'uses global profiles';
                console.log(`  ${colorize(agentName, 'cyan')} (${agentProfile}) - ${profileInfo}`);
            }
        }
    }
}
```

### handleValidateProfile(args)

**Purpose**: Validates profile configuration for an agent or globally

**Parameters**:
- `args` (string[]): [profileName, agentName?]

**Behavior**:
- If both profile and agent specified: Validates profile for specific agent
- If only profile specified: Validates profile name and checks all enabled agents

**Implementation**:
```javascript
function handleValidateProfile(args) {
    const profileName = args[0];
    const agentName = args[1];

    if (!profileName) {
        console.error('Usage: ploinky profile validate <profileName> [agentName]');
        return;
    }

    if (agentName) {
        // Validate profile for a specific agent
        const result = validateProfile(agentName, profileName);

        console.log(`Validating profile '${profileName}' for agent '${agentName}':`);
        console.log('');

        if (result.valid) {
            console.log(colorize('✓ Profile is valid', 'green'));
            if (result.config) {
                showProfileConfigSummary(result.config);
            }
        } else {
            console.log(colorize('✗ Profile has issues:', 'red'));
            for (const issue of result.issues) {
                console.log(`  - ${issue}`);
            }
        }
    } else {
        // Validate the profile name itself
        if (!getValidProfiles().includes(profileName.toLowerCase())) {
            console.log(colorize(`✗ Invalid profile name: ${profileName}`, 'red'));
            console.log(`Valid profiles are: ${getValidProfiles().join(', ')}`);
            return;
        }

        console.log(colorize(`✓ '${profileName}' is a valid profile name`, 'green'));

        // Validate all enabled agents
        const agents = loadAgents();
        const agentEntries = Object.entries(agents || {})
            .filter(([key, value]) => key !== '_config' && value && value.type === 'agent');

        if (agentEntries.length > 0) {
            console.log('');
            console.log('Validating against enabled agents:');
            for (const [containerName, record] of agentEntries) {
                const agentRef = `${record.repoName}/${record.agentName}`;
                const result = validateProfile(agentRef, profileName);
                const status = result.valid
                    ? colorize('✓', 'green')
                    : colorize('✗', 'red');
                console.log(`  ${status} ${record.agentName}`);
                if (!result.valid && result.issues.length > 0) {
                    for (const issue of result.issues) {
                        console.log(`      ${issue}`);
                    }
                }
            }
        }
    }
}
```

### showProfileConfigSummary(config)

**Purpose**: Displays summary of profile configuration

**Parameters**:
- `config` (Object): Profile configuration object

**Shows**:
- Number of environment variables
- Required secrets
- Mount modes (code/skills)
- Defined hooks

**Implementation**:
```javascript
function showProfileConfigSummary(config) {
    console.log('');
    console.log('Configuration:');

    if (config.env) {
        console.log(`  Environment variables: ${Object.keys(config.env).length}`);
    }

    if (config.secrets && config.secrets.length > 0) {
        console.log(`  Required secrets: ${config.secrets.join(', ')}`);
    }

    if (config.mounts) {
        console.log(`  Mount modes: code=${config.mounts.code || 'default'}, skills=${config.mounts.skills || 'default'}`);
    }

    const hooks = ['hosthook_aftercreation', 'preinstall', 'install', 'postinstall', 'hosthook_postinstall']
        .filter(h => config[h]);
    if (hooks.length > 0) {
        console.log(`  Hooks: ${hooks.join(', ')}`);
    }
}
```

### getProfileEnvironmentLabel(profile)

**Purpose**: Gets human-readable environment label with color

**Parameters**:
- `profile` (string): Profile name

**Returns**: (string) Colored label

**Labels**:
| Profile | Label | Color |
|---------|-------|-------|
| dev | Development | green |
| qa | QA/Testing | yellow |
| prod | Production | red |

**Implementation**:
```javascript
function getProfileEnvironmentLabel(profile) {
    const labels = {
        'dev': colorize('Development', 'green'),
        'qa': colorize('QA/Testing', 'yellow'),
        'prod': colorize('Production', 'red')
    };
    return labels[profile] || profile;
}
```

## Exports

```javascript
export { handleProfileCommand, handleSetProfile, showCurrentProfile, handleListProfiles, handleValidateProfile };
```

## Usage Example

```javascript
import { handleProfileCommand } from './profileCommands.js';

// Show current profile
await handleProfileCommand([]);

// Set profile to qa
await handleProfileCommand(['qa']);

// List all profiles
await handleProfileCommand(['list']);

// List profiles for specific agent
await handleProfileCommand(['list', 'node-dev']);

// Validate profile
await handleProfileCommand(['validate', 'prod', 'node-dev']);
```

## Profile Mount Modes

| Profile | Code Mount | Skills Mount |
|---------|------------|--------------|
| dev | read-write | read-write |
| qa | read-only | read-only |
| prod | read-only | read-only |

## Related Modules

- [service-profile.md](../services/utils/service-profile.md) - Profile service
- [service-workspace.md](../services/workspace/service-workspace.md) - Agent loading
- [service-utils.md](../services/utils/service-utils.md) - Colorize utility
