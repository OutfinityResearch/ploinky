import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ensureStaticAgentBootstrapRepo,
    getStaticAgentBootstrapRepo,
} from '../../cli/services/staticAgentBootstrap.js';

test('static bootstrap maps explorer to AchillesIDE', () => {
    assert.equal(getStaticAgentBootstrapRepo('explorer'), 'AchillesIDE');
    assert.equal(getStaticAgentBootstrapRepo('AchillesIDE/explorer'), 'AchillesIDE');
    assert.equal(getStaticAgentBootstrapRepo('AchillesIDE:explorer'), 'AchillesIDE');
});

test('static bootstrap does not infer repos for unrelated agents', () => {
    assert.equal(getStaticAgentBootstrapRepo('basic/webtty'), null);
    assert.equal(getStaticAgentBootstrapRepo('AchillesCLI/explorer'), null);
    assert.equal(getStaticAgentBootstrapRepo('webmeet'), null);
});

test('ensureStaticAgentBootstrapRepo enables only inferred repos', () => {
    const enabled = [];
    const options = {
        enableRepo: repoName => enabled.push(repoName),
        log: () => {},
    };

    assert.equal(ensureStaticAgentBootstrapRepo('explorer', options), true);
    assert.deepEqual(enabled, ['AchillesIDE']);

    assert.equal(ensureStaticAgentBootstrapRepo('webmeet', options), false);
    assert.deepEqual(enabled, ['AchillesIDE']);
});
