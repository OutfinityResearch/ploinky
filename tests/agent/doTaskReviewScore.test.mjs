import assert from 'node:assert';

import { setupLLMStub, loadLLMAgentClient, reviewScenarios } from './helpers/reviewFixtures.mjs';

const { resetCallHistory, drainCallHistory, restore } = setupLLMStub();
const llmAgentClient = await loadLLMAgentClient();

function formatExcerpt(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (text.length <= 160) {
        return text;
    }
    return `${text.slice(0, 157)}...`;
}

function stringifyResult(result) {
    if (!result) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'object') {
        if (typeof result.result === 'string') {
            return result.result;
        }
        return JSON.stringify(result);
    }
    return String(result);
}

function assertCallSequence(scenarioKey, fastCalls, reviewCalls) {
    assert.ok(
        fastCalls.length >= 1,
        `${scenarioKey}: expected at least one LLM call for fast path, saw ${fastCalls.length}`
    );
    assert.ok(
        fastCalls[fastCalls.length - 1].lastMessage.includes('Scenario:'),
        `${scenarioKey}: fast call should mention the scenario`
    );

    const planCalls = reviewCalls.filter(
        entry => Array.isArray(entry.messages) && entry.messages.some(msg => msg.includes('Create a concise step-by-step plan'))
    );
    assert.strictEqual(
        planCalls.length,
        1,
        `${scenarioKey}: expected exactly one planning call, saw ${planCalls.length}`
    );

    const reviewVotes = reviewCalls.filter(entry => entry.lastMessage.includes('Return JSON: {"approved"'));
    assert.strictEqual(
        reviewVotes.length,
        1,
        `${scenarioKey}: expected exactly one reviewer vote, saw ${reviewVotes.length}`
    );

    const iterationPrompts = reviewCalls.filter(entry => /Iteration:\s*1/.test(entry.lastMessage));
    assert.ok(
        iterationPrompts.length >= 1,
        `${scenarioKey}: expected at least one iteration prompt during review`
    );
}

try {
    const TOTAL_DELTA_THRESHOLD = 4;
    const perScenarioResults = [];

    for (const scenario of reviewScenarios) {
        resetCallHistory();
        const fast = await llmAgentClient.doTask(
            'openai',
            scenario.context,
            scenario.description,
            scenario.outputSchema,
            'fast'
        );
        const fastCalls = drainCallHistory();

        resetCallHistory();
        const reviewed = await llmAgentClient.doTaskWithReview(
            'openai',
            scenario.context,
            scenario.description,
            scenario.outputSchema,
            'deep',
            scenario.maxIterations ?? 3
        );
        const reviewCalls = drainCallHistory();

        assertCallSequence(scenario.key, fastCalls, reviewCalls);

        const score = scenario.score({ fast, reviewed });
        const primaryRationale = score.rationale || 'no rationale provided';

        assert.ok(
            score.passed,
            `${scenario.key}: review failed expectations -> ${primaryRationale}\nfast=${formatExcerpt(stringifyResult(fast))}\nreview=${formatExcerpt(stringifyResult(reviewed))}`
        );

        perScenarioResults.push({ scenario, score, fastCalls, reviewCalls, fast, reviewed });
    }

    const totalDelta = perScenarioResults.reduce((sum, entry) => sum + (entry.score.delta || 0), 0);
    assert.ok(
        totalDelta >= TOTAL_DELTA_THRESHOLD,
        `aggregate: total delta ${totalDelta} below threshold ${TOTAL_DELTA_THRESHOLD}`
    );

    const summaryLines = perScenarioResults.map(entry => {
        const { scenario, score } = entry;
        return `${scenario.key.padEnd(9)} | fast=${score.fastMetric} review=${score.reviewMetric} delta=${score.delta} :: ${score.rationale}`;
    });

    console.log('Review improvement scorecard');
    summaryLines.forEach(line => console.log(` - ${line}`));

    const totalAttempts = perScenarioResults.reduce((sum, entry) => sum + entry.reviewCalls.length, 0);
    console.log(`Total review LLM calls: ${totalAttempts}`);
} catch (error) {
    console.error(error);
    process.exit(1);
} finally {
    restore();
}
