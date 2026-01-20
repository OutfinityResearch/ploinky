import fs from 'fs';
import path from 'path';
import { PROFILE_FILE, PLOINKY_DIR, REPOS_DIR } from './config.js';
import { validateSecrets } from './secretInjector.js';
import { debugLog, findAgent } from './utils.js';

// Valid profile names (default is always applied as base)
const VALID_PROFILES = ['default', 'dev', 'qa', 'prod'];

// Hook names in execution order
const HOOK_NAMES = ['hosthook_aftercreation', 'preinstall', 'install', 'postinstall', 'hosthook_postinstall'];

/**
 * Merge default profile with active profile.
 * - Env variables: deep merge (active overrides default)
 * - Hooks: active overrides default (not concatenate)
 * - Secrets: concatenate (active adds to default)
 * - Mounts: deep merge (active overrides default)
 *
 * @param {object} defaultProfile - The default profile configuration
 * @param {object} activeProfile - The active profile configuration
 * @returns {object} Merged profile configuration
 */
export function mergeProfiles(defaultProfile, activeProfile) {
    if (!defaultProfile) return activeProfile || {};
    if (!activeProfile || activeProfile === defaultProfile) return defaultProfile;

    const merged = { ...defaultProfile };

    // Merge env (deep merge - active overrides default)
    if (activeProfile.env) {
        merged.env = { ...defaultProfile.env, ...activeProfile.env };
    }

    // Hooks: active overrides default
    for (const hook of HOOK_NAMES) {
        if (activeProfile[hook] !== undefined) {
            merged[hook] = activeProfile[hook];
        }
    }

    // Merge array fields by concatenation (secrets)
    if (activeProfile.secrets || defaultProfile.secrets) {
        merged.secrets = [...(defaultProfile.secrets || []), ...(activeProfile.secrets || [])];
    }

    // Merge object fields (active overrides default) - mounts
    if (activeProfile.mounts) {
        merged.mounts = { ...defaultProfile.mounts, ...activeProfile.mounts };
    }

    return merged;
}

/**
 * Get the currently active profile.
 * @returns {string} The active profile name (defaults to 'dev')
 */
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

/**
 * Set the active profile.
 * @param {string} profileName - The profile name to set
 * @returns {{ success: boolean, message: string }}
 */
export function setActiveProfile(profileName) {
    const normalizedProfile = profileName.toLowerCase().trim();

    if (!VALID_PROFILES.includes(normalizedProfile)) {
        return {
            success: false,
            message: `Invalid profile '${profileName}'. Valid profiles are: ${VALID_PROFILES.join(', ')}`
        };
    }

    try {
        // Ensure .ploinky directory exists
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

/**
 * Get profile configuration from an agent's manifest.
 * Always merges the default profile with the requested profile.
 *
 * @param {string} agentName - The agent name
 * @param {string} profileName - The profile name (defaults to active profile)
 * @returns {object|null} The merged profile configuration or null
 */
export function getProfileConfig(agentName, profileName) {
    try {
        const { manifestPath } = findAgent(agentName);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const profiles = manifest?.profiles || {};

        // Every agent MUST have a default profile for isolation
        const defaultProfile = profiles.default;
        if (!defaultProfile) {
            throw new Error(`Agent ${agentName} missing required 'default' profile in manifest.json`);
        }

        // Get active profile name
        const activeProfileName = profileName || getActiveProfile();

        // If requesting default or no active profile config exists, return default
        if (activeProfileName === 'default' || !profiles[activeProfileName]) {
            return defaultProfile;
        }

        // Merge default with active profile (active overrides default)
        const activeProfile = profiles[activeProfileName];
        return mergeProfiles(defaultProfile, activeProfile);
    } catch (err) {
        debugLog(`getProfileConfig: ${err.message}`);
        // Re-throw missing profile errors so they bubble up
        if (err.message.includes('missing required')) {
            throw err;
        }
        return null;
    }
}

/**
 * Validate a profile configuration for an agent.
 * Uses merged profile (default + requested profile).
 *
 * @param {string} agentName - The agent name
 * @param {string} profileName - The profile name
 * @returns {{ valid: boolean, issues: string[], config: object|null }}
 */
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

        // Mandatory: every agent must have a 'default' profile
        if (!manifest.profiles.default) {
            issues.push(`Agent missing required 'default' profile in manifest.json`);
            return { valid: false, issues, config: null };
        }

        // Get merged profile configuration
        config = getProfileConfig(agentName, profileName);

        if (!config) {
            issues.push(`Could not resolve profile configuration for '${profileName}'`);
            return { valid: false, issues, config: null };
        }

        // Validate required secrets
        if (config.secrets && Array.isArray(config.secrets)) {
            const secretValidation = validateSecrets(config.secrets);
            for (const secretName of secretValidation.missing) {
                issues.push(`Missing required secret: ${secretName}`);
            }
        }

        // Validate hook scripts exist (only host hooks need file validation)
        const hostHookFields = ['hosthook_aftercreation', 'hosthook_postinstall'];
        for (const hookField of hostHookFields) {
            if (config[hookField]) {
                const agentPath = path.dirname(manifestPath);
                const hookPath = path.join(agentPath, config[hookField]);
                if (!fs.existsSync(hookPath)) {
                    issues.push(`Host hook script not found: ${config[hookField]}`);
                }
            }
        }

        // Validate hook format (must be string, not array)
        for (const hookName of HOOK_NAMES) {
            if (config[hookName] !== undefined && typeof config[hookName] !== 'string') {
                issues.push(`Hook '${hookName}' must be a string command, not ${typeof config[hookName]}`);
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

/**
 * List available profiles for an agent.
 * @param {string} agentName - The agent name
 * @returns {{ profiles: string[], defaultProfile: string|null }}
 */
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

/**
 * Get default mount modes based on profile.
 * @param {string} profile - The profile name
 * @returns {{ code: string, skills: string }}
 */
export function getDefaultMountModes(profile) {
    if (profile === 'dev') {
        return { code: 'rw', skills: 'rw' };
    }
    // qa and prod default to read-only
    return { code: 'ro', skills: 'ro' };
}

/**
 * Get profile environment based on profile name.
 * @param {string} profile - The profile name
 * @returns {string} Environment identifier
 */
export function getProfileEnvironment(profile) {
    const envMap = {
        'default': 'development',
        'dev': 'development',
        'qa': 'qa',
        'prod': 'production'
    };
    return envMap[profile] || 'development';
}

/**
 * Get all profile-related environment variables.
 * @param {string} agentName - The agent name
 * @param {string} repoName - The repository name
 * @param {string} profile - The profile name
 * @param {object} containerInfo - Container information
 * @returns {object} Environment variables map
 */
export function getProfileEnvVars(agentName, repoName, profile, containerInfo = {}) {
    return {
        PLOINKY_PROFILE: profile,
        PLOINKY_PROFILE_ENV: getProfileEnvironment(profile),
        PLOINKY_AGENT_NAME: agentName,
        PLOINKY_REPO_NAME: repoName,
        PLOINKY_CWD: process.cwd(),
        ...(containerInfo.containerName && { PLOINKY_CONTAINER_NAME: containerInfo.containerName }),
        ...(containerInfo.containerId && { PLOINKY_CONTAINER_ID: containerInfo.containerId })
    };
}

/**
 * Get the list of valid profiles.
 * @returns {string[]} Array of valid profile names
 */
export function getValidProfiles() {
    return [...VALID_PROFILES];
}

/**
 * Get the list of hook names in execution order.
 * @returns {string[]} Array of hook names
 */
export function getHookNames() {
    return [...HOOK_NAMES];
}
