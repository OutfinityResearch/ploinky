import fs from 'fs';
import path from 'path';
import { REPOS_DIR } from './config.js';
import * as reposSvc from './repos.js';

export const AGENT_SKILL_TARGETS = Object.freeze({
    'claude-code': '.claude/skills',
    'agents':      '.agents/skills',
});

const CANONICAL_AGENT_DIR = '.agents';
const CLAUDE_SYMLINK = '.claude';
const CANONICAL_SKILLS_DIR = AGENT_SKILL_TARGETS['agents'];

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

export function copySkill(srcDir, destDir) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(srcDir, destDir, { recursive: true, force: true });
}

function pathExists(targetPath) {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

function listExistingSkillDirectories(skillsDir) {
    try {
        return fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => entry.name);
    } catch (_) {
        return [];
    }
}

export function ensureGitignoreEntries(workspaceRoot, relPaths) {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    let content = '';
    try {
        content = fs.readFileSync(gitignorePath, 'utf8');
    } catch (_) {
        content = '';
    }

    const desired = relPaths.map(p => {
        if (p.includes('/')) return p.endsWith('/') ? p : `${p}/`;
        return p;
    });
    const startIdx = content.indexOf(GITIGNORE_MARKER_START);
    const endIdx = content.indexOf(GITIGNORE_MARKER_END);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = content.slice(0, startIdx);
        const after = content.slice(endIdx + GITIGNORE_MARKER_END.length);
        const newBlock = `${GITIGNORE_MARKER_START}\n${desired.join('\n')}\n${GITIGNORE_MARKER_END}`;
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

function migrateLegacyClaudeSkills(destRoot, incomingSkills, agentsSkillsDir) {
    const claudePath = path.join(destRoot, CLAUDE_SYMLINK);
    const claudeSkillsDir = path.join(claudePath, 'skills');
    const incoming = new Set(incomingSkills);
    const migratedSkills = [];
    const skippedExistingSkills = [];

    let claudeStat;
    try { claudeStat = fs.lstatSync(claudePath); } catch (_) { claudeStat = null; }
    if (!claudeStat) {
        return { migratedSkills, skippedExistingSkills };
    }

    if (claudeStat.isSymbolicLink()) {
        try {
            const canonicalReal = fs.realpathSync(path.join(destRoot, CANONICAL_AGENT_DIR));
            const claudeReal = fs.realpathSync(claudePath);
            if (canonicalReal === claudeReal) {
                return { migratedSkills, skippedExistingSkills };
            }
        } catch (_) { }
    }

    for (const skill of listExistingSkillDirectories(claudeSkillsDir)) {
        if (incoming.has(skill)) continue;

        const srcDir = path.join(claudeSkillsDir, skill);
        const destDir = path.join(agentsSkillsDir, skill);
        if (pathExists(destDir)) {
            skippedExistingSkills.push(skill);
            continue;
        }
        fs.cpSync(srcDir, destDir, { recursive: true, force: true });
        migratedSkills.push(skill);
    }

    if (!claudeStat.isSymbolicLink() && pathExists(claudeSkillsDir)) {
        fs.rmSync(claudeSkillsDir, { recursive: true, force: true });
    }

    return { migratedSkills, skippedExistingSkills };
}

function ensureClaudeSymlink(destRoot) {
    const symlinkPath = path.join(destRoot, CLAUDE_SYMLINK);
    const target = CANONICAL_AGENT_DIR;

    let stat;
    try { stat = fs.lstatSync(symlinkPath); } catch (_) { stat = null; }

    if (stat) {
        if (stat.isSymbolicLink()) {
            const existing = fs.readlinkSync(symlinkPath);
            if (existing === target) return { changed: false, mode: 'root' };
            fs.unlinkSync(symlinkPath);
        } else if (stat.isDirectory()) {
            const entries = fs.readdirSync(symlinkPath).filter(name => name !== '.DS_Store');
            if (entries.length) {
                const skillsSymlinkPath = path.join(symlinkPath, 'skills');
                if (pathExists(skillsSymlinkPath)) {
                    const skillsStat = fs.lstatSync(skillsSymlinkPath);
                    if (skillsStat.isSymbolicLink()
                        && fs.readlinkSync(skillsSymlinkPath) === `../${CANONICAL_SKILLS_DIR}`) {
                        return { changed: false, mode: 'skills' };
                    }
                    fs.rmSync(skillsSymlinkPath, { recursive: true, force: true });
                }
                fs.symlinkSync(`../${CANONICAL_SKILLS_DIR}`, skillsSymlinkPath, 'dir');
                return { changed: true, mode: 'skills' };
            }
            fs.rmSync(symlinkPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(symlinkPath);
        }
    }

    fs.symlinkSync(target, symlinkPath, 'dir');
    return { changed: true, mode: 'root' };
}

export function installDefaultSkills(repoName, { only, skip, targetRoot } = {}) {
    if (!repoName || typeof repoName !== 'string') {
        throw new Error('Missing repository name.');
    }

    const destRoot = targetRoot || process.cwd();

    const knownAgents = Object.keys(AGENT_SKILL_TARGETS);
    if (Array.isArray(only) && only.length) {
        const unknown = only.filter(agent => !AGENT_SKILL_TARGETS[agent]);
        if (unknown.length) {
            throw new Error(`Unknown agent(s) in --only: ${unknown.join(', ')}. Known: ${knownAgents.join(', ')}`);
        }
    }

    if (Array.isArray(skip) && skip.length) {
        const unknown = skip.filter(agent => !AGENT_SKILL_TARGETS[agent]);
        if (unknown.length) {
            throw new Error(`Unknown agent(s) in --skip: ${unknown.join(', ')}. Known: ${knownAgents.join(', ')}`);
        }
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

    const agentsSkillsDir = path.join(destRoot, CANONICAL_SKILLS_DIR);
    fs.mkdirSync(agentsSkillsDir, { recursive: true });
    const legacyMigration = migrateLegacyClaudeSkills(destRoot, skills, agentsSkillsDir);
    for (const skill of skills) {
        copySkill(path.join(skillsRoot, skill), path.join(agentsSkillsDir, skill));
    }

    const claudeLink = ensureClaudeSymlink(destRoot);

    const targets = [{ agent: 'agents', relDir: CANONICAL_SKILLS_DIR, skills }];

    const gitignoreEntries = [
        CLAUDE_SYMLINK,
        ...skills.map(skill => `${CANONICAL_SKILLS_DIR}/${skill}`),
    ];
    const gitignoreUpdated = ensureGitignoreEntries(destRoot, gitignoreEntries);

    return {
        repoName,
        repoPath,
        skills,
        targets,
        destRoot,
        gitignoreUpdated,
        symlinkCreated: claudeLink.changed,
        claudeLink,
        legacyMigration,
    };
}
