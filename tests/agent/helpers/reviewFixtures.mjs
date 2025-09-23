import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} from '../../../Agent/client/LLMClient.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    const messages = workingHistory.map(entry => entry?.message || '');
    const lastMessage = messages.length ? messages[messages.length - 1] : '';
    callInvocations.push({ modelName, lastMessage, messages, options });

    if (messages.some(msg => msg.includes('Create a concise step-by-step plan'))) {
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

    const scenarioSource = [...messages].reverse().find(msg => /Scenario:\s*[A-Za-z0-9_-]+/i.test(msg)) || lastMessage;
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

export function setupLLMStub() {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'stub-openai-key';
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'stub-anthropic-key';
    process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

    __setCallLLMWithModelForTests(stubbedCallLLMWithModel);

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
        restore() {
            __resetCallLLMWithModelForTests();
        },
    };
}

export async function loadLLMAgentClient() {
    const llmAgentClientPath = path.join(__dirname, '../../../Agent/client/LLMAgentClient.mjs');
    const moduleUrl = `${pathToFileURL(llmAgentClientPath).href}?t=${Date.now()}`;
    return import(moduleUrl);
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

export const reviewScenarios = [
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
            const coverage = value => requiredKeys.reduce(
                (acc, key) => acc + (value && Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined ? 1 : 0),
                0,
            );
            const fastMetric = coverage(fast);
            const reviewMetric = coverage(reviewed);
            const delta = reviewMetric - fastMetric;
            const correctRisk = reviewed && reviewed.riskScore === 0.12;
            const passed = reviewMetric === requiredKeys.length && delta >= this.minExpectedDelta && correctRisk;
            const missing = requiredKeys.filter(key => !reviewed || reviewed[key] === undefined);
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
            const extractNumber = text => {
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
            const evaluate = text => {
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
                ? 'review respected constraints and improved relevance'
                : `expected deliverables mention and <=40 words, observed metric=${reviewEval.metric}, delta=${delta}`;
            return { fastEval, reviewEval, delta, passed, rationale };
        },
    },
    {
        key: 'bugfix',
        context: 'Scenario: bugfix\nFunction: total',
        description: 'Fix the bug in the provided function implementation.',
        outputSchema: null,
        maxIterations: 3,
        minExpectedDelta: 1,
        score({ fast, reviewed }) {
            const fastText = asText(fast);
            const reviewText = asText(reviewed);
            const fastMetric = /sum - n/.test(fastText) ? 0 : 1;
            const reviewMetric = /sum \+ n/.test(reviewText) ? 1 : 0;
            const delta = reviewMetric - fastMetric;
            const passed = reviewMetric === 1 && delta >= this.minExpectedDelta;
            const rationale = passed
                ? 'review corrected the accumulator logic'
                : 'expected corrected reducer using addition after review';
            return { fastMetric, reviewMetric, delta, passed, rationale };
        },
    },
];

export { asText };
