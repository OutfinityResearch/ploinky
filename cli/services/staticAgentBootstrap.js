import * as reposSvc from './repos.js';

const STATIC_AGENT_BOOTSTRAP_REPOS = new Map([
    ['explorer', 'AchillesIDE'],
]);

function parseAgentRef(agentRef) {
    const value = String(agentRef || '').trim();
    if (!value) return { repoName: null, agentName: null };

    const separatorIndex = value.search(/[:/]/);
    if (separatorIndex === -1) {
        return { repoName: null, agentName: value };
    }

    return {
        repoName: value.slice(0, separatorIndex),
        agentName: value.slice(separatorIndex + 1),
    };
}

export function getStaticAgentBootstrapRepo(agentRef) {
    const { repoName, agentName } = parseAgentRef(agentRef);
    const bootstrapRepo = STATIC_AGENT_BOOTSTRAP_REPOS.get(agentName);
    if (!bootstrapRepo) return null;
    if (repoName && repoName.toLowerCase() !== bootstrapRepo.toLowerCase()) return null;
    return bootstrapRepo;
}

export function ensureStaticAgentBootstrapRepo(agentRef, { enableRepo = reposSvc.enableRepo, log = console.log } = {}) {
    const repoName = getStaticAgentBootstrapRepo(agentRef);
    if (!repoName) return false;

    if (typeof log === 'function') {
        log(`Agent '${agentRef}' requires repo '${repoName}'. Enabling repo...`);
    }
    enableRepo(repoName);
    return true;
}
