import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    hasPreinstallRunInProcess,
    markPreinstallRunInProcess,
    resetPreinstallRunInProcess,
} from '../../cli/services/lifecycleHooks.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function tempDir(prefix = 'ploinky-runtime-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runModuleSnippet(source, env = {}) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...env,
            PLOINKY_DEBUG: '',
        },
        encoding: 'utf8',
    });
}

test('collectLiveAgentContainers probes the runtime before listing live containers', () => {
    const binDir = tempDir();
    try {
        const podmanPath = path.join(binDir, 'podman');
        fs.writeFileSync(
            podmanPath,
            `#!/bin/sh
case "$1" in
  ps)
    printf '%s\\n' 'ploinky_repoA_agentA_project_12345678'
    ;;
  inspect)
    printf '%s\\n' '[{"Mounts":[{"Destination":"/code","Source":"/tmp/ws/.ploinky/repos/repoA/agentA"}],"Config":{"Env":["AGENT_NAME=agentA"],"Image":"node:20-alpine"},"NetworkSettings":{"Ports":{"7000/tcp":[{"HostIp":"127.0.0.1","HostPort":"12345"}]}}}]'
    ;;
  *)
    exit 1
    ;;
esac
`,
        );
        fs.chmodSync(podmanPath, 0o755);

        const result = runModuleSnippet(
            `import { collectLiveAgentContainers } from './cli/services/docker/containerRegistry.js';
process.stdout.write(JSON.stringify(collectLiveAgentContainers()));`,
            { PATH: binDir },
        );

        assert.equal(result.status, 0, result.stderr);
        const containers = JSON.parse(result.stdout);
        assert.equal(containers.length, 1);
        assert.equal(containers[0].containerName, 'ploinky_repoA_agentA_project_12345678');
        assert.equal(containers[0].agentName, 'agentA');
        assert.equal(containers[0].repoName, 'repoA');
        assert.equal(containers[0].config.ports[0].hostPort, '12345');
    } finally {
        fs.rmSync(binDir, { recursive: true, force: true });
    }
});

test('collectLiveAgentContainers is non-fatal when no container runtime is installed', () => {
    const emptyBin = tempDir();
    try {
        const result = runModuleSnippet(
            `import { collectLiveAgentContainers } from './cli/services/docker/containerRegistry.js';
process.stdout.write(JSON.stringify(collectLiveAgentContainers()));`,
            { PATH: emptyBin },
        );

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), []);
    } finally {
        fs.rmSync(emptyBin, { recursive: true, force: true });
    }
});

test('preinstall deduplication is process-local and repo scoped', () => {
    const agentName = `shared-agent-${Date.now()}`;
    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-one', 'dev'), false);

    markPreinstallRunInProcess(agentName, 'repo-one', 'dev');

    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-one', 'dev'), true);
    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-two', 'dev'), false);
});

test('resetPreinstallRunInProcess clears the in-process dedup set', () => {
    const agentName = `reset-agent-${Date.now()}`;
    markPreinstallRunInProcess(agentName, 'repo-one', 'dev');
    markPreinstallRunInProcess(agentName, 'repo-two', 'dev');
    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-one', 'dev'), true);

    resetPreinstallRunInProcess();

    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-one', 'dev'), false);
    assert.equal(hasPreinstallRunInProcess(agentName, 'repo-two', 'dev'), false);
});
