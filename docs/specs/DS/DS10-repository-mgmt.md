# DS10 - Repository Management

## Summary

Repositories are collections of agent definitions that can be added, enabled, updated, and shared. This specification documents repository structure, management commands, and the discovery mechanism for agents within repositories.

## Background / Problem Statement

Agents need to be organized, shared, and versioned:
- Predefined repositories for common agents
- Custom repositories for organization-specific agents
- Git-based versioning and updates
- Agent discovery across multiple repositories

## Goals

1. **Repository Operations**: Add, enable, disable, update, remove repositories
2. **Predefined Repos**: Built-in repositories for common use cases
3. **Custom Repos**: Support for Git-based custom repositories
4. **Agent Discovery**: Find agents across enabled repositories

## Non-Goals

- Repository hosting service
- Private repository authentication (use Git credentials)
- Repository marketplace

## Architecture Overview

### Repository Structure

```
.ploinky/repos/
├── basic/                        # Predefined repository
│   ├── alpine-bash/
│   │   └── manifest.json
│   ├── node-dev/
│   │   ├── manifest.json
│   │   ├── code/
│   │   └── .AchillesSkills/
│   ├── postgres/
│   │   └── manifest.json
│   └── ...
│
├── cloud/                        # Predefined repository
│   ├── aws-cli/
│   ├── gcloud/
│   └── azure-cli/
│
└── custom/                       # Custom repository
    ├── my-agent/
    │   ├── manifest.json
    │   └── code/
    └── another-agent/
```

## Data Models

### Repository Registry

```javascript
/**
 * Repository entry in enabled_repos.json
 * @typedef {Object} RepoEntry
 * @property {string} name - Repository name
 * @property {string} url - Git URL (for custom repos)
 * @property {string} path - Local path to repository
 * @property {boolean} enabled - Whether repo is enabled
 * @property {Date} addedAt - When repository was added
 * @property {Date} [updatedAt] - Last update timestamp
 */

/**
 * Predefined repository URLs
 */
const PREDEFINED_REPOS = {
  'basic': 'https://github.com/PloinkyRepos/basic.git',
  'cloud': 'https://github.com/PloinkyRepos/cloud.git',
  'vibe': 'https://github.com/PloinkyRepos/vibe.git',
  'security': 'https://github.com/PloinkyRepos/security.git',
  'extra': 'https://github.com/PloinkyRepos/extra.git',
  'demo': 'https://github.com/PloinkyRepos/demo.git'
};
```

### Agent Discovery Result

```javascript
/**
 * Result of agent discovery
 * @typedef {Object} DiscoveredAgent
 * @property {string} name - Agent name
 * @property {string} repo - Repository name
 * @property {string} path - Path to agent directory
 * @property {string} description - Agent description (from manifest.about)
 * @property {string} container - Container image
 */
```

## API Contracts

### Repository Service

