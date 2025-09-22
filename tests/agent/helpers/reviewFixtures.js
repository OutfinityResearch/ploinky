'use strict';

const path = require('path');

const llmClientPath = path.join(__dirname, '../../../Agent/client/LLMClient.js');
const llmClient = require(llmClientPath);

const callInvocations = [];

const scenarioResponders = {
    schema: {
        fast: () => JSON.stringify({ name: 'Acme Corp', status: 'pending' }),
        deep: () => JSON.stringify({ name: 'Acme Corp', status: 'green', riskScore: 0.12 }),
    },
    reasoning: {
        fast: () => 'Answer: 11 (missed a step)',
        deep: () => 'Answer: 14 (correct calculation: 7 + 7)',
    },
    writing: {
        fast: () => Array(40).fill('This casual paragraph rambles without respecting the strict brief').join(' '),
        deep: () => 'Deliverables should be finalised by Friday; communicate blockers immediately to keep the release on track.',
    },
    bugfix: {
        fast: () => 'function total(nums) { return nums.reduce((sum, n) => sum - n, 0); }',
        deep: () => 'function total(nums) { return nums.reduce((sum, n) => sum + n, 0); }',
    },
    baseline: {
        fast: () => 'Status remains green. Maintain cadence.',
        deep: () => 'Status remains green. Maintain cadence.',
    },
};

function stubbedCallLLMWithModel(modelName, history, prompt, options = {}) {
    const workingHistory = Array.isArray(history) ? history.slice() : [];
    if (prompt) {
        workingHistory.push({ role: 'human', message: prompt });
    }

    const messages = workingHistory.map((entry) => entry?.message || '');
    const lastMessage = messages.length ? messages[messages.length - 1] : '';
    callInvocations.push({ modelName, lastMessage, messages, options });

    if (messages.some((msg) => msg.includes('Create a concise step-by-step plan'))) {
        return JSON.stringify({ steps: ['Understand the request', 'Deliver the improved answer'] });
    }

    if (lastMessage.includes('Return JSON: {"approved"')) {
        return JSON.stringify({ approved: true, feedback: 'Looks correct after refinement.' });
    }

    if (lastMessage.includes('Only return JSON: {"suitableOperators"')) {
        return JSON.stringify({
            suitableOperators: [
                { operatorName: 'summarizeNotes', confidence: 0.92 },
                { operatorName: 'archiveDocument', confidence: 0.31 },
            ],
        });
    }

    const scenarioSource = [...messages].reverse().find((msg) => /Scenario:\s*[A-Za-z0-9_-]+/i.test(msg)) || lastMessage;
    const scenarioMatch = scenarioSource.match(/Scenario:\s*([A-Za-z0-9_-]+)/i);
    if (scenarioMatch) {
        const scenarioKey = scenarioMatch[1].toLowerCase();
        const responder = scenarioResponders[scenarioKey];
        if (responder) {
            const isIteration = /Iteration:\s*\d+/.test(lastMessage) || lastMessage.includes('Return only the updated solution');
            const variant = isIteration ? responder.deep : responder.fast;
            return variant();
        }
    }

    return 'General response';
}

function setupLLMStub() {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'stub-openai-key';
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'stub-anthropic-key';
    process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

    llmClient.callLLMWithModel = stubbedCallLLMWithModel;

    return {
        callInvocations,
        resetCallHistory() {
            callInvocations.length = 0;
        },
        drainCallHistory() {
            const snapshot = callInvocations.slice();
            callInvocations.length = 0;
            return snapshot;
        },
    };
}

function loadLLMAgentClient() {
    const llmAgentClientPath = path.join(__dirname, '../../../Agent/client/LLMAgentClient.js');
    delete require.cache[require.resolve(llmAgentClientPath)];
    return require(llmAgentClientPath);
}

function asText(value) {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value.result === 'string') {
        return value.result;
    }
    if (typeof value.raw === 'string') {
        return value.raw;
    }
    return String(value);
}

