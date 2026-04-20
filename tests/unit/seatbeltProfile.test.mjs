import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeatbeltProfile } from '../../cli/services/seatbelt/seatbeltProfile.js';

test('buildSeatbeltProfile does not emit duplicate exec permissions', () => {
    const profile = buildSeatbeltProfile({
        agentCodePath: '/tmp/code',
        agentLibPath: '/tmp/Agent',
        nodeModulesDir: '/tmp/node_modules',
        sharedDir: '/tmp/shared',
        cwd: '/tmp/workspace',
        skillsPath: null,
        codeReadOnly: false,
        skillsReadOnly: true,
        volumes: {}
    });

    assert.match(profile, /\(allow process-fork process-exec\*\)/);
    assert.doesNotMatch(profile, /process-exec process-exec\*/);
});