```javascript
// cli/services/repos.js

/**
 * Add a repository
 * @param {string} name - Repository name
 * @param {string} [url] - Git URL (optional for predefined repos)
 * @returns {Promise<RepoEntry>}
 */
export async function addRepo(name, url) {
  // Resolve URL for predefined repos
  const repoUrl = PREDEFINED_REPOS[name] || url;

  if (!repoUrl) {
    throw new Error(
      `Unknown repository '${name}'. ` +
      `Provide URL or use predefined: ${Object.keys(PREDEFINED_REPOS).join(', ')}`
    );
  }

  const repoPath = path.join(REPOS_DIR, name);

  // Check if already exists
  if (fs.existsSync(repoPath)) {
    throw new Error(`Repository '${name}' already exists`);
  }

  // Clone repository
  console.log(`Cloning ${name} from ${repoUrl}...`);
  await git.clone(repoUrl, repoPath);

  // Create registry entry
  const entry = {
    name,
    url: repoUrl,
    path: repoPath,
    enabled: false,
    addedAt: new Date()
  };

  // Save to registry
  await saveRepoEntry(entry);

  // Discover agents
  const agents = await discoverAgents(name);
  console.log(`Repository '${name}' added. Found ${agents.length} agents.`);

  return entry;
}

/**
 * Enable a repository
 * @param {string} name - Repository name
 * @returns {Promise<void>}
 */
export async function enableRepo(name) {
  const entry = await getRepoEntry(name);

  if (!entry) {
    throw new Error(`Repository '${name}' not found. Run 'add repo ${name}' first.`);
  }

  entry.enabled = true;
  await saveRepoEntry(entry);

  // Add to enabled_repos.json
  const enabledRepos = await getEnabledRepos();
  if (!enabledRepos.includes(name)) {
    enabledRepos.push(name);
    await saveEnabledRepos(enabledRepos);
  }

  const agents = await discoverAgents(name);
  console.log(`Repository '${name}' enabled. Agents: ${agents.map(a => a.name).join(', ')}`);
}

/**
 * Disable a repository
 * @param {string} name - Repository name
 * @returns {Promise<void>}
 */
export async function disableRepo(name) {
  const entry = await getRepoEntry(name);

  if (!entry) {
    throw new Error(`Repository '${name}' not found`);
  }

  entry.enabled = false;
  await saveRepoEntry(entry);

  // Remove from enabled_repos.json
  const enabledRepos = await getEnabledRepos();
  const index = enabledRepos.indexOf(name);
  if (index > -1) {
    enabledRepos.splice(index, 1);
    await saveEnabledRepos(enabledRepos);
  }

  console.log(`Repository '${name}' disabled`);
}

/**
 * Update a repository
 * @param {string} name - Repository name
 * @returns {Promise<{updated: number, added: number}>}
 */
export async function updateRepo(name) {
  const entry = await getRepoEntry(name);

  if (!entry) {
    throw new Error(`Repository '${name}' not found`);
  }

  const beforeAgents = await discoverAgents(name);

  // Pull latest changes
  console.log(`Updating '${name}'...`);
  await git.pull(entry.path);

  entry.updatedAt = new Date();
  await saveRepoEntry(entry);

  const afterAgents = await discoverAgents(name);

  const added = afterAgents.filter(a =>
    !beforeAgents.find(b => b.name === a.name)
  ).length;

  const updated = afterAgents.filter(a =>
    beforeAgents.find(b => b.name === a.name)
  ).length;

  console.log(`Repository '${name}' updated. ${updated} updated, ${added} new agents.`);

  return { updated, added };
}

/**
 * Remove a repository
 * @param {string} name - Repository name
 * @returns {Promise<void>}
 */
export async function removeRepo(name) {
  const entry = await getRepoEntry(name);

  if (!entry) {
    throw new Error(`Repository '${name}' not found`);
  }

  // Disable first
  await disableRepo(name);

  // Remove directory
  await fs.promises.rm(entry.path, { recursive: true });

  // Remove from registry
  await deleteRepoEntry(name);

  console.log(`Repository '${name}' removed`);
}

/**
 * List all repositories
 * @returns {Promise<RepoEntry[]>}
 */
export async function listRepos() {
  const repos = [];
  const enabledRepos = await getEnabledRepos();

  const repoNames = await fs.promises.readdir(REPOS_DIR);

  for (const name of repoNames) {
    const repoPath = path.join(REPOS_DIR, name);
    const stat = await fs.promises.stat(repoPath);

    if (stat.isDirectory()) {
      const agents = await discoverAgents(name);
      repos.push({
        name,
        path: repoPath,
        enabled: enabledRepos.includes(name),
        agentCount: agents.length
      });
    }
  }

  return repos;
}
```

### Agent Discovery

```javascript
/**
 * Discover agents in a repository
 * @param {string} repoName - Repository name
 * @returns {Promise<DiscoveredAgent[]>}
 */
export async function discoverAgents(repoName) {
  const repoPath = path.join(REPOS_DIR, repoName);
  const agents = [];

  const entries = await fs.promises.readdir(repoPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const manifestPath = path.join(repoPath, entry.name, 'manifest.json');

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(
          await fs.promises.readFile(manifestPath, 'utf-8')
        );

        agents.push({
          name: entry.name,
          repo: repoName,
          path: path.join(repoPath, entry.name),
          description: manifest.about || '',
          container: manifest.container || manifest.image
        });
      }
    }
  }

  return agents;
}

/**
 * Find an agent across all enabled repositories
 * @param {string} agentName - Agent name
 * @returns {Promise<DiscoveredAgent|null>}
 */
export async function findAgent(agentName) {
  const enabledRepos = await getEnabledRepos();

  for (const repoName of enabledRepos) {
    const agents = await discoverAgents(repoName);
    const agent = agents.find(a => a.name === agentName);

    if (agent) {
      return agent;
    }
  }

  return null;
}

/**
 * List all available agents from enabled repositories
 * @returns {Promise<DiscoveredAgent[]>}
 */
export async function listAvailableAgents() {
  const enabledRepos = await getEnabledRepos();
  const allAgents = [];

  for (const repoName of enabledRepos) {
    const agents = await discoverAgents(repoName);
    allAgents.push(...agents);
  }

  return allAgents;
}
```

