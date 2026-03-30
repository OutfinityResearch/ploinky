import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../services/config.js';
import { showHelp } from '../services/help.js';
import * as reposSvc from '../services/repos.js';
import * as agentsSvc from '../services/agents.js';
import { collectAgentsSummary } from '../services/status.js';
import { findAgent } from '../services/utils.js';

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');

function getRepoNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    return fs.readdirSync(REPOS_DIR).filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
}

function getAgentNames() {
    const summary = collectAgentsSummary();
    if (!summary.length) return [];

    const catalog = [];
    for (const item of summary) {
        if (!item || !Array.isArray(item.agents)) continue;
        for (const agent of item.agents) {
            if (agent && agent.name) {
                catalog.push({ repo: agent.repo, name: agent.name });
            }
        }
    }

    if (!catalog.length) return [];

    const counts = {};
    for (const agent of catalog) {
        counts[agent.name] = (counts[agent.name] || 0) + 1;
    }

    const suggestions = new Set();
    for (const agent of catalog) {
        const repoName = agent.repo || '';
        if (repoName) {
            suggestions.add(`${repoName}/${agent.name}`);
            suggestions.add(`${repoName}:${agent.name}`);
        }
        if (counts[agent.name] === 1) {
            suggestions.add(agent.name);
        }
    }

    return Array.from(suggestions).sort();
}

function addRepo(repoName, repoUrl, branch = null) {
    if (!repoName) { showHelp(); throw new Error('Missing repository name.'); }
    const res = reposSvc.addRepo(repoName, repoUrl, branch);
    if (res.status === 'exists') console.log(`✓ Repository '${repoName}' already exists.`);
    else {
        const branchNote = branch ? ` (branch: ${branch})` : '';
        console.log(`✓ Repository '${repoName}' added successfully${branchNote}.`);
    }
}

async function updateRepo(repoName) {
    if (!repoName) throw new Error('Usage: update repo <name>');
    try {
        reposSvc.updateRepo(repoName);
        console.log(`✓ Repo '${repoName}' updated.`);
    } catch (err) {
        throw new Error(`update repo failed: ${err?.message || err}`);
    }
}

async function updateAllRepos() {
    const repos = getRepoNames();
    if (!repos.length) {
        console.log('No installed repositories to update.');
        return { total: 0, updated: 0, failed: [] };
    }

    const failed = [];
    let updated = 0;

    for (const repoName of repos) {
        try {
            reposSvc.updateRepo(repoName);
            console.log(`✓ Repo '${repoName}' updated.`);
            updated += 1;
        } catch (err) {
            const message = err?.message || String(err);
            failed.push({ repoName, message });
            console.error(`✗ Repo '${repoName}' update failed: ${message}`);
        }
    }

    console.log(`Update summary: ${updated}/${repos.length} repositories updated.`);

    if (failed.length) {
        const failedNames = failed.map(entry => entry.repoName).join(', ');
        throw new Error(`Failed to update ${failed.length} repository(s): ${failedNames}`);
    }

    return { total: repos.length, updated, failed };
}

function enableRepo(repoName, branch = null) {
    if (!repoName) throw new Error('Usage: enable repo <name> [branch]');
    reposSvc.enableRepo(repoName, branch);
    const branchNote = branch ? ` (branch: ${branch})` : '';
    console.log(`✓ Repo '${repoName}' enabled${branchNote}. Use 'list agents' to view agents.`);
}

function disableRepo(repoName) {
    if (!repoName) throw new Error('Usage: disable repo <name>');
    reposSvc.disableRepo(repoName);
    console.log(`✓ Repo '${repoName}' disabled.`);
}

async function enableAgent(agentName, mode, repoNameParam, alias, authMode, username, password) {
    if (!agentName) throw new Error('Usage: enable agent <name|repo/name> [global|devel [repoName]] [--auth none|pwd|sso] [--user <name> --password <value>] [as <alias>]');
    const { shortAgentName, repoName, alias: resolvedAlias, auth } = agentsSvc.enableAgent(agentName, mode, repoNameParam, alias, authMode, { username, password });
    const aliasNote = resolvedAlias ? ` as '${resolvedAlias}'` : '';
    const authLabel = auth?.mode === 'local' ? 'pwd' : (auth?.mode || 'none');
    console.log(`✓ Agent '${shortAgentName}' from repo '${repoName}' enabled${aliasNote} with auth '${authLabel}'. Use 'start' to start all configured agents.`);
    if (auth?.mode === 'local' && auth.usersVar) {
        console.log(`  Local auth users var: ${auth.usersVar}`);
        if (username) {
            console.log(`  Local auth user set to '${username}'.`);
        }
    }
}

function findAgentManifest(agentName) {
    const { manifestPath } = findAgent(agentName);
    return manifestPath;
}

export {
    getRepoNames,
    getAgentNames,
    addRepo,
    updateRepo,
    updateAllRepos,
    enableRepo,
    disableRepo,
    enableAgent,
    findAgentManifest,
};
