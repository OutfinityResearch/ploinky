# DS04 - Manifest Schema

## Summary

The `manifest.json` file is the declarative configuration that defines an agent's behavior, dependencies, and runtime requirements. This specification documents the complete schema, field types, validation rules, and examples for creating valid manifests.

## Background / Problem Statement

Agent configuration needs to be:
- Declarative and version-controllable
- Flexible enough for simple and complex agents
- Validated before runtime to catch errors early
- Extensible for future features (profiles, hooks)

## Goals

1. **Complete Schema Documentation**: Every field documented with type and purpose
2. **Validation Rules**: Clear rules for required fields and valid values
3. **Backward Compatibility**: Old manifests continue to work
4. **Extensibility**: Schema supports profiles, hooks, and future features

## Non-Goals

- GUI manifest editor
- Manifest migration tools
- Schema versioning (current version: 1.0)

## Data Models

### Complete Manifest Schema

```javascript
/**
 * @typedef {Object} Manifest
 *
 * === CORE FIELDS ===
 * @property {string} container - Docker image URI (REQUIRED unless `image` provided)
 * @property {string} [image] - Alternative to `container` (same purpose)
 * @property {string} [about] - Human-readable description
 *
 * === LIFECYCLE HOOKS ===
 * @property {string|string[]} [preinstall] - Commands before install
 * @property {string} [install] - Main installation command
 * @property {string|string[]} [postinstall] - Commands after install
 * @property {string} [update] - Update command (informational)
 * @property {string} [start] - Sidecar command to start alongside agent
 *
 * === ENTRY POINTS ===
 * @property {string} [agent] - Agent command (MCP server)
 * @property {string} [cli] - CLI command (interactive shell)
 * @property {string} [run] - Default run command
 * @property {Object} [commands] - Legacy commands object
 * @property {string} [commands.run] - Legacy run command
 *
 * === ENVIRONMENT ===
 * @property {EnvSpec} [env] - Environment variables (multiple formats)
 * @property {Object.<string, string|ExposeSpec>} [expose] - Exposed variables
 *
 * === NETWORKING ===
 * @property {string|string[]} [port] - Single port or port list
 * @property {string[]} [ports] - Port mappings array
 *
 * === STORAGE ===
 * @property {Object.<string, string>} [volumes] - Volume mappings
 *
 * === DEPENDENCIES ===
 * @property {string[]} [enable] - Agent dependencies (enable directives)
 * @property {Object.<string, string>} [repos] - Repository definitions
 *
 * === HEALTH CHECKS ===
 * @property {HealthConfig} [health] - Health probe configuration
 *
 * === PROFILES ===
 * @property {Object.<string, ProfileConfig>} [profiles] - Profile configurations
 * @property {string} [defaultProfile] - Default profile name
 */
```

### Field Type Definitions

```javascript
/**
 * Environment variable specification
 * Supports three formats: array of strings, array of objects, or object map
 * Also supports wildcard patterns for automatic variable expansion:
 *   - "LLM_MODEL_*"   - Matches all variables starting with LLM_MODEL_
 *   - "ACHILLES_*"    - Matches all variables starting with ACHILLES_
 *   - "*"             - Matches ALL variables except API_KEY (for security)
 *
 * SECURITY: Variables containing "API_KEY" or "APIKEY" are excluded from
 * the "*" wildcard and must be explicitly listed in the manifest.
 *
 * @typedef {string[]|EnvObject[]|Object.<string, string|EnvObjectValue>} EnvSpec
 */

/**
 * Environment variable object format
 * @typedef {Object} EnvObject
 * @property {string} name - Variable name inside container (supports wildcards)
 * @property {string} [varName] - Source variable name (on host)
 * @property {boolean} [required] - Whether variable is required
 * @property {string} [value] - Default value
 */

/**
 * Environment variable object value format (when using object map)
 * @typedef {Object} EnvObjectValue
 * @property {string} [varName] - Source variable name
 * @property {boolean|string} [required] - Required flag ("true"/"false" or boolean)
 * @property {string} [default] - Default value
 */

/**
 * Exposed variable specification
 * @typedef {Object} ExposeSpec
 * @property {string} value - Literal value or $VAR reference
 */

/**
 * Health probe configuration
 * @typedef {Object} HealthConfig
 * @property {ProbeConfig} [liveness] - Liveness probe
 * @property {ProbeConfig} [readiness] - Readiness probe
 */

/**
 * Individual probe configuration
 * @typedef {Object} ProbeConfig
 * @property {string} script - Script path to execute
 * @property {number} [interval] - Check interval in seconds
 * @property {number} [timeout] - Timeout in seconds
 * @property {number} [retries] - Number of retries before failure
 */

/**
 * Profile configuration
 * @typedef {Object} ProfileConfig
 * @property {string} [hosthook_aftercreation] - Host hook after container creation
 * @property {string|string[]} [preinstall] - Container preinstall commands
 * @property {string|string[]} [install] - Container install commands
 * @property {string|string[]} [postinstall] - Container postinstall commands
 * @property {string} [hosthook_postinstall] - Host hook after postinstall
 * @property {Object.<string, string>} [env] - Profile-specific environment
 * @property {string[]} [secrets] - Required secrets for this profile
 * @property {MountConfig} [mounts] - Profile-specific mount modes
 * @property {Object} [dependencies] - Profile-specific npm dependencies
 */

/**
 * Mount configuration for profiles
 * @typedef {Object} MountConfig
 * @property {string} [code] - Mount mode for /code ("rw" or "ro")
 * @property {string} [skills] - Mount mode for /.AchillesSkills ("rw" or "ro")
 */
```

