import assert from 'node:assert';

import Operator from '../../Agent/client/Operator.mjs';
import {
  __setCallLLMWithModelForTests,
  __resetCallLLMWithModelForTests,
} from '../../Agent/client/LLMClient.mjs';

(async () => {
  const calls = [];
  __setCallLLMWithModelForTests(async (modelName, history, prompt) => {
    calls.push({ modelName, history, prompt });
    if (!prompt) {
      return JSON.stringify({
        action: 'createNote',
        arguments: {
          title: 'Daily report',
          content: 'Summaries and highlights',
        },
        confidence: 0.92,
        reason: 'Matches note creation requirements.',
      });
    }
    return 'Summary: note created successfully.';
  });

  const operator = new Operator({
    modelName: 'mock-model',
    prompt: async () => {
      throw new Error('Prompt should not be called in this test.');
    },
  });

  operator.registerAction(
    'createNote',
    async ({ title, content }) => `Created note: ${title} -> ${content.length} chars`,
    'Create a note with title and content.',
    [
      { name: 'title', type: 'string', required: true, description: 'Title for the note.' },
      { name: 'content', type: 'string', required: true, description: 'Body of the note.' },
    ],
  );

  const result = await operator.doTask('Capture today\'s status update as a note.');

  assert.strictEqual(result.action, 'createNote');
  assert.deepStrictEqual(result.arguments, {
    title: 'Daily report',
    content: 'Summaries and highlights',
  });
  assert.strictEqual(result.result, 'Created note: Daily report -> 24 chars');
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0, 'Expected a non-empty summary.');

  assert.strictEqual(calls.length, 2, 'Expected two LLM invocations (selection + summary)');
  assert.strictEqual(calls[0].history.at(-1).message.includes('Task:'), true, 'Selection call should include task description.');

  __resetCallLLMWithModelForTests();
  console.log('Operator basic flow verified.');
})().catch((error) => {
  __resetCallLLMWithModelForTests();
  console.error(error);
  process.exit(1);
});
