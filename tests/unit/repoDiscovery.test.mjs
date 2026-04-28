import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findWorkspaceGitRepos } from '../../cli/services/repos.js';
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

test('resolveUpdateProjectsRoot defaults to the current working directory', () => {
    assert.equal(resolveUpdateProjectsRoot(), process.cwd());

    const explicit = path.join(os.tmpdir(), 'explicit-project-root');
    assert.equal(resolveUpdateProjectsRoot(explicit), path.resolve(explicit));
});
