import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { containerRuntime } from './docker/common.js';
import { TEMPLATES_DIR, GLOBAL_DEPS_PATH } from './config.js';
import { getAgentWorkDir, getAgentCodePath, getPackageBaseTemplatePath } from './workspaceStructure.js';
import { debugLog } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filename);

/**
 * Execute a command inside a running container.
 * @param {string} containerName - The container name
 * @param {string} command - The command to execute
 * @param {object} options - Options for execSync
 * @returns {string} Command output
 */
function dockerExec(containerName, command, options = {}) {
    const cmd = `${containerRuntime} exec ${containerName} sh -c "${command.replace(/"/g, '\\"')}"`;
    debugLog(`dockerExec: ${cmd}`);
    return execSync(cmd, { stdio: options.stdio || 'pipe', ...options }).toString().trim();
}

/**
 * Write a file inside a running container using stdin.
 * @param {string} containerName - The container name
 * @param {string} filePath - Path to write inside the container
 * @param {string} content - Content to write
 */
function writeFileInContainer(containerName, filePath, content) {
    const cmd = `${containerRuntime} exec -i ${containerName} sh -c "cat > ${filePath}"`;
    debugLog(`dockerExec: ${cmd}`);
    execSync(cmd, { input: content });
}

/**
 * Ensure git is available in the container for npm installs.
 * @param {string} containerName - The container name
 * @param {Function} log - Logger function
 * @returns {{ success: boolean, message: string }}
 */
function ensureGitAvailable(containerName, log = debugLog) {
    try {
        dockerExec(containerName, 'git --version');
        return { success: true, message: 'git available' };
    } catch (_) {}

    const installers = [
        { name: 'apk', check: 'command -v apk', command: 'apk add --no-cache git' },
        { name: 'apt-get', check: 'command -v apt-get', command: 'apt-get update && apt-get install -y git' },
    ];

    for (const installer of installers) {
        try {
            dockerExec(containerName, installer.check);
        } catch (_) {
            continue;
        }

        try {
            log(`[deps] Installing git via ${installer.name}...`);
            dockerExec(containerName, installer.command, { maxBuffer: 1024 * 1024 * 10 });
            return { success: true, message: `git installed via ${installer.name}` };
        } catch (err) {
            log(`[deps] git install via ${installer.name} failed: ${err.message}`);
        }
    }

    return { success: false, message: 'git is required to install dependencies but could not be installed' };
}

/**
 * Ensure native build tools are available for node-gyp modules.
 * @param {string} containerName - The container name
 * @param {Function} log - Logger function
 * @returns {{ success: boolean, message: string }}
 */
function ensureBuildTools(containerName, log = debugLog) {
    const requiredCommands = ['python3', 'make', 'g++'];
    const missing = [];

    for (const command of requiredCommands) {
        try {
            dockerExec(containerName, `command -v ${command}`);
        } catch (_) {
            missing.push(command);
        }
    }

    if (!missing.length) {
        return { success: true, message: 'build tools available' };
    }

    const installers = [
        { name: 'apk', check: 'command -v apk', command: 'apk add --no-cache python3 make g++' },
        { name: 'apt-get', check: 'command -v apt-get', command: 'apt-get update && apt-get install -y python3 make g++' },
    ];

    for (const installer of installers) {
        try {
            dockerExec(containerName, installer.check);
        } catch (_) {
            continue;
        }

        try {
            log(`[deps] Installing build tools via ${installer.name}...`);
            dockerExec(containerName, installer.command, { maxBuffer: 1024 * 1024 * 10 });
            return { success: true, message: `build tools installed via ${installer.name}` };
        } catch (err) {
            log(`[deps] build tool install via ${installer.name} failed: ${err.message}`);
        }
    }

    return { success: false, message: `Missing build tools: ${missing.join(', ')}` };
}

/**
 * Check if a file exists inside the container.
 * @param {string} containerName - The container name
 * @param {string} filePath - Path to check inside container
 * @returns {boolean}
 */