## API Contracts

### Manifest Loading

```javascript
// cli/services/agents.js

/**
 * Load and parse manifest.json for an agent
 * @param {string} agentName - Agent name
 * @param {string} repoName - Repository name
 * @returns {Promise<Manifest>}
 * @throws {ManifestError} If manifest is invalid or not found
 */
export async function loadManifest(agentName, repoName) {
  const manifestPath = path.join(
    WORKSPACE_ROOT,
    '.ploinky',
    'repos',
    repoName,
    agentName,
    'manifest.json'
  );

  // Check file exists
  if (!fs.existsSync(manifestPath)) {
    throw new ManifestError('MANIFEST_NOT_FOUND', { agentName, repoName });
  }

  // Parse JSON
  let manifest;
  try {
    const content = await fs.promises.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (error) {
    throw new ManifestError('MANIFEST_PARSE_ERROR', { agentName, error });
  }

  // Validate schema
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new ManifestError('MANIFEST_INVALID', { agentName, errors: validation.errors });
  }

  return manifest;
}

/**
 * Validate manifest against schema
 * @param {Object} manifest - Manifest object to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateManifest(manifest) {
  const errors = [];

  // Required: container or image
  if (!manifest.container && !manifest.image) {
    errors.push('Missing required field: "container" or "image"');
  }

  // Validate container image format
  if (manifest.container && !isValidImageUri(manifest.container)) {
    errors.push(`Invalid container image URI: ${manifest.container}`);
  }

  // Validate ports format
  if (manifest.ports) {
    manifest.ports.forEach((port, i) => {
      if (!isValidPortSpec(port)) {
        errors.push(`Invalid port specification at index ${i}: ${port}`);
      }
    });
  }

  // Validate env format
  if (manifest.env) {
    const envErrors = validateEnvSpec(manifest.env);
    errors.push(...envErrors);
  }

  // Validate volumes
  if (manifest.volumes) {
    Object.entries(manifest.volumes).forEach(([host, container]) => {
      if (typeof container !== 'string') {
        errors.push(`Invalid volume target for "${host}": must be string`);
      }
    });
  }

  // Validate profiles
  if (manifest.profiles) {
    Object.entries(manifest.profiles).forEach(([name, config]) => {
      const profileErrors = validateProfileConfig(name, config);
      errors.push(...profileErrors);
    });
  }

  return { valid: errors.length === 0, errors };
}
```

### Environment Variable Normalization

```javascript
/**
 * Normalize environment specification to consistent format
 * @param {EnvSpec} envSpec - Environment specification (any format)
 * @returns {NormalizedEnv[]} Normalized environment array
 */
export function normalizeEnvSpec(envSpec) {
  // Format 1: Array of strings
  // ["VAR_NAME", "VAR_NAME=default"]
  if (Array.isArray(envSpec) && typeof envSpec[0] === 'string') {
    return envSpec.map(entry => {
      if (entry.includes('=')) {
        const [name, value] = entry.split('=', 2);
        return { name, value, required: false };
      }
      return { name: entry, required: true };
    });
  }

  // Format 2: Array of objects
  // [{ name: "INSIDE", varName: "SOURCE", required: true }]
  if (Array.isArray(envSpec) && typeof envSpec[0] === 'object') {
    return envSpec.map(entry => ({
      name: entry.name,
      varName: entry.varName || entry.name,
      value: entry.value || entry.default,
      required: entry.required === true || entry.required === 'true'
    }));
  }

  // Format 3: Object map
  // { "INSIDE": { varName: "SOURCE", required: false, default: "val" } }
  if (typeof envSpec === 'object' && !Array.isArray(envSpec)) {
    return Object.entries(envSpec).map(([name, spec]) => {
      if (typeof spec === 'string') {
        return { name, value: spec, required: false };
      }
      return {
        name,
        varName: spec.varName || name,
        value: spec.default || spec.value,
        required: spec.required === true || spec.required === 'true'
      };
    });
  }

  return [];
}
```

