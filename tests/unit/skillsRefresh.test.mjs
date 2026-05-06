import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { REPOS_DIR } from '../../cli/services/config.js';
import { copySkill, installDefaultSkills } from '../../cli/services/skills.js';

function writeSkill(root, name, files) {
    const skillRoot = path.join(root, name);
    fs.mkdirSync(skillRoot, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
        const filePath = path.join(skillRoot, relPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
}

function createRepo(repoName, skills) {
    const repoRoot = path.join(REPOS_DIR, repoName);
    const skillsRoot = path.join(repoRoot, 'skills');
    fs.rmSync(repoRoot, { recursive: true, force: true });
    for (const [name, files] of Object.entries(skills)) {
        writeSkill(skillsRoot, name, files);
    }
    return repoRoot;
}

test('copySkill replaces destination so removed source files do not linger', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-skills-'));
    try {
        const src = path.join(root, 'src-skill');
        const dest = path.join(root, 'dest-skill');

        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, 'SKILL.md'), '# Current skill\n');
        fs.writeFileSync(path.join(src, 'tool.js'), 'export default 1;\n');

        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'stale.js'), 'stale file\n');

        copySkill(src, dest);

        // Files from source are copied / overwritten
        assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(dest, 'tool.js')), true);
        // Files only in this owned destination skill are removed
        assert.equal(fs.existsSync(path.join(dest, 'stale.js')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('installDefaultSkills refreshes incoming skills and preserves other .agents skills', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-skills-install-'));
    const repoName = `UnitSkills-${process.pid}-${Date.now()}-agents`;
    const repoRoot = createRepo(repoName, {
        owned: {
            'SKILL.md': '# Current skill\n',
            'tool.js': 'export default 1;\n',
        },
    });

    try {
        writeSkill(path.join(root, '.agents', 'skills'), 'owned', {
            'SKILL.md': '# Old skill\n',
            'stale.js': 'stale file\n',
        });
        writeSkill(path.join(root, '.agents', 'skills'), 'local-only', {
            'SKILL.md': '# Local skill\n',
        });
        fs.writeFileSync(path.join(root, '.gitignore'), [
            '# >>> ploinky default-skills >>>',
            '.claude/skills/',
            '.agents/skills/',
            '# <<< ploinky default-skills <<<',
            '',
        ].join('\n'));

        installDefaultSkills(repoName, { targetRoot: root });

        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'owned', 'tool.js')), true);
        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'owned', 'stale.js')), false);
        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'local-only', 'SKILL.md')), true);
        assert.equal(fs.lstatSync(path.join(root, '.claude')).isSymbolicLink(), true);
        assert.equal(fs.readlinkSync(path.join(root, '.claude')), '.agents');

        const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        assert.match(gitignore, /^\.claude$/m);
        assert.match(gitignore, /^\.agents\/skills\/owned\/$/m);
        assert.doesNotMatch(gitignore, /^\.agents\/skills\/$/m);
        assert.doesNotMatch(gitignore, /local-only/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('installDefaultSkills migrates legacy .claude skills without deleting other .claude content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-skills-claude-'));
    const repoName = `UnitSkills-${process.pid}-${Date.now()}-claude`;
    const repoRoot = createRepo(repoName, {
        owned: {
            'SKILL.md': '# Current skill\n',
            'fresh.js': 'export default 2;\n',
        },
    });

    try {
        writeSkill(path.join(root, '.claude', 'skills'), 'owned', {
            'SKILL.md': '# Old skill\n',
            'stale.js': 'stale file\n',
        });
        writeSkill(path.join(root, '.claude', 'skills'), 'legacy-only', {
            'SKILL.md': '# Legacy skill\n',
        });
        fs.mkdirSync(path.join(root, '.claude', 'worktrees'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'keep.txt'), 'keep\n');

        installDefaultSkills(repoName, { targetRoot: root });

        assert.equal(fs.existsSync(path.join(root, '.claude', 'worktrees', 'keep.txt')), true);
        assert.equal(fs.lstatSync(path.join(root, '.claude')).isDirectory(), true);
        assert.equal(fs.lstatSync(path.join(root, '.claude', 'skills')).isSymbolicLink(), true);
        assert.equal(fs.readlinkSync(path.join(root, '.claude', 'skills')), '../.agents/skills');

        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'owned', 'fresh.js')), true);
        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'owned', 'stale.js')), false);
        assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'legacy-only', 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(root, '.claude', 'skills', 'legacy-only', 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(root, '.claude', 'skills', 'owned', 'fresh.js')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});
