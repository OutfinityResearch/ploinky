'use strict';

const assert = require('assert');

const { setupLLMStub, loadLLMAgentClient, reviewScenarios } = require('./helpers/reviewFixtures');

const { resetCallHistory } = setupLLMStub();
const llmAgentClient = loadLLMAgentClient();

const assertionsByScenario = {
    schema(fastResult, reviewedResult) {
        assert.strictEqual(fastResult.name, 'Acme Corp');
        assert.strictEqual(fastResult.status, 'pending');
        assert.ok(typeof fastResult.riskScore === 'undefined');
        assert.strictEqual(reviewedResult.name, 'Acme Corp');
        assert.strictEqual(reviewedResult.status, 'green');
        assert.strictEqual(reviewedResult.riskScore, 0.12);
    },
    reasoning(fastResult, reviewedResult) {
        assert.ok(/11/.test(fastResult.result));
        assert.ok(/14/.test(reviewedResult.result));
    },
    writing(fastResult, reviewedResult) {
        const fastWordCount = fastResult.result.trim().split(/\s+/).length;
        const reviewedWordCount = reviewedResult.result.trim().split(/\s+/).length;
        assert.ok(fastWordCount > 80);
        assert.ok(reviewedWordCount <= 40);
        assert.ok(reviewedResult.result.includes('Deliverables'));
    },
    bugfix(fastResult, reviewedResult) {
        assert.ok(/sum - n/.test(fastResult.result));
        assert.ok(/sum \+ n/.test(reviewedResult.result));
    },
};

const scenarios = reviewScenarios.filter((scenario) => assertionsByScenario[scenario.key]);

(async () => {
    for (const scenario of scenarios) {
        resetCallHistory();
        const fast = await llmAgentClient.doTask(
            'openai',
            scenario.context,
            scenario.description,
            scenario.outputSchema,
            'fast'
        );

        resetCallHistory();
        const reviewed = await llmAgentClient.doTaskWithReview(
            'openai',
            scenario.context,
            scenario.description,
            scenario.outputSchema,
            'deep',
            scenario.maxIterations ?? 3
        );

        assertionsByScenario[scenario.key](fast, reviewed);
    }

    llmAgentClient.registerOperator('summarizeNotes', 'Summarise meeting notes', ({ text }) => `summary:${text}`);
    const operatorResult = await llmAgentClient.callOperator('summarizeNotes', { text: 'hello' });
    assert.strictEqual(operatorResult, 'summary:hello');

    resetCallHistory();
    const operatorSelection = await llmAgentClient.chooseOperator(
        'openai',
        'Please summarise the meeting minutes',
        'fast',
        0.5
    );
    assert.deepStrictEqual(operatorSelection, {
        suitableOperators: [{ operatorName: 'summarizeNotes', confidence: 0.92 }],
    });

    console.log('LLMAgentClient deterministic behaviours verified.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
