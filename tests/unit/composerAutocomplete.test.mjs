import test from 'node:test';
import assert from 'node:assert/strict';

import { findTriggerAt } from '../../cli/server/webchat/composerAutocomplete.js';
import {
    extractMentionTokenAt,
    renderMentionHighlightHtml,
} from '../../cli/server/webchat/composerMentionHighlights.js';

test('findTriggerAt detects slash at start of input', () => {
    const result = findTriggerAt('/bu', 3, ['/', '@']);
    assert.deepEqual(result, { trigger: '/', triggerIndex: 0, token: 'bu' });
});

test('findTriggerAt detects @ after whitespace', () => {
    const result = findTriggerAt('summary @open-i', 15, ['/', '@']);
    assert.deepEqual(result, { trigger: '@', triggerIndex: 8, token: 'open-i' });
});

test('findTriggerAt prefers the most recent trigger', () => {
    const result = findTriggerAt('/build @ot', 10, ['/', '@']);
    assert.deepEqual(result, { trigger: '@', triggerIndex: 7, token: 'ot' });
});

test('findTriggerAt ignores trigger characters embedded in words', () => {
    const result = findTriggerAt('user@example.com', 16, ['@']);
    assert.equal(result, null);
});

test('findTriggerAt ignores trigger after a newline boundary between caret and token', () => {
    const result = findTriggerAt('@line1\n more', 11, ['@']);
    assert.equal(result, null);
});

test('extractMentionTokenAt returns the selected mention before trailing space', () => {
    assert.equal(extractMentionTokenAt('@open-interpreter ', 18), '@open-interpreter');
    assert.equal(extractMentionTokenAt('see @file:docs/notes.md ', 24), '@file:docs/notes.md');
});

test('renderMentionHighlightHtml bolds only recorded mention tokens', () => {
    const html = renderMentionHighlightHtml('ask @open-interpreter about @op', ['@open-interpreter']);
    assert.match(html, /<strong class="wa-composer-mention">@open-interpreter<\/strong>/);
    assert.match(html, /about @op$/);
});