### Port Specification Parsing

```javascript
/**
 * Parse port specification into structured format
 * @param {string} portSpec - Port specification string
 * @returns {PortMapping}
 *
 * Supported formats:
 * - "7000"                   -> container:7000, host:random
 * - "8000:8000"              -> container:8000, host:8000
 * - "127.0.0.1:8000:8000"    -> container:8000, host:8000, hostIp:127.0.0.1
 * - "0.0.0.0:5432:5432"      -> container:5432, host:5432, hostIp:0.0.0.0
 */
export function parsePortSpec(portSpec) {
  const parts = portSpec.split(':');

  if (parts.length === 1) {
    // "7000" - container port only
    return {
      containerPort: parseInt(parts[0]),
      hostPort: 0  // 0 = random port
    };
  }

  if (parts.length === 2) {
    // "8000:8000" - host:container
    return {
      hostPort: parseInt(parts[0]),
      containerPort: parseInt(parts[1])
    };
  }

  if (parts.length === 3) {
    // "127.0.0.1:8000:8000" - hostIp:host:container
    return {
      hostIp: parts[0],
      hostPort: parseInt(parts[1]),
      containerPort: parseInt(parts[2])
    };
  }

  throw new Error(`Invalid port specification: ${portSpec}`);
}
```

## Behavioral Specification

### Manifest Resolution Order

When determining effective configuration, values are resolved in this order:

```
1. Profile-specific values (if profile active)
   ↓
2. Manifest top-level values
   ↓
3. Default values (hardcoded)
```

```javascript
/**
 * Get effective configuration for an agent
 * @param {Manifest} manifest - Loaded manifest
 * @param {string} profile - Active profile name
 * @returns {EffectiveConfig}
 */
export function getEffectiveConfig(manifest, profile) {
  const defaults = {
    port: 7000,
    shell: '/bin/sh',
    workdir: '/code'
  };

  // Start with defaults
  let config = { ...defaults };

  // Apply top-level manifest values
  config = { ...config, ...manifest };

  // Apply profile-specific values
  if (profile && manifest.profiles?.[profile]) {
    const profileConfig = manifest.profiles[profile];
    config = {
      ...config,
      env: { ...config.env, ...profileConfig.env },
      preinstall: profileConfig.preinstall || config.preinstall,
      install: profileConfig.install || config.install,
      postinstall: profileConfig.postinstall || config.postinstall
    };
  }

  return config;
}
```

### Enable Directive Parsing

```javascript
/**
 * Parse enable directive string
 * @param {string} directive - Enable directive
 * @returns {EnableDirective}
 *
 * Formats:
 * - "agentName"                    -> enable agent in isolated mode
 * - "agentName global"             -> enable in global mode
 * - "agentName devel repoName"     -> enable in devel mode
 * - "agentName global as myAlias"  -> enable with alias
 */
export function parseEnableDirective(directive) {
  const parts = directive.trim().split(/\s+/);
  const result = {
    agentName: parts[0],
    runMode: 'isolated',
    repoName: null,
    alias: null
  };

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    if (part === 'global') {
      result.runMode = 'global';
    } else if (part === 'devel') {
      result.runMode = 'devel';
      result.repoName = parts[++i];
    } else if (part === 'as') {
      result.alias = parts[++i];
    }
  }

  return result;
}
```

## Configuration

### Manifest File Location

```
.ploinky/repos/<repoName>/<agentName>/manifest.json
```

### Default Values

| Field | Default | Notes |
|-------|---------|-------|
| `port` | `7000` | AgentServer default port |
| `shell` | `/bin/sh` | Fallback shell |
| `cli` | `/bin/sh` | If not specified |
| `defaultProfile` | `dev` | When profiles defined |

## Error Handling

### Validation Errors

```javascript
const manifestErrors = {
  MANIFEST_NOT_FOUND: {
    code: 'MANIFEST_NOT_FOUND',
    message: (ctx) => `Manifest not found for agent '${ctx.agentName}' in repo '${ctx.repoName}'`,
    suggestion: 'Check that the agent exists in the repository'
  },
  MANIFEST_PARSE_ERROR: {
    code: 'MANIFEST_PARSE_ERROR',
    message: (ctx) => `Failed to parse manifest.json: ${ctx.error.message}`,
    suggestion: 'Validate JSON syntax in manifest.json'
  },
  MANIFEST_INVALID: {
    code: 'MANIFEST_INVALID',
    message: (ctx) => `Invalid manifest:\n${ctx.errors.map(e => `  - ${e}`).join('\n')}`,
    suggestion: 'Fix the listed validation errors'
  },
  MISSING_CONTAINER: {
    code: 'MISSING_CONTAINER',
    message: () => 'Manifest must specify "container" or "image" field',
    suggestion: 'Add "container": "image:tag" to manifest.json'
  }
};
```

