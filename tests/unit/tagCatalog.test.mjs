import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyTagSelectionToValue,
    createTagCatalogProvider,
    normalizeTagBackends,
    parseStaticTagList
} from '../../cli/server/webchat/autocompleteProviders/tagCatalog.js';

test('normalizeTagBackends returns unique tag entries with ids and aliases', () => {
    const entries = normalizeTagBackends({
        backends: [
            { id: 'open-interpreter', tags: ['open-interpreter', 'oi'], label: 'Open Interpreter', description: 'desc' },
            { id: 'another-tool', tags: ['Another-Tool'], label: '', description: '' }
        ]
    });
    assert.equal(entries.length, 3);
    assert.equal(entries[0].tag, 'open-interpreter');
    assert.equal(entries[0].label, 'Open Interpreter');
    assert.equal(entries[1].tag, 'oi');
    assert.equal(entries[2].tag, 'another-tool');
});

test('normalizeTagBackends drops entries with invalid tag names', () => {
    const entries = normalizeTagBackends({
        backends: [
            { id: '', tags: ['', 'no spaces allowed', 'BAD_PREFIX*'] },
            { id: 'valid-id', tags: [] }
        ]
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tag, 'valid-id');
});

test('parseStaticTagList accepts comma/space-separated lists and lowercases them', () => {
    const entries = parseStaticTagList('Open-Interpreter, OI, codex codex');
    const tags = entries.map((entry) => entry.tag);
    assert.deepEqual(tags, ['open-interpreter', 'oi', 'codex']);
});

test('parseStaticTagList rejects empty inputs and entries that fail the tag pattern', () => {
    assert.deepEqual(parseStaticTagList(''), []);
    assert.deepEqual(parseStaticTagList(null), []);
    const entries = parseStaticTagList('1invalid, _starts-underscore, no/slashes, has-dashes');
    assert.deepEqual(entries.map((entry) => entry.tag), ['has-dashes']);
});

test('tag provider uses static tag-relay-tags without browser MCP calls', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => {
        calls += 1;
        throw new Error('unexpected fetch');
    };
    try {
        const provider = createTagCatalogProvider({
            launchConfig: {
                'tag-relay-agent': 'researchRelay',
                'tag-relay-list-tool': 'research_relay_list_backends',
                'tag-relay-tags': 'open-interpreter,oi'
            }
        });
        await provider.refresh();
        await provider.requestSuggestions();
        const suggestions = provider.getSuggestions('@op', 3, {
            trigger: '@',
            triggerIndex: 0,
            token: 'op'
        });
        assert.equal(calls, 0);
        assert.deepEqual(suggestions.map((entry) => entry.label), ['@open-interpreter']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('tag provider stays silent for dynamic-only catalog config', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => {
        calls += 1;
        throw new Error('unexpected fetch');
    };
    try {
        const provider = createTagCatalogProvider({
            launchConfig: {
                'tag-relay-agent': 'some-agent',
                'tag-relay-list-tool': 'some_tool'
            }
        });
        await provider.refresh();
        await provider.requestSuggestions();
        const suggestions = provider.getSuggestions('@', 1, {
            trigger: '@',
            triggerIndex: 0,
            token: ''
        });
        assert.equal(calls, 0);
        assert.deepEqual(suggestions, []);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('applyTagSelectionToValue replaces the active @ token, not the last one', () => {
    const result = applyTagSelectionToValue('ask @op then @later', 'open-interpreter', {
        trigger: '@',
        triggerIndex: 4,
        token: 'op'
    });
    assert.deepEqual(result, {
        value: 'ask @open-interpreter then @later',
        cursor: 22
    });
});
