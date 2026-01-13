# DS08 - Profile System

## Summary

The Profile System enables environment-specific behavior (dev, qa, prod) for Ploinky agents with dedicated lifecycle hooks, secure secret injection, and profile-specific configuration. This specification defines profiles, their configuration, and the extended lifecycle they enable.

## Background / Problem Statement

Agents need different configurations for different environments:
- Development: Read-write access, debug logging, local secrets
- QA/Testing: Read-only code, test credentials, integration testing
- Production: Immutable code, production secrets, minimal logging

## Goals

1. **Profile Switching**: Command to switch between dev/qa/prod profiles
2. **Secret Injection**: Secure injection from GitHub Actions or local files
3. **Lifecycle Hooks**: Profile-specific pre/post install scripts
4. **Mount Modes**: Profile-dependent read/write permissions

## Non-Goals

- Profile inheritance (future enhancement)
- Remote secret stores (future enhancement)
- Profile templates

## Architecture Overview

### Profile-Aware Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Profile Lifecycle Execution                       │
└─────────────────────────────────────────────────────────────────────┘

1. Workspace Structure Init [HOST]
   └─→ Ensure: .ploinky/, agents/, code/, skills/
   └─→ Create: $CWD/agents/<agentName>/

2. Symbolic Links Creation [HOST]
   └─→ code symlink: $CWD/code/<agent> -> .ploinky/repos/.../code/
   └─→ skills symlink: $CWD/skills/<agent> -> .ploinky/repos/.../.AchillesSkills/

3. Container Creation
   └─→ docker create with profile-specific mounts

4. hosthook_aftercreation [HOST]
   └─→ Execute: scripts/<profile>_aftercreation.sh

5. Container Start
   └─→ docker start <container>

6. Core Dependencies Installation [CONTAINER]
   └─→ Copy package.base.json → /agent/package.json
   └─→ npm install (core deps)

7. Agent Dependencies Installation [CONTAINER]
   └─→ Merge /code/package.json dependencies
   └─→ npm install (agent deps)

8. preinstall [CONTAINER]
   └─→ Execute: scripts/<profile>_preinstall.sh

9. install [CONTAINER]
   └─→ Execute: scripts/<profile>_install.sh

10. postinstall [CONTAINER]
    └─→ Execute: scripts/<profile>_postinstall.sh

11. hosthook_postinstall [HOST]
    └─→ Execute: scripts/<profile>_host_postinstall.sh

12. Agent Ready
    └─→ AgentServer starts accepting requests
```

## Data Models

### Profile Configuration

```javascript
/**
 * @typedef {Object} ProfileConfig
 * @property {string} [hosthook_aftercreation] - Host hook after container creation
 * @property {string|string[]} [preinstall] - Container preinstall commands
 * @property {string|string[]} [install] - Container install commands
 * @property {string|string[]} [postinstall] - Container postinstall commands
 * @property {string} [hosthook_postinstall] - Host hook after postinstall
 * @property {Object.<string, string>} [env] - Profile-specific environment
 * @property {string[]} [secrets] - Required secrets list
 * @property {MountConfig} [mounts] - Profile-specific mount modes
 * @property {Object} [dependencies] - Profile-specific npm dependencies
 */

/**
 * @typedef {Object} MountConfig
 * @property {string} code - Mount mode for /code ("rw" | "ro")
 * @property {string} skills - Mount mode for /.AchillesSkills ("rw" | "ro")
 */
```

### Default Mount Modes by Profile

| Profile | `/code` | `/.AchillesSkills` | Rationale |
|---------|---------|---------------------|-----------|
| `dev` | **rw** | **rw** | Developers need to edit code and skills |
| `qa` | **ro** | **ro** | Testing should not modify source |
| `prod` | **ro** | **ro** | Production must be immutable |

## API Contracts

### Profile Service

```javascript
// cli/services/profileService.js

/**
 * Get the currently active profile
 * @returns {string} Profile name (dev, qa, prod)
 */
