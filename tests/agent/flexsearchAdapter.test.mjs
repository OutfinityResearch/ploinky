import assert from 'node:assert';
import FlexSearch from 'flexsearch';

import FlexSearchAdapter, {
    createFlexSearchAdapter,
    fromFlexSearchInstance,
} from '../../Agent/AgentLib/search/flexsearchAdapter.mjs';

const docs = [
    { id: 'doc-1', text: 'FlexSearch adapter basics and quick usage notes.' },
    { id: 'doc-2', text: 'Indexing happens automatically as you add entries.' },
    { id: 'doc-3', text: 'Async lookups and updates are supported out of the box.' },
];

const adapter = createFlexSearchAdapter({ tokenize: 'forward' });

for (const doc of docs) {
    adapter.add(doc.id, doc.text);
}

let matches = adapter.search('flexsearch');
assert.deepStrictEqual(matches, ['doc-1'], 'plain search should return IDs for direct hits');

await adapter.appendAsync('doc-1', ' indexing overview and tips');

matches = adapter.search('indexing');
assert.deepStrictEqual(matches.sort(), ['doc-1', 'doc-2'].sort(), 'appending keeps the index up to date automatically.');

const asyncMatches = await adapter.searchAsync('async');
assert.deepStrictEqual(asyncMatches, ['doc-3'], 'async searches should resolve to matching IDs');

const underlying = adapter.getIndex();
assert.ok(underlying instanceof FlexSearch.Index, 'getIndex returns the wrapped FlexSearch instance');
assert.ok(adapter.hasMethod('appendAsync'), 'adapter exposes instance methods dynamically');

const cloned = adapter.clone();
cloned.add('doc-4', 'Clones reuse the config but not the data.');
assert.deepStrictEqual(cloned.search('clones'), ['doc-4'], 'clone should create an empty index with the same config');
assert.deepStrictEqual(adapter.search('clones'), [], 'original index remains unchanged after cloning');

const rawIndex = new FlexSearch.Index({ tokenize: 'forward' });
rawIndex.add('raw-1', 'Wrapping existing flexsearch instances works.');
const wrapped = fromFlexSearchInstance(rawIndex);
assert.strictEqual(wrapped.getType(), 'index', 'wrapping a raw Index keeps the correct type');
assert.deepStrictEqual(wrapped.search('wrapping'), ['raw-1'], 'wrapped instance forwards calls to the original index');

const documentIndex = new FlexSearch.Document({
    document: {
        id: 'id',
        index: ['title', 'body'],
    },
});

documentIndex.add({
    id: 'article-1',
    title: 'FlexSearch document adapter',
    body: 'Document indexes are also supported through the shared adapter.',
});

const documentAdapter = fromFlexSearchInstance(documentIndex);
assert.strictEqual(documentAdapter.getType(), 'document', 'document instances should be detected automatically');
const docSearchResults = documentAdapter.search('document');
assert.strictEqual(docSearchResults[0]?.result?.includes('article-1'), true, 'document search returns matching document IDs');
assert.strictEqual(documentAdapter.hasMethod('get'), true, 'document adapter exposes document-specific helpers');

console.log('flexsearchAdapter test passed');
