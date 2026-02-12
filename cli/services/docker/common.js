import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { REPOS_DIR, PLOINKY_DIR, WORKSPACE_ROOT } from '../config.js';
import { getAgentWorkDir } from '../workspaceStructure.js';
import { buildEnvFlags, buildEnvMap } from '../secretVars.js';
import { loadAgents, saveAgents } from '../workspace.js';
import { debugLog } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPathUnderRoot(candidate) {
    if (!candidate) return false;
    const root = path.resolve(WORKSPACE_ROOT);
    const resolved = path.resolve(candidate);
    const relative = path.relative(root, resolved);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeProjectPath(candidate, runMode) {
    if (!candidate || typeof candidate !== 'string') return '';
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) return '';
    if (runMode === 'isolated' && !isPathUnderRoot(resolved)) {
        return '';
    }
    return resolved;
}

function getConfiguredProjectPath(agentName, repoName, alias) {
    if (!agentName || agentName === '.') {
        return WORKSPACE_ROOT;
    }
    try {
        const map = loadAgentsMap();
        if (alias) {
            const aliasRec = Object.values(map || {}).find(r => r && r.type === 'agent' && r.alias === alias);
            if (aliasRec && aliasRec.projectPath && typeof aliasRec.projectPath === 'string') {
                const normalized = normalizeProjectPath(aliasRec.projectPath, aliasRec.runMode);
                if (normalized) return normalized;
            }
        }
        const rec = Object.values(map || {}).find(r => r && r.type === 'agent' && r.agentName === agentName && r.repoName === repoName);
        if (rec && rec.projectPath && typeof rec.projectPath === 'string') {
            const normalized = normalizeProjectPath(rec.projectPath, rec.runMode);
            if (normalized) return normalized;
        }
    } catch (_) {}
    const fallback = getAgentWorkDir(agentName);
    try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
    return fallback;
}

function isRuntimeInstalled(runtime) {
    try {
        execSync(`command -v ${runtime}`, { stdio: 'ignore' });
        return true;
    } catch (_) {
        return false;
    }
}

function getContainerRuntime() {
    const preferredRuntimes = ['podman', 'docker'];
    for (const runtime of preferredRuntimes) {
        if (isRuntimeInstalled(runtime)) {
            debugLog(`Using ${runtime} as container runtime.`);
            return runtime;
        }
    }
    console.error('Neither podman nor docker found in PATH. Please install one of them.');
    process.exit(1);
}

const containerRuntime = getContainerRuntime();
const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));
const CONTAINER_CONFIG_DIR = '/code';
const CONTAINER_CONFIG_PATH = `${CONTAINER_CONFIG_DIR}/mcp-config.json`;

function loadAgentsMap() {
    return loadAgents();
}

function saveAgentsMap(map) {
    return saveAgents(map);
}

function getAgentContainerName(agentName, repoName) {
    const safeAgentName = String(agentName || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeRepoName = String(repoName || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const cwdHash = crypto.createHash('sha256')
        .update(WORKSPACE_ROOT)
        .digest('hex')
        .substring(0, 8);
    const projectDir = path.basename(WORKSPACE_ROOT).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const containerName = `ploinky_${safeRepoName}_${safeAgentName}_${projectDir}_${cwdHash}`;
    debugLog(`Calculated container name: ${containerName} (for path: ${WORKSPACE_ROOT})`);
    return containerName;
}

function isContainerRunning(containerName) {
    const command = `${containerRuntime} ps --format "{{.Names}}" | grep -x "${containerName}"`;
    debugLog(`Checking if container is running with command: ${command}`);
    try {
        const result = execSync(command, { stdio: 'pipe' }).toString();
        const running = result.trim().length > 0;
        debugLog(`Container '${containerName}' is running: ${running}`);
        return running;
    } catch (error) {
        debugLog(`Container '${containerName}' is not running (grep failed)`);
        return false;
    }
}

function containerExists(containerName) {
    // Use inspect instead of grep - more reliable and avoids race conditions
    const command = `${containerRuntime} inspect --format "{{.Name}}" "${containerName}"`;
    debugLog(`Checking if container exists with command: ${command}`);
    try {
        execSync(command, { stdio: 'pipe' });
        debugLog(`Container '${containerName}' exists: true`);
        return true;
    } catch (error) {
        debugLog(`Container '${containerName}' does not exist`);
        return false;
    }
}

function getSecretsForAgent(manifest) {
    const vars = buildEnvFlags(manifest);
    debugLog(`Formatted env vars for ${containerRuntime} command: ${vars.join(' ')}`);
    return vars;
}

function getAgentMcpConfigPath(agentPath) {
    const candidate = path.join(agentPath, 'mcp-config.json');
    try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    } catch (_) {}
    return null;
}

function syncAgentMcpConfig(_containerName, agentPath, agentName) {
    try {
        const source = getAgentMcpConfigPath(agentPath);
        if (!source) return false;
        const resolvedAgentName = agentName || path.basename(agentPath || '');
        if (!resolvedAgentName) return false;
        const workDir = getAgentWorkDir(resolvedAgentName);
        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }
        const target = path.join(workDir, 'mcp-config.json');
        fs.copyFileSync(source, target);
        return true;
    } catch (_) {
        return false;
    }
}

