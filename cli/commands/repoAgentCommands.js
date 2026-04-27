import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../services/config.js';
import { showHelp } from '../services/help.js';
import * as reposSvc from '../services/repos.js';
import * as agentsSvc from '../services/agents.js';
import * as skillsSvc from '../services/skills.js';
import {
    refreshAchillesDependenciesInRepos,
    resolvePloinkyRoot,
    updatePloinkySelf,
} from '../services/updateService.js';
import { collectAgentsSummary } from '../services/status.js';
import { findAgent } from '../services/utils.js';

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');
const SKILLS_REPO_NAME = 'AchillesCopilotBasicSkills';

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
        const repoPath = path.join(REPOS_DIR, repoName);
        const achilles = refreshAchillesDependenciesInRepos({ reposRoot: repoPath });
        if (achilles.failed.length) {
            const failedPackages = achilles.failed.map(entry => path.relative(repoPath, entry.packageDir) || '.').join(', ');
            throw new Error(`Failed to refresh achillesAgentLib in ${failedPackages}`);
        }
    } catch (err) {
        throw new Error(`update repo failed: ${err?.message || err}`);
    }
}

async function updateAllRepos(folderPath, options = {}) {
    const projectsRoot = resolveUpdateProjectsRoot(folderPath);
    const ploinkyRoot = resolvePloinkyRoot();
    const workspaceRepos = reposSvc.findWorkspaceGitRepos(projectsRoot)
        .filter(repo => !pathsReferToSameLocation(repo.path, ploinkyRoot));
    const ploinkyRepos = getRepoNames();
    const failed = [];
    let updated = 0;

    console.log('Updating Ploinky...');
    let selfUpdate = null;
    try {
        selfUpdate = updatePloinkySelf({
            interactiveSession: options.interactiveSession === true,
        });
        if (selfUpdate.deferred) {
            return {
                total: 0,
                updated: 0,
                failed: [],
                selfUpdate,
                deferred: true,
            };
        }
        if (selfUpdate.skipped) {
            console.log(`  - skipped (${selfUpdate.reason || 'not available'})`);
        } else if (selfUpdate.updated) {
            console.log('  ✓ Ploinky updated.');
            updated += 1;
        } else {
            console.log('  ✓ Ploinky already up to date.');
            updated += 1;
        }
    } catch (err) {
        const message = err?.message || String(err);
        failed.push({ repoName: 'ploinky', message });
        console.error(`  ✗ Ploinky: ${message}`);
    }

    if (ploinkyRepos.length) {
        console.log('Updating ploinky repositories...');
        for (const repoName of ploinkyRepos) {
            try {
                reposSvc.updateRepo(repoName);
                console.log(`  ✓ ${repoName}`);
                updated += 1;
            } catch (err) {
                const message = err?.message || String(err);
                failed.push({ repoName, message });
                console.error(`  ✗ ${repoName}: ${message}`);
            }
        }
    }

    if (workspaceRepos.length) {
        console.log(`Updating workspace repositories in ${projectsRoot}...`);
        for (const repo of workspaceRepos) {
            try {
                reposSvc.pullGitRepo(repo.path);
                console.log(`  ✓ ${repo.name}`);
                updated += 1;
            } catch (err) {
                const message = err?.message || String(err);
                failed.push({ repoName: repo.name, message });
                console.error(`  ✗ ${repo.name}: ${message}`);
            }
        }
    }

    const achilles = refreshAchillesDependenciesInRepos();
    if (achilles.failed.length) {
        for (const entry of achilles.failed) {
            failed.push({
                repoName: `achillesAgentLib ${path.relative(REPOS_DIR, entry.packageDir) || '.'}`,
                message: entry.message,
            });
        }
    }

    if (workspaceRepos.length) {
        console.log('Installing default skills into workspace repositories...');
        for (const repo of workspaceRepos) {
            try {
                const result = skillsSvc.installDefaultSkills(SKILLS_REPO_NAME, {
                    targetRoot: repo.path,
                });
                const skillNames = result.skills.join(', ');
                console.log(`  ✓ ${repo.name}: ${result.skills.length} skill(s) (${skillNames})`);
                if (result.gitignoreUpdated) {
                    console.log(`    .gitignore updated`);
                }
            } catch (err) {
                const message = err?.message || String(err);
                failed.push({ repoName: `${repo.name} skills`, message });
                console.error(`  ✗ ${repo.name} skills: ${message}`);
            }
        }
    }

    const totalRepos = 1 + ploinkyRepos.length + workspaceRepos.length;
    console.log(`Update summary: ${updated}/${totalRepos} repositories updated.`);
    if (achilles.total) {
        console.log(`Achilles dependency summary: ${achilles.refreshed.length}/${achilles.total} package(s) refreshed.`);
    }

    if (failed.length) {
        const failedNames = failed.map(entry => entry.repoName).join(', ');
        throw new Error(`Failed to update ${failed.length} repository(s): ${failedNames}`);
    }

    return { total: totalRepos, updated, failed, selfUpdate, achilles };
}

function pathsReferToSameLocation(first, second) {
    try {
        return fs.realpathSync(first) === fs.realpathSync(second);
    } catch (_) {
        return path.resolve(first) === path.resolve(second);
    }
}

function resolveUpdateProjectsRoot(folderPath) {
    const explicitRoot = typeof folderPath === 'string' ? folderPath.trim() : '';
    if (explicitRoot) return path.resolve(explicitRoot);
    return process.cwd();
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
    resolveUpdateProjectsRoot,
    enableRepo,
    disableRepo,
    enableAgent,
    findAgentManifest,
};
