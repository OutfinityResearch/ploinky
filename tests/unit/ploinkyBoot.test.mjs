import test from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultBootRepos } from '../../cli/services/ploinkyboot.js';

test('default boot repos include basic, AchillesIDE, and AchillesCLI', () => {
    const names = getDefaultBootRepos().map(repo => repo.name);

    assert.deepEqual(names, ['basic', 'AchillesIDE', 'AchillesCLI']);
});