function fileExistsInContainer(containerName, filePath) {
    try {
        dockerExec(containerName, `test -f ${filePath} && echo "yes"`);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Check if a directory exists inside the container.
 * @param {string} containerName - The container name
 * @param {string} dirPath - Path to check inside container
 * @returns {boolean}
 */
function dirExistsInContainer(containerName, dirPath) {
    try {
        dockerExec(containerName, `test -d ${dirPath} && echo "yes"`);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Core dependencies that must be available to every agent.
 * These are synced from ploinky's node_modules to each agent.
 */
const CORE_DEPENDENCIES = [
    'achillesAgentLib',
    'mcp-sdk',
    'flexsearch'
];

/**
 * Read the core dependencies configuration.
 * @returns {object} The core dependencies config
 */
function readCoreDependenciesConfig() {
    const configPath = path.join(TEMPLATES_DIR, 'core-dependencies.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err) {
            debugLog(`[deps] Failed to read core-dependencies.json: ${err.message}`);
        }
    }
    return null;
}

/**
 * Get the list of core dependency names.
 * @returns {string[]} Array of core dependency module names
 */
function getCoreDependencyNames() {
    const config = readCoreDependenciesConfig();
    if (config?.dependencies) {
        return Object.keys(config.dependencies);
    }
    return CORE_DEPENDENCIES;
}

/**
 * Read the base package.json template.
 * @returns {object} The parsed package.json template
 */
function readPackageBaseTemplate() {
    const templatePath = getPackageBaseTemplatePath();
    if (fs.existsSync(templatePath)) {
        return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    }
    // Return default template if file doesn't exist
    return {
        name: 'ploinky-agent-runtime',
        version: '1.0.0',
        type: 'module',
        dependencies: {
            'achillesAgentLib': 'github:OutfinityResearch/achillesAgentLib',
            'mcp-sdk': 'github:PloinkyRepos/MCPSDK#main',
            'node-pty': '^1.0.0',
            'flexsearch': 'github:PloinkyRepos/flexsearch#main'
        }
    };
}

function resolveRootNodeModules() {
    const projectRoot = process.env.PLOINKY_ROOT;
    if (!projectRoot) return null;
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
        return null;
    }
    return nodeModulesPath;
}

/**
 * Sync core dependencies from ploinky's node_modules to agent's node_modules.
 * This ensures that achillesAgentLib, mcp-sdk, and flexsearch are always present
 * with all their subdirectories.
 *
 * @param {string} agentName - The agent name
 * @param {object} options - Options
 * @param {boolean} [options.force=false] - Force sync even if modules exist
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {{ synced: boolean, modules: string[], errors: string[] }}
 */
function syncCoreDependencies(agentName, options = {}) {
    const { force = false, verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    const rootNodeModules = resolveRootNodeModules();
    const result = { synced: false, modules: [], errors: [] };

    if (!rootNodeModules) {
        // Try to find ploinky's node_modules relative to this file
        const ploinkyRoot = path.resolve(__dirnameLocal, '../../..');
        const ploinkyNodeModules = path.join(ploinkyRoot, 'node_modules');
        if (!fs.existsSync(ploinkyNodeModules)) {
            result.errors.push('No ploinky node_modules found');
            return result;
        }
        return syncCoreDepsFromPath(agentName, ploinkyNodeModules, { force, verbose });
    }

    return syncCoreDepsFromPath(agentName, rootNodeModules, { force, verbose });
}

/**
 * Sync core dependencies from a specific node_modules path.
 * @private
 */
function syncCoreDepsFromPath(agentName, sourceNodeModules, options = {}) {
    const { force = false, verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    const agentWorkDir = getAgentWorkDir(agentName);
    const agentNodeModules = path.join(agentWorkDir, 'node_modules');
    const result = { synced: false, modules: [], errors: [] };

    // Ensure agent node_modules exists
    if (!fs.existsSync(agentNodeModules)) {
        fs.mkdirSync(agentNodeModules, { recursive: true });
    }

    const coreDeps = getCoreDependencyNames();
    log(`[deps-core] ${agentName}: Syncing core dependencies: ${coreDeps.join(', ')}`);

    for (const depName of coreDeps) {
        const sourcePath = path.join(sourceNodeModules, depName);
        const targetPath = path.join(agentNodeModules, depName);

        if (!fs.existsSync(sourcePath)) {
            log(`[deps-core] ${agentName}: Core dependency ${depName} not found in source`);
            continue;
        }

        try {
            if (!fs.existsSync(targetPath) || force) {
                // Copy the entire module
                log(`[deps-core] ${agentName}: Copying ${depName}`);
                if (fs.existsSync(targetPath)) {
                    fs.rmSync(targetPath, { recursive: true, force: true });
                }
                if (typeof fs.cpSync === 'function') {
                    fs.cpSync(sourcePath, targetPath, { recursive: true });
                } else {
                    execSync(`cp -a "${sourcePath}" "${targetPath}"`);
                }
                result.modules.push(depName);
            } else {
                // Module exists, sync any missing subdirectories
                const syncedSubdirs = syncModuleSubdirectories(
                    depName,
                    sourcePath,
                    targetPath,
                    log
                );
                if (syncedSubdirs.length > 0) {
                    result.modules.push(`${depName}/${syncedSubdirs.join(', ')}`);
                }
            }
        } catch (err) {
            result.errors.push(`${depName}: ${err.message}`);
        }
    }

    result.synced = result.modules.length > 0;
    if (result.synced) {
        log(`[deps-core] ${agentName}: Synced: ${result.modules.join(', ')}`);
    }

    return result;
}


/**
 * Merge two package.json objects, with core dependencies taking precedence.
 * @param {object} corePackage - The core package.json (takes precedence)
 * @param {object} agentPackage - The agent's package.json
 * @returns {object} Merged package.json
 */
function mergePackageJson(corePackage, agentPackage) {
    const merged = { ...corePackage };

    // Merge dependencies, with core taking precedence
    if (agentPackage.dependencies) {
        merged.dependencies = {
            ...agentPackage.dependencies,
            ...corePackage.dependencies  // Core dependencies override agent dependencies
        };
    }

    // Merge devDependencies if present
    if (agentPackage.devDependencies) {
        merged.devDependencies = {
            ...(merged.devDependencies || {}),
            ...agentPackage.devDependencies
        };
    }

    // Keep agent's scripts
    if (agentPackage.scripts) {
        merged.scripts = agentPackage.scripts;
    }

    // Use agent's name if available
    if (agentPackage.name) {
        merged.name = agentPackage.name;
    }

    return merged;
}

/**
 * Setup the agent working directory on the host.
 * @param {string} agentName - The agent name
 * @returns {string} The path to the agent working directory
 */
function setupAgentWorkDir(agentName) {
    const workDir = getAgentWorkDir(agentName);
    if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
    }
    return workDir;
}

/**
 * Check if npm install needs to be run.
 * @param {string} containerName - The container name
 * @param {string} agentName - The agent name
 * @returns {{ needsInstall: boolean, reason: string }}
 */
function needsReinstall(containerName, agentName) {
    // Check if package.json exists in /code
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { needsInstall: false, reason: 'No package.json found in /code' };
    }

    // Check if node_modules exists
    if (!dirExistsInContainer(containerName, '/code/node_modules')) {
        return { needsInstall: true, reason: 'node_modules directory does not exist' };
    }

    // Check if node_modules is empty
    try {
        const output = dockerExec(containerName, 'ls /code/node_modules 2>/dev/null | head -1');
        if (!output) {
            return { needsInstall: true, reason: 'node_modules directory is empty' };
        }
    } catch (_) {
        return { needsInstall: true, reason: 'Cannot read node_modules directory' };
    }

    return { needsInstall: false, reason: 'Dependencies already installed' };
}

/**
 * Resolve the host path to an agent's package.json.
 * @param {string} agentName - The agent name
 * @param {string} [agentPath] - Optional agent root path
 * @returns {string|null} The package.json path or null if not found
 */
function resolveAgentPackagePath(agentName, agentPath) {
    const candidates = [
        path.join(getAgentCodePath(agentName), 'package.json'),
        agentPath ? path.join(agentPath, 'code', 'package.json') : null,
        agentPath ? path.join(agentPath, 'package.json') : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Check if npm install needs to be run based on host filesystem state.
 * @param {string} agentName - The agent name
 * @param {object} [options] - Options
 * @param {string} [options.agentPath] - Optional agent root path
 * @param {string} [options.packagePath] - Optional resolved package.json path
 * @returns {{ needsInstall: boolean, reason: string }}
 */
function needsHostInstall(agentName, options = {}) {
    const { agentPath, packagePath } = options;
    const resolvedPackagePath = packagePath || resolveAgentPackagePath(agentName, agentPath);

    if (!resolvedPackagePath) {
        return { needsInstall: false, reason: 'No package.json found' };
    }

    const nodeModulesPath = path.join(getAgentWorkDir(agentName), 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
        return { needsInstall: true, reason: 'node_modules directory does not exist' };
    }

    try {
        const entries = fs.readdirSync(nodeModulesPath);
        if (!entries.length) {
            return { needsInstall: true, reason: 'node_modules directory is empty' };
        }
    } catch (_) {
        return { needsInstall: true, reason: 'Cannot read node_modules directory' };
    }

    return { needsInstall: false, reason: 'Dependencies already installed' };
}

/**
 * Run npm install in a container at the specified working directory.
 * @param {string} containerName - The container name
 * @param {string} workDir - Working directory (host path accessible in container via CWD mount)
 * @param {function} log - Logging function
 * @returns {{ success: boolean, message: string }}
 */
function runNpmInstallInContainer(containerName, workDir, log = debugLog) {
    try {
        log(`[deps] Running npm install in ${workDir}...`);
        execSync(`${containerRuntime} exec -w "${workDir}" ${containerName} npm install`, {
            stdio: 'inherit',
            timeout: 600000 // 10 minute timeout
        });
        return { success: true, message: 'npm install completed' };
    } catch (err) {
        console.error(`[deps] npm install failed: ${err.message}`);
        return { success: false, message: `npm install failed: ${err.message}` };
    }
}

/**
 * Install dependencies inside a running container.
 * Uses CWD mount to write directly to host filesystem at $CWD/agents/<agent>/.
 *
 * This follows the spec:
 * 1. Copy core package.json (4 global deps) to $CWD/agents/<agent>/package.json
 * 2. Run npm install in $CWD/agents/<agent>/
 * 3. If agent has package.json in /code, merge and run npm install again
 *
 * @param {string} containerName - The container name
 * @param {string} agentName - The agent name
 * @param {object} options - Options
 * @returns {{ success: boolean, message: string }}
 */
function installDependencies(containerName, agentName, options = {}) {
    const { force = false, verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    const agentWorkDir = getAgentWorkDir(agentName);  // $CWD/agents/<agent>/
    const nodeModulesPath = path.join(agentWorkDir, 'node_modules');
    const mcpSdkPath = path.join(nodeModulesPath, 'mcp-sdk');
    const hasCoreModules = fs.existsSync(mcpSdkPath);

    // Check if agent has package.json in source
    const hasAgentPackage = fileExistsInContainer(containerName, '/code/package.json');

    // Use cached if available
    if (!force && hasCoreModules && !hasAgentPackage) {
        log(`[deps] Using cached core node_modules for ${agentName}`);
        return { success: true, message: 'Using cached core node_modules' };
    }

    try {
        // Ensure agent work dir exists inside container (via CWD mount)
        dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

        // Step 1: Copy core package.json and install (4 global deps)
        if (!hasCoreModules || force) {
            log(`[deps] Installing core dependencies for ${agentName}...`);
            const corePackage = readPackageBaseTemplate();
            const corePackagePath = path.join(agentWorkDir, 'package.json');

            // Copy core package.json inside container
            writeFileInContainer(containerName, corePackagePath, JSON.stringify(corePackage, null, 2));

            const coreResult = runNpmInstallInContainer(containerName, agentWorkDir, log);
            if (!coreResult.success) {
                return coreResult;
            }
        }

        // Step 2: If agent has package.json, copy from /code and install (adds to existing node_modules)
        if (hasAgentPackage) {
            log(`[deps] Installing agent dependencies for ${agentName}...`);

            const agentPackagePath = path.join(agentWorkDir, 'package.json');
            // Copy agent's package.json from /code to agent work dir inside container
            dockerExec(containerName, `cp /code/package.json "${agentPackagePath}"`);

            const agentResult = runNpmInstallInContainer(containerName, agentWorkDir, log);
            if (!agentResult.success) {
                return agentResult;
            }
        }

        log(`[deps] Dependencies installed successfully for ${agentName}`);
        return { success: true, message: 'Dependencies installed successfully' };

    } catch (err) {
        console.error(`[deps] Failed to install dependencies for ${agentName}: ${err.message}`);
        return { success: false, message: `Installation failed: ${err.message}` };
    }
}

/**
 * Install core dependencies only (without agent dependencies).
 * All operations run inside the container via CWD mount.
 *
 * @param {string} containerName - The container name
 * @param {string} agentName - The agent name
 * @returns {{ success: boolean, message: string }}
 */
function installCoreDependencies(containerName, agentName) {
    try {
        debugLog(`[deps] Installing core dependencies for ${agentName}...`);

        const agentWorkDir = getAgentWorkDir(agentName);

        // Ensure agent work dir exists inside container
        dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

        // Copy core package.json inside container
        const corePackage = readPackageBaseTemplate();
        const corePackagePath = path.join(agentWorkDir, 'package.json');
        writeFileInContainer(containerName, corePackagePath, JSON.stringify(corePackage, null, 2));

        // Run npm install inside container
        return runNpmInstallInContainer(containerName, agentWorkDir, debugLog);
    } catch (err) {
        return { success: false, message: `Core installation failed: ${err.message}` };
    }
}

/**
 * Install agent-specific dependencies.
 * Copies agent's package.json from /code and runs npm install (adds to existing node_modules).
 * All operations run inside the container via CWD mount.
 *
 * @param {string} containerName - The container name
 * @param {string} agentName - The agent name
 * @returns {{ success: boolean, message: string }}
 */
function installAgentDependencies(containerName, agentName) {
    // Check if agent has a package.json
    if (!fileExistsInContainer(containerName, '/code/package.json')) {
        return { success: true, message: 'No agent package.json found' };
    }

    try {
        debugLog(`[deps] Installing agent dependencies for ${agentName}...`);

        const agentWorkDir = getAgentWorkDir(agentName);

        // Ensure agent work dir exists inside container
        dockerExec(containerName, `mkdir -p "${agentWorkDir}"`);

        // Copy agent's package.json from /code to agent work dir inside container
        const agentPackagePath = path.join(agentWorkDir, 'package.json');
        dockerExec(containerName, `cp /code/package.json "${agentPackagePath}"`);

        // Run npm install inside container (adds to existing node_modules)
        return runNpmInstallInContainer(containerName, agentWorkDir, debugLog);
    } catch (err) {
        return { success: false, message: `Agent installation failed: ${err.message}` };
    }
}

/**
 * Sync node_modules from source repo to agent working directory.
 * This ensures that any modules in the source repo (like achillesAgentLib subdirectories)
 * are properly copied to the agent's node_modules.
 *
 * @param {string} agentName - The agent name
 * @param {string} sourceCodePath - Path to the source code (with node_modules)
 * @param {object} options - Options
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {{ synced: boolean, modules: string[], errors: string[] }}
 */
function syncSourceNodeModules(agentName, sourceCodePath, options = {}) {
    const { verbose = false } = options;
    const log = verbose ? console.log : debugLog;

    const sourceNodeModules = path.join(sourceCodePath, 'node_modules');
    const agentWorkDir = getAgentWorkDir(agentName);
    const agentNodeModules = path.join(agentWorkDir, 'node_modules');

    const result = { synced: false, modules: [], errors: [] };

    // Check if source has node_modules
    if (!fs.existsSync(sourceNodeModules)) {
        log(`[deps-sync] ${agentName}: No source node_modules at ${sourceNodeModules}`);
        return result;
    }

    // Ensure agent node_modules exists
    if (!fs.existsSync(agentNodeModules)) {
        fs.mkdirSync(agentNodeModules, { recursive: true });
    }

    try {
        const sourceModules = fs.readdirSync(sourceNodeModules);

        for (const moduleName of sourceModules) {
            // Skip hidden files and package-lock
            if (moduleName.startsWith('.') || moduleName === 'package-lock.json') {
                continue;
            }

            const sourceModulePath = path.join(sourceNodeModules, moduleName);
            const agentModulePath = path.join(agentNodeModules, moduleName);

            // Skip if not a directory
            if (!fs.statSync(sourceModulePath).isDirectory()) {
                continue;
            }

            try {
                if (!fs.existsSync(agentModulePath)) {
                    // Module doesn't exist in agent, copy entirely
                    log(`[deps-sync] ${agentName}: Copying missing module ${moduleName}`);
                    if (typeof fs.cpSync === 'function') {
                        fs.cpSync(sourceModulePath, agentModulePath, { recursive: true });
                    } else {
                        execSync(`cp -a "${sourceModulePath}" "${agentModulePath}"`);
                    }
                    result.modules.push(moduleName);
                } else {
                    // Module exists, sync any missing subdirectories
                    const syncedSubdirs = syncModuleSubdirectories(
                        moduleName,
                        sourceModulePath,
                        agentModulePath,
                        log
                    );
                    if (syncedSubdirs.length > 0) {
                        result.modules.push(`${moduleName}/${syncedSubdirs.join(', ')}`);
                    }
                }
            } catch (err) {
                result.errors.push(`${moduleName}: ${err.message}`);
            }
        }

        result.synced = result.modules.length > 0;
        if (result.synced) {
            log(`[deps-sync] ${agentName}: Synced modules: ${result.modules.join(', ')}`);
        }

    } catch (err) {
        result.errors.push(`Failed to read source node_modules: ${err.message}`);
    }

    return result;
}

/**
 * Sync subdirectories of a module that might be missing in the target.
 * This handles cases like achillesAgentLib where subdirectories like
 * CodeGenerationSkillsSubsystem might not be present after npm install.
 *
 * @param {string} moduleName - The module name (for logging)
 * @param {string} sourcePath - Source module path
 * @param {string} targetPath - Target module path
 * @param {Function} log - Logger function
 * @returns {string[]} List of synced subdirectory names
 */
function syncModuleSubdirectories(moduleName, sourcePath, targetPath, log = debugLog) {
    const synced = [];

    try {
        const sourceEntries = fs.readdirSync(sourcePath);

        for (const entry of sourceEntries) {
            // Skip hidden files, node_modules, and common non-essential files
            if (entry.startsWith('.') ||
                entry === 'node_modules' ||
                entry === 'package-lock.json') {
                continue;
            }

            const sourceEntryPath = path.join(sourcePath, entry);
            const targetEntryPath = path.join(targetPath, entry);

            // Only sync directories
            if (!fs.statSync(sourceEntryPath).isDirectory()) {
                continue;
            }

            if (!fs.existsSync(targetEntryPath)) {
                log(`[deps-sync] Copying missing subdir ${moduleName}/${entry}`);
                if (typeof fs.cpSync === 'function') {
                    fs.cpSync(sourceEntryPath, targetEntryPath, { recursive: true });
                } else {
                    execSync(`cp -a "${sourceEntryPath}" "${targetEntryPath}"`);
                }
                synced.push(entry);
            } else {
                // Recursively check subdirectories for modules like achillesAgentLib
                // that have deeply nested structure
                const nestedSynced = syncModuleSubdirectories(
                    `${moduleName}/${entry}`,
                    sourceEntryPath,
                    targetEntryPath,
                    log
                );
                if (nestedSynced.length > 0) {
                    synced.push(...nestedSynced.map(s => `${entry}/${s}`));
                }
            }
        }
    } catch (err) {
        log(`[deps-sync] Error syncing ${moduleName} subdirs: ${err.message}`);
    }

    return synced;
}

/**
 * Run manifest install command in a container that persists changes.
 * This creates a container, runs the install command, and commits the changes
 * to the agent's working directory.
 *
 * @param {string} agentName - The agent name
 * @param {string} image - Container image
 * @param {string} installCommand - The install command from manifest
 * @param {object} options - Options
 * @param {string} options.agentPath - Path to agent source
 * @param {string} options.cwd - Working directory
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {{ success: boolean, message: string }}
 */
function runPersistentInstall(agentName, image, installCommand, options = {}) {
    const { agentPath, cwd, verbose = false, forceInstall = false } = options;
    const log = verbose ? console.log : debugLog;

    if (!installCommand || !installCommand.trim()) {
        return { success: true, message: 'No install command' };
    }

    const runtime = containerRuntime;
    const agentWorkDir = getAgentWorkDir(agentName);
    const agentCodePath = getAgentCodePath(agentName);

    // Resolve symlink to get actual path - this ensures changes persist correctly
    // The code path might be a symlink like $CWD/code/agent -> .ploinky/repos/repo/agent
    // Container volumes with symlinks can have issues, so we resolve to the real path
    let resolvedCodePath = agentCodePath;
    try {
        if (fs.existsSync(agentCodePath)) {
            const stat = fs.lstatSync(agentCodePath);
            if (stat.isSymbolicLink()) {
                resolvedCodePath = fs.realpathSync(agentCodePath);
                log(`[install] ${agentName}: Resolved code path: ${agentCodePath} -> ${resolvedCodePath}`);
            }
        }
    } catch (err) {
        log(`[install] ${agentName}: Warning - could not resolve symlink: ${err.message}`);
    }

    // Ensure work directory exists
    if (!fs.existsSync(agentWorkDir)) {
        fs.mkdirSync(agentWorkDir, { recursive: true });
    }

    const sanitizedName = String(agentName || 'agent')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-');
    const containerName = `ploinky-install-${sanitizedName}-${Date.now()}`;
    const volZ = runtime === 'podman' ? ':z' : '';

    // Mount the resolved code path as /code with rw so install scripts can write
    // This ensures git clone, npm install, etc. persist to the host filesystem
    // Use cwd as install workdir if provided (for npm install to write to $cwd/node_modules)
    const installWorkdir = cwd || process.env.PLOINKY_INSTALL_WORKDIR || '/code';

    // Ensure node_modules directory exists before mounting
    const nodeModulesDir = path.join(agentWorkDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        fs.mkdirSync(nodeModulesDir, { recursive: true });
    }

    const args = ['run', '-d', '--name', containerName, '-w', installWorkdir,
        '-v', `${resolvedCodePath}:/code${volZ}`,  // rw - resolved path ensures changes persist
        '-v', `${nodeModulesDir}:/code/node_modules${volZ}`,  // rw - npm install writes to agent workdir node_modules
        '-v', `${agentWorkDir}:${agentWorkDir}${volZ}`,  // rw - CWD passthrough for runtime data
        '-e', `WORKSPACE_PATH=${agentWorkDir}`,  // Set WORKSPACE_PATH for install scripts
    ];

    // If cwd is different from agentWorkDir, also mount cwd so install can write there
    if (cwd && cwd !== agentWorkDir) {
        args.push('-v', `${cwd}:${cwd}${volZ}`);
    }

    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
        args.splice(1, 0, '--replace');
    }

    args.push(image, 'sh', '-c', 'tail -f /dev/null');

    log(`[install] ${agentName}: Starting install container...`);
    const startResult = spawnSync(runtime, args, { stdio: 'inherit' });
    if (startResult.status !== 0) {
        return { success: false, message: `Install container failed to start with code ${startResult.status}` };
    }

    try {
        // Ensure git is available as a fallback for repos that don't have it in preinstall
        // This is needed for npm install with github dependencies
        const gitResult = ensureGitAvailable(containerName, log);
        if (!gitResult.success) {
            log(`[install] ${agentName}: Warning - ${gitResult.message}`);
        }

        // If running npm install in a different dir than /code, copy package.json first
        // This allows npm to find dependencies while installing to the correct location
        if (installWorkdir !== '/code' && installCommand.includes('npm install')) {
            const copyResult = spawnSync(runtime, [
                'exec', containerName, 'sh', '-c',
                `test -f /code/package.json && mkdir -p "${installWorkdir}" && cp /code/package.json "${installWorkdir}/" || true`
            ], { stdio: 'inherit' });
            if (copyResult.status === 0) {
                log(`[install] ${agentName}: Copied package.json from /code to ${installWorkdir}`);
            }
        }

        // Run the install command
        log(`[install] ${agentName}: Running in ${installWorkdir}: ${installCommand}`);
        const execResult = spawnSync(runtime, [
            'exec', '-w', installWorkdir, containerName,
            'sh', '-lc', installCommand
        ], { stdio: 'inherit', timeout: 600000 });

        if (execResult.status !== 0) {
            return { success: false, message: `Install command failed with code ${execResult.status}` };
        }

        log(`[install] ${agentName}: Install completed successfully`);
        return { success: true, message: 'Install completed' };

    } finally {
        // Clean up the container - stop first with short timeout, then remove
        try {
            execSync(`${runtime} stop -t 2 ${containerName}`, { stdio: 'ignore', timeout: 10000 });
        } catch (_) {}
        try {
            execSync(`${runtime} rm -f ${containerName}`, { stdio: 'ignore', timeout: 10000 });
        } catch (_) {}
    }
}

/**
 * Read the global dependencies package.json.
 * @returns {object} The parsed global package.json
 */
function readGlobalDepsPackage() {
    const globalPackagePath = path.join(GLOBAL_DEPS_PATH, 'package.json');
    if (fs.existsSync(globalPackagePath)) {
        return JSON.parse(fs.readFileSync(globalPackagePath, 'utf8'));
    }
    // Fall back to base template if globalDeps doesn't exist
    return readPackageBaseTemplate();
}

/**
 * Install dependencies inside a container.
 * This is the main container-based installation function that:
 * 1. Copies global package.json to agent work dir
 * 2. Merges agent's package.json if it exists (agent deps override global)
 * 3. Runs npm install inside a temporary container
 *
 * @param {string} agentName - The agent name
 * @param {string} containerImage - The container image to use
 * @param {object} options - Options
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {boolean} [options.force=false] - Force reinstall even if cached
 * @returns {{ success: boolean, message: string }}
 */
function installDependenciesInContainer(agentName, containerImage, options = {}) {
    const { verbose = false, force = false } = options;
    const log = verbose ? console.log : debugLog;
    const runtime = containerRuntime;

    // Check if npm is available in the container image before proceeding
    try {
        const checkResult = spawnSync(runtime, [
            'run', '--rm', containerImage, 'sh', '-c', 'command -v npm'
        ], { stdio: 'pipe', timeout: 30000 });

        if (checkResult.status !== 0) {
            log(`[deps] ${agentName}: Skipping core dependencies (npm not available in container)`);
            return { success: true, message: 'Skipped - npm not available in container' };
        }
    } catch (err) {
        log(`[deps] ${agentName}: Skipping core dependencies (could not check npm: ${err.message})`);
        return { success: true, message: 'Skipped - could not verify npm availability' };
    }

    const agentWorkDir = getAgentWorkDir(agentName);
    const agentCodePath = getAgentCodePath(agentName);
    const nodeModulesDir = path.join(agentWorkDir, 'node_modules');
    const workDirPackageJson = path.join(agentWorkDir, 'package.json');

    // Check if we can skip installation (cached node_modules exist)
    const mcpSdkPath = path.join(nodeModulesDir, 'mcp-sdk');
    if (!force && fs.existsSync(mcpSdkPath)) {
        log(`[deps] ${agentName}: Using cached node_modules`);
        return { success: true, message: 'Using cached node_modules' };
    }

    // Ensure directories exist
    if (!fs.existsSync(agentWorkDir)) {
        fs.mkdirSync(agentWorkDir, { recursive: true });
    }
    if (!fs.existsSync(nodeModulesDir)) {
        fs.mkdirSync(nodeModulesDir, { recursive: true });
    }

    // Step 1: Copy global package.json to agent work dir
    log(`[deps] ${agentName}: Preparing package.json with global dependencies...`);
    const globalPkg = readGlobalDepsPackage();

    // Step 2: Check for agent-specific package.json and merge
    const agentCodePackageJson = path.join(agentCodePath, 'package.json');
    if (fs.existsSync(agentCodePackageJson)) {
        log(`[deps] ${agentName}: Merging agent-specific dependencies...`);
        const agentPkg = JSON.parse(fs.readFileSync(agentCodePackageJson, 'utf8'));

        // Agent deps override global (agent takes precedence for conflicts)
        globalPkg.dependencies = {
            ...globalPkg.dependencies,
            ...(agentPkg.dependencies || {})
        };

        if (agentPkg.devDependencies) {
            globalPkg.devDependencies = {
                ...(globalPkg.devDependencies || {}),
                ...agentPkg.devDependencies
            };
        }

        // Preserve agent's name if available
        if (agentPkg.name) {
            globalPkg.name = agentPkg.name;
        }
    }

    // Write merged package.json to agent work dir
    fs.writeFileSync(workDirPackageJson, JSON.stringify(globalPkg, null, 2));

    // Step 3: Run npm install inside TEMPORARY container (removed after)
    const sanitizedName = String(agentName || 'agent')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-');
    const tempContainerName = `ploinky-deps-${sanitizedName}-${Date.now()}`;
    const volZ = runtime === 'podman' ? ':z' : '';

    const args = [
        'run', '--rm',
        '--name', tempContainerName,
        '-v', `${agentWorkDir}:/install${volZ}`,
        '-w', '/install',
    ];

    if (runtime === 'podman') {
        args.splice(1, 0, '--network', 'slirp4netns:allow_host_loopback=true');
    }

    // Use a shell script that ensures git and build tools are available before running npm install
    // Git is needed for github: dependencies
    // Build tools (python3, make, g++) are needed for native modules like node-pty
    const installScript = [
        '(',
        '  command -v git >/dev/null 2>&1 ||',
        '  (command -v apk >/dev/null 2>&1 && apk add --no-cache git python3 make g++) ||',
        '  (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install -y git python3 make g++)',
        ') 2>/dev/null',
        '&& npm install'
    ].join(' ');

    args.push(containerImage, 'sh', '-c', installScript);

    log(`[deps] ${agentName}: Running npm install in container...`);
    try {
        const result = spawnSync(runtime, args, { stdio: 'inherit', timeout: 600000 });
        if (result.status !== 0) {
            return { success: false, message: `npm install failed with code ${result.status}` };
        }
        log(`[deps] ${agentName}: Dependencies installed successfully`);
        return { success: true, message: 'Dependencies installed successfully' };
    } catch (err) {
        return { success: false, message: `npm install failed: ${err.message}` };
    }
}

export {
    dockerExec,
    fileExistsInContainer,
    dirExistsInContainer,
    readPackageBaseTemplate,
    readGlobalDepsPackage,
    mergePackageJson,
    setupAgentWorkDir,
    needsReinstall,
    needsHostInstall,
    installDependencies,
    installDependenciesInContainer,
    installCoreDependencies,
    installAgentDependencies,
    syncSourceNodeModules,
    syncModuleSubdirectories,
    syncCoreDependencies,
    getCoreDependencyNames,
    runPersistentInstall
};