export function getActiveProfile() {
  const profilePath = path.join(WORKSPACE_ROOT, '.ploinky', 'profile');

  if (!fs.existsSync(profilePath)) {
    return 'dev'; // Default profile
  }

  return fs.readFileSync(profilePath, 'utf-8').trim();
}

/**
 * Set the active profile
 * @param {string} profileName - Profile to activate
 * @returns {Promise<void>}
 */
export async function setActiveProfile(profileName) {
  const validProfiles = ['dev', 'qa', 'prod'];

  if (!validProfiles.includes(profileName)) {
    throw new Error(`Invalid profile '${profileName}'. Valid profiles: ${validProfiles.join(', ')}`);
  }

  const profilePath = path.join(WORKSPACE_ROOT, '.ploinky', 'profile');
  await fs.promises.writeFile(profilePath, profileName);

  console.log(`Profile set to: ${profileName}`);
}

/**
 * Get profile configuration from manifest
 * @param {string} agentName - Agent name
 * @param {string} profileName - Profile name
 * @returns {ProfileConfig} Profile configuration
 */
export function getProfileConfig(agentName, profileName) {
  const manifest = loadManifest(agentName);

  // Check if profiles defined
  if (!manifest.profiles || !manifest.profiles[profileName]) {
    // Return default configuration
    return getDefaultProfileConfig(profileName);
  }

  return manifest.profiles[profileName];
}

/**
 * Get default profile configuration
 * @param {string} profileName - Profile name
 * @returns {ProfileConfig}
 */
function getDefaultProfileConfig(profileName) {
  const defaults = {
    dev: {
      env: { NODE_ENV: 'development', DEBUG: 'true' },
      mounts: { code: 'rw', skills: 'rw' }
    },
    qa: {
      env: { NODE_ENV: 'test', DEBUG: 'false' },
      mounts: { code: 'ro', skills: 'ro' }
    },
    prod: {
      env: { NODE_ENV: 'production', DEBUG: 'false' },
      mounts: { code: 'ro', skills: 'ro' }
    }
  };

  return defaults[profileName] || defaults.dev;
}

/**
 * Validate profile configuration
 * @param {string} agentName - Agent name
 * @param {string} profileName - Profile name
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProfile(agentName, profileName) {
  const errors = [];
  const config = getProfileConfig(agentName, profileName);

  // Validate secrets
  if (config.secrets) {
    const { missing } = validateSecrets(config.secrets);
    if (missing.length > 0) {
      errors.push(`Missing secrets: ${missing.join(', ')}`);
    }
  }

  // Validate scripts exist
  const scripts = ['preinstall', 'install', 'postinstall'];
  for (const script of scripts) {
    if (config[script]) {
      const scriptPath = resolveScriptPath(agentName, config[script]);
      if (!fs.existsSync(scriptPath)) {
        errors.push(`Script not found: ${config[script]}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * List available profiles for an agent
 * @param {string} agentName - Agent name
 * @returns {string[]} Available profile names
 */
export function listProfiles(agentName) {
  const manifest = loadManifest(agentName);

  if (manifest.profiles) {
    return Object.keys(manifest.profiles);
  }

  return ['dev', 'qa', 'prod']; // Default profiles
}
```

### Secret Injector

```javascript
// cli/services/secretInjector.js

/**
 * Secret sources in priority order
 */
const SECRET_SOURCES = [
  'environment',      // Environment variables
  '.ploinky/.secrets', // Local secrets file
  '.env'              // .env file
];

/**
 * Validate all required secrets are available
 * @param {string[]} requiredSecrets - List of secret names
 * @returns {{valid: boolean, missing: string[]}}
 */
