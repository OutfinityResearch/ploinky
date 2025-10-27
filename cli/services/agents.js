import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadAgents, saveAgents } from './workspace.js';
import {
    getAgentContainerName,
    parseManifestPorts,
    containerExists,
    isContainerRunning,
    collectLiveAgentContainers
} from './docker/index.js';
import { findAgent } from './utils.js';
import { REPOS_DIR } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeEnableArgs(agentName, mode, repoNameParam) {
    if (typeof agentName !== 'string') {
        return { agentName, mode, repoNameParam };
    }
    const trimmed = agentName.trim();
    if (!trimmed) {
        return { agentName: trimmed, mode, repoNameParam };
    }
    if (mode) {
        return { agentName: trimmed, mode, repoNameParam };
    }

    let parsedAgent = trimmed;
    let parsedMode = mode;
    let parsedRepo = repoNameParam;

    const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
    if (spaceTokens.length > 1) {
        const candidateMode = spaceTokens[1].toLowerCase();
        if (candidateMode === 'global' || candidateMode === 'devel') {
            parsedAgent = spaceTokens[0];
            parsedMode = candidateMode;
            if (candidateMode === 'devel' && parsedRepo === undefined) {
                const remainder = spaceTokens.slice(2).join(' ').trim();
                if (remainder) parsedRepo = remainder;
            }
        }
    }

    if (parsedMode) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const target = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (!target || !remainder) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const tokens = remainder.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const inferredMode = tokens[0].toLowerCase();
    if (inferredMode !== 'global' && inferredMode !== 'devel') {
        return { agentName: parsedAgent, mode: parsedMode, repoNameParam: parsedRepo };
    }

    const repoFromDirective = tokens.slice(1).join(' ');
    return {
        agentName: target,
        mode: inferredMode,
        repoNameParam: inferredMode === 'devel'
            ? (repoNameParam !== undefined ? repoNameParam : repoFromDirective)
            : (repoNameParam !== undefined ? repoNameParam : undefined)
    };
}

export function enableAgent(agentName, mode, repoNameParam) {
    const normalized = normalizeEnableArgs(agentName, mode, repoNameParam);
    const { manifestPath, repo: repoName, shortAgentName } = findAgent(normalized.agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    const containerName = getAgentContainerName(shortAgentName, repoName);

    const preinstallEntry = manifest?.preinstall;
    const preinstallCommands = Array.isArray(preinstallEntry)
        ? preinstallEntry.filter(cmd => typeof cmd === 'string' && cmd.trim())
        : (typeof preinstallEntry === 'string' && preinstallEntry.trim() ? [preinstallEntry] : []);

    if (preinstallCommands.length) {
        for (const cmd of preinstallCommands) {
            try {
                console.log(`Running preinstall for '${shortAgentName}': ${cmd}`);
                execSync(cmd, { cwd: agentPath, stdio: 'inherit' });
            } catch (error) {
                throw new Error(`preinstall command failed ('${cmd}'): ${error?.message || error}`);
            }
        }
    }

    const normalizedMode = (normalized.mode || '').toLowerCase();
    let runMode = 'isolated';
    let projectPath = '';

    if (!normalizedMode || normalizedMode === 'default') {
        try {
            const current = loadAgents();
            const existing = Object.values(current || {}).find(
                r => r && r.type === 'agent' && r.agentName === shortAgentName && r.repoName === repoName
            );
            if (existing && (!existing.runMode || existing.runMode === 'isolated') && existing.projectPath) {
                projectPath = existing.projectPath;
                runMode = 'isolated';
            }
        } catch (_) {}
        if (!projectPath) {
            runMode = 'isolated';
            projectPath = path.join(process.cwd(), shortAgentName);
            try { fs.mkdirSync(projectPath, { recursive: true }); } catch (_) {}
        }
    } else if (normalizedMode === 'global') {
        runMode = 'global';
        projectPath = process.cwd();
    } else if (normalizedMode === 'devel') {
        const repoCandidate = String(normalized.repoNameParam || '').trim();
        if (!repoCandidate) {
            throw new Error("enable agent devel: missing repoName. Usage: enable agent <name> devel <repoName>");
        }
        const repoPath = path.join(REPOS_DIR, repoCandidate);
        if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
            throw new Error(`Repository '${repoCandidate}' not found in ${path.join(REPOS_DIR)}`);
        }
        runMode = 'devel';
        projectPath = repoPath;
    } else {
        const errorMode = normalized.mode || mode || '';
        throw new Error(`Unknown mode '${errorMode}'. Allowed: global | devel`);
    }

    // Parse port mappings from manifest
    const { portMappings } = parseManifestPorts(manifest);
    // If no ports specified, use default 7000
    const ports = portMappings.length > 0 ? portMappings : [{ containerPort: 7000 }];
    
    const record = {
        agentName: shortAgentName,
        repoName,
        containerImage: manifest.container || manifest.image || 'node:18-alpine',
        createdAt: new Date().toISOString(),
        projectPath,
        runMode,
        develRepo: runMode === 'devel' ? String(normalized.repoNameParam || '') : undefined,
        type: 'agent',
        config: {
            binds: [
                { source: projectPath, target: projectPath },
                { source: path.resolve(__dirname, '../../../Agent'), target: '/Agent' },
                { source: agentPath, target: '/code' }
            ],
            env: [],
            ports
        }
    };
    const map = loadAgents();
    for (const key of Object.keys(map)) {
        const r = map[key];
        if (r && r.agentName === shortAgentName && key !== containerName) {
            try { delete map[key]; } catch (_) {}
        }
    }
    map[containerName] = record;
    saveAgents(map);
    return { containerName, repoName, shortAgentName };
}

