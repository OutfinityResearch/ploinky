import assert from 'node:assert';

import FlexSearchUtil from '../../Agent/client/FlexSearchUtil.mjs';

(async () => {
  const search = new FlexSearchUtil();

  assert.throws(
    () => search.register('', 'Missing ID', 'Should fail'),
    /taskId is required/,
    'register() should require a taskId'
  );

  search.register('123', 'Add search', 'Implement a search interface for tasks');
  search.register('456', 'Improve ranking', 'Tune the scoring system for search results');
  search.register('789', 'Fix bug', 'Resolve the issue with search results');

  const emptyQueryResult = search.rank('', 5);
  assert.deepStrictEqual(emptyQueryResult, [], 'Blank queries should return an empty result set');

  const results = search.rank('search results', 3);

  assert.strictEqual(results.length, 2, 'Expected top results to contain two matching tasks');

  assert.deepStrictEqual(Object.keys(results[0]), ['456']);
  assert.strictEqual(results[0]['456'].feedbackTitle, 'Improve ranking');
  assert.strictEqual(results[0]['456'].taskDescription, 'Tune the scoring system for search results');
  assert.strictEqual(results[0]['456'].score, 1, 'Top result should receive the highest score');

  assert.deepStrictEqual(Object.keys(results[1]), ['789']);
  assert.strictEqual(results[1]['789'].feedbackTitle, 'Fix bug');
  assert.strictEqual(results[1]['789'].taskDescription, 'Resolve the issue with search results');
  assert.ok(results[1]['789'].score < results[0]['456'].score, 'Second result should rank lower than the first');

  console.log('FlexSearchUtil indexing and ranking verified.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