export function validateSecrets(requiredSecrets) {
  const missing = [];

  for (const secretName of requiredSecrets) {
    const value = getSecret(secretName);
    if (!value) {
      missing.push(secretName);
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Get secret value from available sources
 * @param {string} secretName - Secret name
 * @returns {string|null} Secret value or null
 */
export function getSecret(secretName) {
  // 1. Check environment
  if (process.env[secretName]) {
    return process.env[secretName];
  }

  // 2. Check .ploinky/.secrets
  const secretsPath = path.join(WORKSPACE_ROOT, '.ploinky', '.secrets');
  if (fs.existsSync(secretsPath)) {
    const secrets = parseSecretsFile(secretsPath);
    if (secrets[secretName]) {
      return secrets[secretName];
    }
  }

  // 3. Check .env file
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const env = parseEnvFile(envPath);
    if (env[secretName]) {
      return env[secretName];
    }
  }

  return null;
}

/**
 * Get secrets from environment or files
 * @param {string[]} secretNames - List of secret names
 * @returns {Object.<string, string>} Map of secret name to value
 */
export function getSecrets(secretNames) {
  const secrets = {};

  for (const name of secretNames) {
    const value = getSecret(name);
    if (value) {
      secrets[name] = value;
    }
  }

  return secrets;
}

/**
 * Build docker -e flags for secrets
 * @param {Object.<string, string>} secrets - Secret map
 * @returns {string[]} Docker -e flag arguments
 */
export function buildSecretEnvFlags(secrets) {
  const flags = [];

  for (const [name, value] of Object.entries(secrets)) {
    flags.push('-e', `${name}=${value}`);
  }

  return flags;
}

/**
 * Parse .secrets file (KEY=value format)
 */
function parseSecretsFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const secrets = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      secrets[key.trim()] = valueParts.join('=').trim();
    }
  }

  return secrets;
}
```

### Lifecycle Hooks

```javascript
// cli/services/lifecycleHooks.js

/**
 * Execute host hook (runs on host machine)
 * @param {string} agentName - Agent name
 * @param {string} hookName - Hook name (hosthook_aftercreation, etc.)
 * @param {Object} env - Environment variables
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function executeHostHook(agentName, hookName, env = {}) {
  const config = getProfileConfig(agentName, getActiveProfile());
  const scriptPath = config[hookName];

  if (!scriptPath) {
    return { exitCode: 0, stdout: '', stderr: '' }; // No hook defined
  }

  const fullPath = resolveScriptPath(agentName, scriptPath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: Hook script not found: ${fullPath}`);
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  // Execute on host
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', [fullPath], {
      env: {
        ...process.env,
        ...env,
        PLOINKY_PROFILE: getActiveProfile(),
        PLOINKY_AGENT_NAME: agentName,
        PLOINKY_CWD: process.cwd()
      },
      cwd: path.dirname(fullPath)
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

/**
 * Execute container hook (runs inside container)
 * @param {string} containerName - Container name
 * @param {string} agentName - Agent name
 * @param {string} hookName - Hook name (preinstall, install, postinstall)
 * @param {Object} env - Environment variables
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function executeContainerHook(containerName, agentName, hookName, env = {}) {
  const config = getProfileConfig(agentName, getActiveProfile());
  const script = config[hookName];

  if (!script) {
    return { exitCode: 0, stdout: '', stderr: '' }; // No hook defined
  }

  // Build environment flags
  const envFlags = [];
  for (const [key, value] of Object.entries(env)) {
    envFlags.push('-e', `${key}=${value}`);
  }

  // Execute in container
  const command = Array.isArray(script) ? script.join(' && ') : script;
  return execInContainer(containerName, command, envFlags);
}

/**
 * Run full profile lifecycle
 * @param {string} agentName - Agent name
 * @param {string} containerName - Container name
 * @returns {Promise<void>}
 */
