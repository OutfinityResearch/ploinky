import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    codeRelativeMountPath,
    ensurePodmanStagedCodeDir,
    mergeNodeOptions,
} from '../../cli/services/docker/agentServiceManager.js';

function tempDir(prefix = 'podman-staging-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('codeRelativeMountPath recognizes mounts below /code only', () => {
    assert.equal(codeRelativeMountPath('/code/livekit.yaml'), 'livekit.yaml');
    assert.equal(codeRelativeMountPath('/code/config/runtime.json'), 'config/runtime.json');
    assert.equal(codeRelativeMountPath('/data'), null);
    assert.equal(codeRelativeMountPath('/code'), null);
});

test('ensurePodmanStagedCodeDir stages source tree with dependency and /code volume symlinks', () => {
    const root = tempDir();
    try {
        const agentCodePath = path.join(root, 'agent');
        const cacheNodeModules = path.join(root, 'cache', 'node_modules');
        const runtimeConfig = path.join(root, 'generated', 'runtime.json');
        const topLevelConfig = path.join(root, 'generated', 'top.txt');
        fs.mkdirSync(path.join(agentCodePath, 'config'), { recursive: true });
        fs.mkdirSync(cacheNodeModules, { recursive: true });
        fs.mkdirSync(path.dirname(runtimeConfig), { recursive: true });
        fs.writeFileSync(path.join(agentCodePath, 'package.json'), '{"type":"module"}\n');
        fs.writeFileSync(path.join(agentCodePath, 'config', 'default.json'), '{}\n');
        fs.writeFileSync(path.join(agentCodePath, 'top.txt'), 'source\n');
        fs.writeFileSync(runtimeConfig, '{"generated":true}\n');
        fs.writeFileSync(topLevelConfig, 'generated\n');

        const stagedCodePath = ensurePodmanStagedCodeDir('demo', agentCodePath, cacheNodeModules, new Map([
            ['config/runtime.json', runtimeConfig],
            ['top.txt', topLevelConfig],
        ]), { runtimeRoot: path.join(root, 'runtime') });

        assert.equal(fs.realpathSync(path.join(stagedCodePath, 'package.json')), fs.realpathSync(path.join(agentCodePath, 'package.json')));
        assert.equal(fs.realpathSync(path.join(stagedCodePath, 'node_modules')), fs.realpathSync(cacheNodeModules));
        assert.equal(fs.realpathSync(path.join(stagedCodePath, 'config', 'default.json')), fs.realpathSync(path.join(agentCodePath, 'config', 'default.json')));
        assert.equal(fs.realpathSync(path.join(stagedCodePath, 'config', 'runtime.json')), fs.realpathSync(runtimeConfig));
        assert.equal(fs.realpathSync(path.join(stagedCodePath, 'top.txt')), fs.realpathSync(topLevelConfig));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('mergeNodeOptions appends podman symlink flags without duplicating existing options', () => {
    assert.equal(
        mergeNodeOptions('--trace-warnings --preserve-symlinks', ['--preserve-symlinks', '--preserve-symlinks-main']),
        '--trace-warnings --preserve-symlinks --preserve-symlinks-main',
    );
});
