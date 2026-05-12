import test from 'node:test';
import assert from 'node:assert/strict';

import { applySlashSelectionToValue } from '../../cli/server/webchat/slashAutocomplete.js';

test('applySlashSelectionToValue replaces a bare slash without leaving a trailing slash', () => {
    const result = applySlashSelectionToValue('/', {
        name: '/build',
        subCommands: []
    });

    assert.deepEqual(result, {
        value: '/build ',
        cursor: '/build '.length
    });
});

test('applySlashSelectionToValue replaces a partial command token', () => {
    const result = applySlashSelectionToValue('/bu', {
        name: '/build',
        subCommands: []
    });

    assert.deepEqual(result, {
        value: '/build ',
        cursor: '/build '.length
    });
});

test('applySlashSelectionToValue keeps the prefix before the slash command', () => {
    const result = applySlashSelectionToValue('please run /bu', {
        name: '/build',
        subCommands: []
    });

    assert.deepEqual(result, {
        value: 'please run /build ',
        cursor: 'please run /build '.length
    });
});