export async function runProfileLifecycle(agentName, containerName) {
  const profile = getActiveProfile();
  const config = getProfileConfig(agentName, profile);

  // Build environment
  const env = {
    PLOINKY_PROFILE: profile,
    PLOINKY_AGENT_NAME: agentName,
    ...config.env,
    ...getSecrets(config.secrets || [])
  };

  // Execute hooks in order
  console.log(`Running ${profile} profile lifecycle for ${agentName}...`);

  // 1. Host hook after creation
  await executeHostHook(agentName, 'hosthook_aftercreation', env);

  // 2. Container hooks
  await executeContainerHook(containerName, agentName, 'preinstall', env);
  await executeContainerHook(containerName, agentName, 'install', env);
  await executeContainerHook(containerName, agentName, 'postinstall', env);

  // 3. Host hook after postinstall
  await executeHostHook(agentName, 'hosthook_postinstall', env);

  console.log(`Profile lifecycle complete for ${agentName}`);
}
```

## Behavioral Specification

### Profile Command Flow

```
1. User runs: ploinky profile qa

2. CLI validates profile name

3. Profile stored in .ploinky/profile

4. Subsequent agent starts use QA configuration

5. Mount modes applied based on profile

6. Secrets validated before container start

7. Profile-specific hooks executed
```

### Secret Injection Flow

```
1. Agent start initiated

2. Load profile configuration from manifest

3. Get required secrets list

4. For each secret:
   a. Check environment variables
   b. Check .ploinky/.secrets
   c. Check .env file

5. If missing secrets: fail with clear error

6. Pass secrets via docker -e flags

7. Secrets available in container as env vars
```

## Configuration

### Profile Storage

```
.ploinky/
├── profile           # Active profile name (e.g., "dev")
└── .secrets          # Local secrets file (gitignored)
```

### Manifest Profile Definition

```json
{
  "container": "node:20-bullseye",
  "about": "My application agent",

  "profiles": {
    "dev": {
      "hosthook_aftercreation": "scripts/dev_aftercreation.sh",
      "preinstall": "scripts/dev_preinstall.sh",
      "install": "npm install",
      "postinstall": "scripts/dev_postinstall.sh",
      "hosthook_postinstall": "scripts/dev_host_postinstall.sh",
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "true",
        "LOG_LEVEL": "debug"
      },
      "secrets": ["DEV_API_KEY", "DEV_DATABASE_URL"],
      "mounts": {
        "code": "rw",
        "skills": "rw"
      }
    },

    "qa": {
      "install": "npm ci",
      "env": {
        "NODE_ENV": "test",
        "DEBUG": "false"
      },
      "secrets": ["QA_API_KEY", "QA_DATABASE_URL"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    },

    "prod": {
      "install": "npm ci --production",
      "env": {
        "NODE_ENV": "production",
        "DEBUG": "false"
      },
      "secrets": ["PROD_API_KEY", "PROD_DATABASE_URL"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    }
  },

  "defaultProfile": "dev"
}
```

### GitHub Actions Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy with Ploinky

on:
  push:
    branches: [main, develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy Dev
        if: github.ref == 'refs/heads/develop'
        env:
          DEV_API_KEY: ${{ secrets.DEV_API_KEY }}
          DEV_DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}
        run: |
          ploinky profile dev
          ploinky start my-agent 8088

      - name: Deploy Prod
        if: github.ref == 'refs/heads/main'
        env:
          PROD_API_KEY: ${{ secrets.PROD_API_KEY }}
          PROD_DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
        run: |
          ploinky profile prod
          ploinky start my-agent 8088
```

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

## Security Considerations

- **Never commit secrets**: `.ploinky/.secrets` must be in `.gitignore`
- **Secrets in memory only**: Passed via `-e` flags, never written to disk
- **Host hooks run with user privileges**: Ensure scripts are trusted
- **Validate script sources**: Only execute scripts from within repo directory

## Success Criteria

1. Profile switching works correctly
2. Secrets validated before agent start
3. Lifecycle hooks execute in correct order
4. Mount modes applied based on profile
5. Clear error messages for missing secrets

## References

- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS04 - Manifest Schema](./DS04-manifest-schema.md)
- [DS11 - Container Runtime](./DS11-container-runtime.md)
