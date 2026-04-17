import fs from 'fs';
import path from 'path';
import { REPOS_DIR } from './config.js';
import * as reposSvc from './repos.js';

export const AGENT_SKILL_TARGETS = Object.freeze({
    'claude-code': '.claude/skills',
    'agents':      '.agents/skills',
});

const GITIGNORE_MARKER_START = '# >>> ploinky default-skills >>>';
const GITIGNORE_MARKER_END = '# <<< ploinky default-skills <<<';

function ensureRepoCloned(repoName) {
    const repoPath = path.join(REPOS_DIR, repoName);
    if (fs.existsSync(repoPath)) return repoPath;
    const result = reposSvc.addRepo(repoName, null);
    return result.path;
}

function listSkillDirectories(skillsRoot) {
    return fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name);
}

function copySkill(srcDir, destDir) {
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true, force: true });
}

export function ensureGitignoreEntries(workspaceRoot, relPaths) {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    let content = '';
    try {
        content = fs.readFileSync(gitignorePath, 'utf8');
    } catch (_) {
        content = '';
    }

    const desired = relPaths.map(p => (p.endsWith('/') ? p : `${p}/`));
    const startIdx = content.indexOf(GITIGNORE_MARKER_START);
    const endIdx = content.indexOf(GITIGNORE_MARKER_END);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = content.slice(0, startIdx);
        const after = content.slice(endIdx + GITIGNORE_MARKER_END.length);
        const blockBody = content.slice(startIdx + GITIGNORE_MARKER_START.length, endIdx);
        const existing = blockBody.split('\n').map(s => s.trim()).filter(Boolean);
        const union = Array.from(new Set([...existing, ...desired]));
        const newBlock = `${GITIGNORE_MARKER_START}\n${union.join('\n')}\n${GITIGNORE_MARKER_END}`;
        const newContent = `${before}${newBlock}${after}`;
        if (newContent === content) return false;
        fs.writeFileSync(gitignorePath, newContent);
        return true;
    }

    const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
    const block = `${needsLeadingNewline ? '\n' : ''}${GITIGNORE_MARKER_START}\n${desired.join('\n')}\n${GITIGNORE_MARKER_END}\n`;
    fs.writeFileSync(gitignorePath, content + block);
    return true;
}

export function installDefaultSkills(repoName, { only, skip, targetRoot } = {}) {
    if (!repoName || typeof repoName !== 'string') {
        throw new Error('Missing repository name.');
    }

    const destRoot = targetRoot || process.cwd();

    const knownAgents = Object.keys(AGENT_SKILL_TARGETS);
    let selectedAgents = knownAgents.slice();

    if (Array.isArray(only) && only.length) {
        const unknown = only.filter(agent => !AGENT_SKILL_TARGETS[agent]);
        if (unknown.length) {
            throw new Error(`Unknown agent(s) in --only: ${unknown.join(', ')}. Known: ${knownAgents.join(', ')}`);
        }
        selectedAgents = only.slice();
    }

    if (Array.isArray(skip) && skip.length) {
        const unknown = skip.filter(agent => !AGENT_SKILL_TARGETS[agent]);
        if (unknown.length) {
            throw new Error(`Unknown agent(s) in --skip: ${unknown.join(', ')}. Known: ${knownAgents.join(', ')}`);
        }
        selectedAgents = selectedAgents.filter(agent => !skip.includes(agent));
    }

    if (!selectedAgents.length) {
        throw new Error('No target agents selected (all were skipped).');
    }

    const repoPath = ensureRepoCloned(repoName);

    if (reposSvc.classifyRepoKind(repoName) === 'agents') {
        const skillsRepos = Object.entries(reposSvc.getPredefinedRepos())
            .filter(([, info]) => info.kind === 'skills' || info.kind === 'mixed')
            .map(([n]) => n);
        const hint = skillsRepos.length ? ` Available skills repos: ${skillsRepos.join(', ')}.` : '';
        throw new Error(`Repo '${repoName}' is an agents repo and has no skills/ folder.${hint}`);
    }

    const skillsRoot = path.join(repoPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
        throw new Error(`No skills/ folder in repo '${repoName}' (expected ${skillsRoot}).`);
    }

    const skills = listSkillDirectories(skillsRoot);
    if (!skills.length) {
        throw new Error(`No skill subdirectories found under ${skillsRoot}.`);
    }

    const targets = [];
    for (const agent of selectedAgents) {
        const relDir = AGENT_SKILL_TARGETS[agent];
        const absBase = path.join(destRoot, relDir);
        fs.mkdirSync(absBase, { recursive: true });
        for (const skill of skills) {
            copySkill(path.join(skillsRoot, skill), path.join(absBase, skill));
        }
        targets.push({ agent, relDir, skills });
    }

    const gitignoreUpdated = ensureGitignoreEntries(
        destRoot,
        selectedAgents.map(agent => AGENT_SKILL_TARGETS[agent])
    );

    return { repoName, repoPath, skills, targets, destRoot, gitignoreUpdated };
}
