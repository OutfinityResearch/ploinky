import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import {
    REPO_SOURCES_FILE,
    addRepo,
    findWorkspaceGitRepos,
    isGitRepository,
    resolveRepoSource,
    resolveRepoSourceUrl,
    updateRepo,
} from '../../cli/services/repos.js';
import { REPOS_DIR } from '../../cli/services/config.js';
import { resolveUpdateProjectsRoot } from '../../cli/commands/repoAgentCommands.js';

function mkdir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

test('findWorkspaceGitRepos includes root and nested repositories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-repos-'));
    try {
        mkdir(path.join(root, '.git'));
        mkdir(path.join(root, 'direct', '.git'));
        mkdir(path.join(root, 'group', 'nested', '.git'));
        mkdir(path.join(root, '.ploinky', 'repos', 'internal', '.git'));
        mkdir(path.join(root, 'node_modules', 'package', '.git'));
        mkdir(path.join(root, 'plain', 'src'));

        const discovered = findWorkspaceGitRepos(root)
            .map(repo => path.relative(root, repo.path) || '.')
            .sort();

        assert.deepEqual(discovered, ['.', 'direct', 'group/nested']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('findWorkspaceGitRepos skips unreadable runtime data directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-repos-'));
    const pgdata = path.join(root, 'postgres', 'data', 'pgdata');

    try {
        mkdir(path.join(root, 'project', '.git'));
        mkdir(pgdata);
        fs.chmodSync(pgdata, 0o000);

        const discovered = findWorkspaceGitRepos(root)
            .map(repo => path.relative(root, repo.path) || '.')
            .sort();

        assert.deepEqual(discovered, ['project']);
    } finally {
        try { fs.chmodSync(pgdata, 0o700); } catch (_) {}
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('findWorkspaceGitRepos rejects missing search roots', () => {
    const missing = path.join(os.tmpdir(), `ploinky-missing-${Date.now()}`);
    assert.throws(() => findWorkspaceGitRepos(missing), /is not a directory/);
});

test('isGitRepository detects only directories with git metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-git-check-'));
    try {
        const gitRepo = path.join(root, 'git-repo');
        const plainDir = path.join(root, 'plain-dir');
        mkdir(path.join(gitRepo, '.git'));
        mkdir(plainDir);

        assert.equal(isGitRepository(gitRepo), true);
        assert.equal(isGitRepository(plainDir), false);
        assert.equal(isGitRepository(path.join(root, 'missing')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('updateRepo reclones non-git installed repo when a manifest source URL is known', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-reclone-source-'));
    const repoName = `unit-non-git-${process.pid}-${Date.now()}`;
    const providerName = `unit-provider-${process.pid}-${Date.now()}`;
    const repoPath = path.join(REPOS_DIR, repoName);
    const providerPath = path.join(REPOS_DIR, providerName);
    const backupRoot = path.join(path.dirname(REPOS_DIR), 'repo-backups');
    const originalSources = fs.existsSync(REPO_SOURCES_FILE)
        ? fs.readFileSync(REPO_SOURCES_FILE, 'utf8')
        : null;

    try {
        const source = path.join(root, 'source');
        mkdir(source);
        execFileSync('git', ['init', '-q'], { cwd: source, stdio: 'ignore' });
        fs.writeFileSync(path.join(source, 'README.md'), '# source\n');
        execFileSync('git', ['add', 'README.md'], { cwd: source, stdio: 'ignore' });
        execFileSync('git', [
            '-c', 'user.name=Unit Test',
            '-c', 'user.email=unit@example.invalid',
            'commit',
            '-q',
            '-m',
            'initial',
        ], { cwd: source, stdio: 'ignore' });

        mkdir(path.join(providerPath, 'agent'));
        fs.writeFileSync(path.join(providerPath, 'agent', 'manifest.json'), JSON.stringify({
            repos: {
                [repoName]: source,
            },
        }, null, 2));

        mkdir(repoPath);
        fs.writeFileSync(path.join(repoPath, 'stale.txt'), 'stale\n');

        assert.equal(resolveRepoSourceUrl(repoName), source);
        const result = updateRepo(repoName, { stdio: 'ignore' });

        assert.equal(result.recloned, true);
        assert.equal(isGitRepository(repoPath), true);
        assert.equal(fs.existsSync(path.join(repoPath, 'README.md')), true);
        assert.equal(fs.existsSync(path.join(repoPath, 'stale.txt')), false);
        assert.equal(fs.existsSync(path.join(result.backupPath, 'stale.txt')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(repoPath, { recursive: true, force: true });
        fs.rmSync(providerPath, { recursive: true, force: true });
        try {
            for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
                if (entry.isDirectory() && entry.name.startsWith(repoName)) {
                    fs.rmSync(path.join(backupRoot, entry.name), { recursive: true, force: true });
                }
            }
        } catch (_) {}
        if (originalSources === null) {
            fs.rmSync(REPO_SOURCES_FILE, { force: true });
        } else {
            fs.mkdirSync(path.dirname(REPO_SOURCES_FILE), { recursive: true });
            fs.writeFileSync(REPO_SOURCES_FILE, originalSources);
        }
    }
});

test('updateRepo preserves recorded branch when repairing a non-git repo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-reclone-branch-'));
    const repoName = `unit-branch-${process.pid}-${Date.now()}`;
    const repoPath = path.join(REPOS_DIR, repoName);
    const backupRoot = path.join(path.dirname(REPOS_DIR), 'repo-backups');
    const originalSources = fs.existsSync(REPO_SOURCES_FILE)
        ? fs.readFileSync(REPO_SOURCES_FILE, 'utf8')
        : null;

    try {
        const source = path.join(root, 'source');
        mkdir(source);
        execFileSync('git', ['init', '-q'], { cwd: source, stdio: 'ignore' });
        fs.writeFileSync(path.join(source, 'README.md'), '# main\n');
        execFileSync('git', ['add', 'README.md'], { cwd: source, stdio: 'ignore' });
        execFileSync('git', [
            '-c', 'user.name=Unit Test',
            '-c', 'user.email=unit@example.invalid',
            'commit',
            '-q',
            '-m',
            'main',
        ], { cwd: source, stdio: 'ignore' });
        execFileSync('git', ['checkout', '-q', '-b', 'feature/test-branch'], { cwd: source, stdio: 'ignore' });
        fs.writeFileSync(path.join(source, 'BRANCH.txt'), 'feature\n');
        execFileSync('git', ['add', 'BRANCH.txt'], { cwd: source, stdio: 'ignore' });
        execFileSync('git', [
            '-c', 'user.name=Unit Test',
            '-c', 'user.email=unit@example.invalid',
            'commit',
            '-q',
            '-m',
            'feature',
        ], { cwd: source, stdio: 'ignore' });

        addRepo(repoName, source, 'feature/test-branch', { stdio: 'ignore' });
        assert.deepEqual(resolveRepoSource(repoName), {
            url: source,
            branch: 'feature/test-branch',
        });
        assert.equal(fs.existsSync(path.join(repoPath, 'BRANCH.txt')), true);

        fs.rmSync(repoPath, { recursive: true, force: true });
        mkdir(repoPath);
        fs.writeFileSync(path.join(repoPath, 'stale.txt'), 'stale\n');

        const result = updateRepo(repoName, { stdio: 'ignore' });

        assert.equal(result.recloned, true);
        assert.equal(fs.existsSync(path.join(repoPath, 'BRANCH.txt')), true);
        assert.equal(String(execFileSync('git', ['-C', repoPath, 'branch', '--show-current'])).trim(), 'feature/test-branch');
        assert.equal(fs.existsSync(path.join(repoPath, 'stale.txt')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(repoPath, { recursive: true, force: true });
        try {
            for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
                if (entry.isDirectory() && entry.name.startsWith(repoName)) {
                    fs.rmSync(path.join(backupRoot, entry.name), { recursive: true, force: true });
                }
            }
        } catch (_) {}
        if (originalSources === null) {
            fs.rmSync(REPO_SOURCES_FILE, { force: true });
        } else {
            fs.mkdirSync(path.dirname(REPO_SOURCES_FILE), { recursive: true });
            fs.writeFileSync(REPO_SOURCES_FILE, originalSources);
        }
    }
});

test('resolveUpdateProjectsRoot defaults to the current working directory', () => {
    assert.equal(resolveUpdateProjectsRoot(), process.cwd());

    const explicit = path.join(os.tmpdir(), 'explicit-project-root');
    assert.equal(resolveUpdateProjectsRoot(explicit), path.resolve(explicit));
});
