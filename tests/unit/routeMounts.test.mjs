import test from 'node:test';
import assert from 'node:assert/strict';

import { isRouteMount } from '../../cli/server/utils/routeMounts.js';

test('isRouteMount matches exact mount and subpaths only', () => {
    assert.equal(isRouteMount('/webmeet', '/webmeet'), true);
    assert.equal(isRouteMount('/webmeet/', '/webmeet'), true);
    assert.equal(isRouteMount('/webmeet/session', '/webmeet'), true);
    assert.equal(isRouteMount('/webmeetAgent/IDE-plugins/plugin.js', '/webmeet'), false);
    assert.equal(isRouteMount('/webmeet-agent', '/webmeet'), false);
});