const reviewScenarios = [
    {
        key: 'schema',
        context: 'Scenario: schema\nClient sector: fintech',
        description: 'Return a JSON summary with name, status, and riskScore.',
        outputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                status: { type: 'string' },
                riskScore: { type: 'number' },
            },
            required: ['name', 'status', 'riskScore'],
        },
        maxIterations: 3,
        minExpectedDelta: 1,
        score({ fast, reviewed }) {
            const requiredKeys = ['name', 'status', 'riskScore'];
            const coverage = (value) => {
                return requiredKeys.reduce((acc, key) => acc + (value && Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined ? 1 : 0), 0);
            };
            const fastMetric = coverage(fast);
            const reviewMetric = coverage(reviewed);
            const delta = reviewMetric - fastMetric;
            const correctRisk = reviewed && reviewed.riskScore === 0.12;
            const passed = reviewMetric === requiredKeys.length && delta >= this.minExpectedDelta && correctRisk;
            const missing = requiredKeys.filter((key) => !reviewed || reviewed[key] === undefined);
            const rationale = passed
                ? 'review added complete risk profile with correct score'
                : `expected all keys with riskScore 0.12, missing: ${missing.join(', ') || 'none'}, delta=${delta}`;
            return { fastMetric, reviewMetric, delta, passed, rationale };
        },
    },
    {
        key: 'reasoning',
        context: 'Scenario: reasoning\nStory problem: twins share expenses',
        description: 'Solve the arithmetic word problem accurately.',
        outputSchema: null,
        maxIterations: 3,
        minExpectedDelta: 1,
        score({ fast, reviewed }) {
            const extractNumber = (text) => {
                const matches = text.match(/-?\d+(?:\.\d+)?/g);
                if (!matches || !matches.length) {
                    return null;
                }
                return Number(matches[0]);
            };
            const fastAnswer = extractNumber(asText(fast));
            const reviewAnswer = extractNumber(asText(reviewed));
            const expected = 14;
            const fastMetric = fastAnswer === expected ? 1 : 0;
            const reviewMetric = reviewAnswer === expected ? 1 : 0;
            const delta = reviewMetric - fastMetric;
            const passed = reviewMetric === 1 && delta >= this.minExpectedDelta;
            const rationale = passed
                ? 'review produced the correct arithmetic answer'
                : `expected ${expected}, saw fast=${fastAnswer ?? 'n/a'} reviewed=${reviewAnswer ?? 'n/a'}`;
            return { fastMetric, reviewMetric, delta, passed, rationale, fastAnswer, reviewAnswer };
        },
    },
    {
        key: 'writing',
        context: 'Scenario: writing\nTone: formal\nWord limit: 30-40 words',
        description: 'Write a project update that respects the style and length constraints.',
        outputSchema: null,
        maxIterations: 3,
        minExpectedDelta: 1,
        score({ fast, reviewed }) {
            const evaluate = (text) => {
                const words = text.trim().split(/\s+/).filter(Boolean);
                const wordCount = words.length;
                const withinLimit = wordCount <= 40 ? 1 : 0;
                const includesKeyword = /Deliverables/i.test(text) ? 1 : 0;
                return {
                    metric: withinLimit + includesKeyword,
                    wordCount,
                    withinLimit,
                    includesKeyword,
                };
            };
            const fastText = asText(fast);
            const reviewText = asText(reviewed);
            const fastEval = evaluate(fastText);
            const reviewEval = evaluate(reviewText);
            const delta = reviewEval.metric - fastEval.metric;
            const passed = reviewEval.metric >= 2 && delta >= this.minExpectedDelta;
            const rationale = passed
                ? 'review tightened length and added required signposting'
                : `wordCount fast=${fastEval.wordCount}, review=${reviewEval.wordCount}, keyword flags ${fastEval.includesKeyword}->${reviewEval.includesKeyword}`;
            return {
                fastMetric: fastEval.metric,
                reviewMetric: reviewEval.metric,
                delta,
                passed,
                rationale,
                fastWordCount: fastEval.wordCount,
                reviewWordCount: reviewEval.wordCount,
            };
        },
    },
    {
        key: 'bugfix',
        context: 'Scenario: bugfix\nGoal: fix the accumulator logic',
        description: 'Provide a corrected implementation of the total() helper.',
        outputSchema: null,
        maxIterations: 3,
        minExpectedDelta: 1,
        score({ fast, reviewed }) {
            const fastText = asText(fast);
            const reviewText = asText(reviewed);
            const fastMetric = /sum \+ n/.test(fastText) ? 1 : 0;
            const reviewMetric = /sum \+ n/.test(reviewText) ? 1 : 0;
            const delta = reviewMetric - fastMetric;
            const passed = reviewMetric === 1 && /sum - n/.test(fastText) && delta >= this.minExpectedDelta;
            const rationale = passed
                ? 'review corrected the reducer to use addition'
                : `expected review to include "+" reducer. fastMatch=${/sum - n/.test(fastText)}, reviewMatch=${/sum \+ n/.test(reviewText)}`;
            return { fastMetric, reviewMetric, delta, passed, rationale };
        },
    },
    {
        key: 'baseline',
        context: 'Scenario: baseline\nMode: identity',
        description: 'Return the status update without modification.',
        outputSchema: null,
        maxIterations: 2,
        minExpectedDelta: 0,
        score({ fast, reviewed }) {
            const fastText = asText(fast);
            const reviewText = asText(reviewed);
            const identical = fastText === reviewText;
            const metric = identical ? 1 : 0;
            const delta = 0;
            const passed = identical;
            const rationale = passed
                ? 'review preserved the baseline answer as expected'
                : 'review should not alter the baseline scenario output';
            return { fastMetric: metric, reviewMetric: metric, delta, passed, rationale, identical };
        },
    },
];

module.exports = {
    setupLLMStub,
    loadLLMAgentClient,
    reviewScenarios,
};