export function disableAgent(agentRef) {
    const input = typeof agentRef === 'string' ? agentRef.trim() : '';
    if (!input) {
        throw new Error("disable agent: missing agent name. Usage: disable <agentName>");
    }

    const hasNamespace = /[:/]/.test(input);
    let targetRepo = null;
    let targetAgent = input;

    if (hasNamespace) {
        const parts = input.split(/[:/]/).filter(Boolean);
        if (parts.length !== 2) {
            throw new Error(`disable agent: invalid identifier '${input}'. Use <repo>/<agent>.`);
        }
        [targetRepo, targetAgent] = parts;
    }

    const map = loadAgents();
    const config = (map && typeof map._config === 'object') ? map._config : null;

    const clearStaticConfig = ({ repoName, shortName, containerName, rawInput }) => {
        if (!config || !config.static) return false;
        const comparisons = new Set();
        if (shortName) comparisons.add(String(shortName).trim().toLowerCase());
        if (repoName && shortName) {
            const repo = String(repoName).trim().toLowerCase();
            const short = String(shortName).trim().toLowerCase();
            comparisons.add(`${repo}/${short}`);
            comparisons.add(`${repo}:${short}`);
        }
        if (rawInput) comparisons.add(String(rawInput).trim().toLowerCase());

        const staticAgent = String(config.static.agent || '').trim().toLowerCase();
        const staticContainer = String(config.static.container || '').trim();

        const matchesAgent = staticAgent && (comparisons.has(staticAgent));
        const matchesContainer = containerName && staticContainer && staticContainer === containerName;

        if (!matchesAgent && !matchesContainer) return false;

        delete config.static;
        if (Object.keys(config).length === 0) {
            delete map._config;
        } else {
            map._config = config;
        }
        return true;
    };

    const entries = Object.entries(map || {})
        .filter(([key, value]) => key !== '_config' && value && typeof value === 'object')
        .filter(([, value]) => value.type === 'agent');

    const matches = entries.filter(([, value]) => {
        const repoName = String(value.repoName || '').trim();
        const agentName = String(value.agentName || '').trim();
        if (!agentName) return false;
        if (hasNamespace) {
            return agentName === targetAgent && repoName === targetRepo;
        }
        return agentName === targetAgent;
    });

    if (!matches.length) {
        const staticCleared = clearStaticConfig({ repoName: targetRepo, shortName: targetAgent, rawInput: input, containerName: null });
        if (staticCleared) {
            saveAgents(map);
            return {
                status: 'static-removed',
                requested: input
            };
        }
        return {
            status: 'not-found',
            requested: input
        };
    }

    if (!hasNamespace && matches.length > 1) {
        return {
            status: 'ambiguous',
            requested: input,
            matches: matches.map(([, value]) => `${value.repoName}/${value.agentName}`)
        };
    }

    const [containerName, record] = matches[0];

    let isActive = false;
    try {
        const liveSet = new Set((collectLiveAgentContainers() || []).map(item => item.containerName));
        if (liveSet.size && liveSet.has(containerName)) {
            isActive = true;
        }
    } catch (_) {}

    if (!isActive) {
        try {
            if (isContainerRunning(containerName)) {
                isActive = true;
            }
        } catch (_) {}
    }

    if (!isActive) {
        try {
            if (containerExists(containerName)) {
                isActive = true;
            }
        } catch (error) {
            // If we cannot determine container existence, err on the safe side
            isActive = true;
        }
    }

    if (isActive) {
        return {
            status: 'container-exists',
            containerName,
            shortAgentName: record.agentName,
            repoName: record.repoName
        };
    }

    delete map[containerName];

    clearStaticConfig({
        repoName: record.repoName,
        shortName: record.agentName,
        containerName,
        rawInput: input
    });

    saveAgents(map);
    return {
        status: 'removed',
        containerName,
        shortAgentName: record.agentName,
        repoName: record.repoName
    };
}