function flagsToArgs(flags) {
    const out = [];
    for (const flag of flags || []) {
        if (!flag) continue;
        const str = String(flag);
        let current = '';
        let quote = null;
        for (let i = 0; i < str.length; i += 1) {
            const ch = str[i];
            if (quote) {
                if (ch === quote) {
                    quote = null;
                    continue;
                }
                if (ch === '\\' && quote === '"' && i + 1 < str.length) {
                    const next = str[i + 1];
                    if (next === 'n') {
                        current += '\n';
                        i += 1;
                        continue;
                    }
                    if (/["\\$`]/.test(next)) {
                        current += next;
                        i += 1;
                        continue;
                    }
                }
                current += ch;
                continue;
            }
            if (ch === '"' || ch === '\'') {
                quote = ch;
                continue;
            }
            if (/\s/.test(ch)) {
                if (current) {
                    out.push(current);
                    current = '';
                }
                continue;
            }
            current += ch;
        }
        if (current) {
            out.push(current);
        }
    }
    return out;
}

function sleepMs(ms) {
    Atomics.wait(SLEEP_ARRAY, 0, 0, ms);
}

function parseManifestPorts(manifest, profileConfig = null) {
    // Ports must be defined in profile configuration
    const ports = profileConfig?.ports;
    if (!ports) return { publishArgs: [], portMappings: [] };

    const portArray = Array.isArray(ports) ? ports : [ports];
    const publishArgs = [];
    const portMappings = [];

    for (const p of portArray) {
        if (!p) continue;
        const portSpec = String(p).trim();
        if (!portSpec) continue;

        const parts = portSpec.split(':');
        let hostIp = '127.0.0.1';  // Default to localhost for security
        let hostPort;
        let containerPort;
        if (parts.length === 1) {
            hostPort = containerPort = parseInt(parts[0], 10);
        } else if (parts.length === 2) {
            hostPort = parseInt(parts[0], 10);
            containerPort = parseInt(parts[1], 10);
        } else if (parts.length === 3) {
            hostIp = parts[0];  // Respect the specified IP address
            hostPort = parseInt(parts[1], 10);
            containerPort = parseInt(parts[2], 10);
        }
        if (hostPort && containerPort) {
            const normalized = `${hostIp}:${hostPort}:${containerPort}`;
            publishArgs.push(normalized);
            portMappings.push({ hostPort, containerPort, hostIp });
        }
    }

    return { publishArgs, portMappings };
}

function parseHostPort(output) {
    try {
        if (!output) return 0;
        const firstLine = String(output).split(/\n+/)[0].trim();
        const match = firstLine.match(/(\d+)\s*$/);
        return match ? parseInt(match[1], 10) : 0;
    } catch (_) {
        return 0;
    }
}

function computeEnvHash(manifest, profileConfig) {
    try {
        const map = buildEnvMap(manifest, profileConfig || null);
        const sorted = Object.keys(map).sort().reduce((acc, key) => {
            acc[key] = map[key];
            return acc;
        }, {});
        const data = JSON.stringify(sorted);
        return crypto.createHash('sha256').update(data).digest('hex');
    } catch (_) {
        return '';
    }
}

function getContainerLabel(containerName, key) {
    try {
        const out = execSync(`${containerRuntime} inspect ${containerName} --format '{{ json .Config.Labels }}'`, { stdio: 'pipe' }).toString();
        const labels = JSON.parse(out || '{}') || {};
        return labels[key] || '';
    } catch (_) {
        return '';
    }
}

function waitForContainerRunning(containerName, maxAttempts = 20, delayMs = 250) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const status = execSync(`${containerRuntime} inspect ${containerName} --format '{{ .State.Status }}'`, { stdio: 'pipe' })
                .toString()
                .trim()
                .toLowerCase();
            if (status === 'running') {
                return true;
            }
        } catch (_) {}
        sleepMs(delayMs);
    }
    return false;
}

export {
    CONTAINER_CONFIG_DIR,
    CONTAINER_CONFIG_PATH,
    PLOINKY_DIR,
    REPOS_DIR,
    containerRuntime,
    containerExists,
    computeEnvHash,
    getAgentContainerName,
    getAgentMcpConfigPath,
    getConfiguredProjectPath,
    getContainerLabel,
    getRuntime,
    getSecretsForAgent,
    isContainerRunning,
    loadAgentsMap,
    parseHostPort,
    parseManifestPorts,
    saveAgentsMap,
    syncAgentMcpConfig,
    waitForContainerRunning,
    flagsToArgs,
    sleepMs
};

function getRuntime() {
    return containerRuntime;
}