## Behavioral Specification

### Repository Add Flow

```
1. User runs: add repo <name> [url]

2. Resolve URL:
   - If predefined: use built-in URL
   - If custom: require URL argument

3. Clone Git repository to .ploinky/repos/<name>/

4. Scan for agent directories (those with manifest.json)

5. Create registry entry

6. Report discovered agents
```

### Agent Discovery Flow

```
1. Request to find agent "my-agent"

2. Get list of enabled repositories

3. For each enabled repo:
   a. List directories
   b. Check for manifest.json
   c. If agent name matches, return

4. If not found, return null
```

## Configuration

### Repository Registry File

```json
// .ploinky/enabled_repos.json
[
  "basic",
  "cloud",
  "custom"
]
```

### Repository Directory Structure

Each repository must follow this structure:

```
<repo>/
├── <agent-1>/
│   ├── manifest.json      # Required
│   ├── code/              # Optional: agent source code
│   ├── .AchillesSkills/   # Optional: agent skills
│   └── scripts/           # Optional: lifecycle scripts
├── <agent-2>/
│   └── manifest.json
└── README.md              # Optional: repository documentation
```

## Predefined Repositories

| Repository | Description | Agents |
|------------|-------------|--------|
| `basic` | Common development tools | alpine-bash, node-dev, postgres, shell, ubuntu-bash, etc. |
| `cloud` | Cloud CLI tools | aws-cli, gcloud, azure-cli, terraform |
| `vibe` | Vibe coding agents | claude-code, copilot-agent |
| `security` | Security tools | clamav-scanner, trivy, snyk |
| `extra` | Additional utilities | curl-agent, jq-agent, yq-agent |
| `demo` | Demo and example agents | hello-world, echo-agent |

### Basic Repository Agents

```
basic/
├── alpine-bash      - Alpine Linux shell
├── clamav-scanner   - Antivirus scanner
├── curl-agent       - HTTP client
├── debian-bash      - Debian shell
├── docker-agent     - Docker management
├── fedora-bash      - Fedora shell
├── github-cli-agent - GitHub CLI
├── gitlab-cli-agent - GitLab CLI
├── keycloak         - Identity provider
├── node-dev         - Node.js development
├── postgres         - PostgreSQL database
├── postman-cli      - API testing
├── puppeteer-agent  - Browser automation
├── rocky-bash       - Rocky Linux shell
├── shell            - Generic shell
└── ubuntu-bash      - Ubuntu shell
```

## Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| Repo not found | Invalid repo name | Check spelling, list repos |
| Clone failed | Network or auth error | Check URL, credentials |
| No manifest | Invalid agent directory | Check manifest.json exists |
| Already exists | Duplicate repo add | Use update instead |

### Error Messages

```javascript
const repoErrors = {
  REPO_NOT_FOUND: (name) =>
    `Repository '${name}' not found.\n` +
    `Run 'list repos' to see available repositories.`,

  REPO_EXISTS: (name) =>
    `Repository '${name}' already exists.\n` +
    `Run 'update repo ${name}' to update it.`,

  CLONE_FAILED: (name, error) =>
    `Failed to clone repository '${name}'.\n` +
    `Error: ${error.message}\n` +
    `Check URL and network connectivity.`,

  AGENT_NOT_FOUND: (name) =>
    `Agent '${name}' not found in any enabled repository.\n` +
    `Run 'list agents' to see available agents.`
};
```

## Security Considerations

- **Git Credentials**: Use Git credential helpers for private repos
- **Manifest Validation**: Validate manifests on discovery
- **URL Validation**: Validate Git URLs before cloning
- **Path Traversal**: Prevent path traversal in agent names

## Success Criteria

1. Predefined repos clone successfully
2. Custom repos with Git URLs work
3. Agent discovery finds all valid agents
4. Enable/disable affects agent visibility
5. Update pulls latest changes

## References

- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS04 - Manifest Schema](./DS04-manifest-schema.md)
- [DS05 - CLI Commands](./DS05-cli-commands.md)