## Security Considerations

- **Secret Exposure**: Never store secrets in manifest.json
- **Script Injection**: Validate hook scripts exist in repo directory
- **Image Trust**: Use specific image tags, not `latest`
- **Volume Paths**: Validate volume paths are within workspace

## Manifest Examples

### Minimal Agent

```json
{
  "container": "alpine:latest",
  "about": "Minimal shell agent"
}
```

### Development Environment

```json
{
  "container": "node:20-bullseye",
  "install": "npm install -g typescript ts-node nodemon",
  "update": "npm update -g typescript ts-node nodemon",
  "cli": "/bin/bash",
  "about": "Node.js development environment"
}
```

### Database Service

```json
{
  "container": "postgres:16-alpine",
  "about": "PostgreSQL database",
  "agent": "postgres",
  "env": [
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB"
  ],
  "ports": ["0.0.0.0:5432:5432"],
  "volumes": {
    "postgres/data": "/var/lib/postgresql/data"
  }
}
```

### Agent with Profiles

```json
{
  "container": "node:20-bullseye",
  "about": "Application with environment profiles",

  "profiles": {
    "dev": {
      "install": "npm install",
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "true"
      },
      "secrets": ["DEV_API_KEY"]
    },
    "prod": {
      "install": "npm ci --production",
      "env": {
        "NODE_ENV": "production",
        "DEBUG": "false"
      },
      "secrets": ["PROD_API_KEY"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    }
  },

  "defaultProfile": "dev"
}
```

### Agent with Dependencies

```json
{
  "container": "python:3.11-slim",
  "about": "Python agent with dependencies",
  "enable": [
    "postgres global",
    "redis global"
  ],
  "repos": {
    "custom": "https://github.com/user/agents.git"
  }
}
```

### Agent with Health Checks

```json
{
  "container": "node:20-alpine",
  "about": "Service with health monitoring",
  "agent": "node server.js",
  "health": {
    "liveness": {
      "script": "scripts/liveness.sh",
      "interval": 5,
      "timeout": 10
    },
    "readiness": {
      "script": "scripts/readiness.sh",
      "interval": 3,
      "timeout": 5
    }
  }
}
```

### Agent with Wildcard Environment Variables

```json
{
  "container": "node:20-bullseye",
  "about": "LLM-powered agent with wildcard env injection",
  "agent": "node /Agent/server/AgentServer.mjs",

  "env": [
    "LLM_MODEL_*",
    "ACHILLES_*",
    "OPENAI_*_URL",
    "ANTHROPIC_*_URL",

    "DATABASE_URL",
    "LOG_LEVEL=info",

    "OPENAI_API_KEY"
  ]
}
```

**Wildcard Pattern Reference:**

| Pattern | Description |
|---------|-------------|
| `LLM_MODEL_*` | Matches `LLM_MODEL_01`, `LLM_MODEL_02`, etc. |
| `ACHILLES_*` | Matches `ACHILLES_DEBUG`, `ACHILLES_DEFAULT_MODEL`, etc. |
| `PREFIX_*_SUFFIX` | Matches `PREFIX_FOO_SUFFIX`, `PREFIX_BAR_SUFFIX`, etc. |
| `*` | Matches ALL environment variables EXCEPT those containing `API_KEY` |

**Security Note:** The `*` wildcard automatically excludes variables containing `API_KEY` or `APIKEY` to prevent accidental exposure of sensitive credentials. To include API keys, they must be explicitly listed.

## Success Criteria

1. All existing manifests pass validation
2. New manifests validated before container creation
3. Clear error messages for invalid manifests
4. Profile resolution works correctly
5. Environment normalization handles all formats

## Environment Variable Aliasing

The secret variable system (`cli/services/secretVars.js`) supports variable aliasing using `$VAR` syntax:

```bash
# .ploinky/.secrets
MAIN_API_KEY=sk-abc123
AGENT_API_KEY=$MAIN_API_KEY    # Alias: resolves to sk-abc123
```

When `resolveVarValue()` encounters a value starting with `$`, it recursively resolves the referenced variable. This enables sharing a single key across multiple agents that expect different variable names.

## References

- [DS01 - Vision](./DS01-vision.md)
- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS08 - Profile System](./DS08-profile-system.md)
- [DS11 - Container Runtime & Dependencies](./DS11-container-runtime.md)
