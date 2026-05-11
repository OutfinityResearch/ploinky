import assert from 'node:assert/strict';
import test from 'node:test';

import {
    sanitizeArgumentsForInputSchema,
    sanitizeArgumentsForTool
} from '../../cli/server/mcp-proxy/toolArguments.js';

test('sanitizeArgumentsForInputSchema strips top-level keys rejected by the tool schema', () => {
    const result = sanitizeArgumentsForInputSchema({
        path: '/workspace',
        force: true,
        unexpected: 'drop'
    }, {
        type: 'object',
        additionalProperties: false,
        properties: {
            path: { type: 'string' },
            force: { type: 'boolean' }
        }
    });

    assert.deepEqual(result, {
        path: '/workspace',
        force: true
    });
});

test('sanitizeArgumentsForInputSchema preserves unknown keys when schema allows them', () => {
    const result = sanitizeArgumentsForInputSchema({
        path: '/workspace',
        extra: 'keep'
    }, {
        type: 'object',
        additionalProperties: true,
        properties: {
            path: { type: 'string' }
        }
    });

    assert.deepEqual(result, {
        path: '/workspace',
        extra: 'keep'
    });
});

test('sanitizeArgumentsForInputSchema recursively matches nested object schemas', () => {
    const result = sanitizeArgumentsForInputSchema({
        path: '/workspace',
        options: {
            includeAhead: true,
            transient: 'drop'
        },
        items: [
            { key: 'a', ignored: 1 },
            { key: 'b', ignored: 2 }
        ]
    }, {
        type: 'object',
        additionalProperties: false,
        properties: {
            path: { type: 'string' },
            options: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    includeAhead: { type: 'boolean' }
                }
            },
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        key: { type: 'string' }
                    }
                }
            }
        }
    });

    assert.deepEqual(result, {
        path: '/workspace',
        options: {
            includeAhead: true
        },
        items: [
            { key: 'a' },
            { key: 'b' }
        ]
    });
});

test('sanitizeArgumentsForTool uses the matching advertised input schema', () => {
    const result = sanitizeArgumentsForTool({
        key: 'GIT_GITHUB_TOKEN',
        staleClientField: true
    }, [
        {
            name: 'dpu_secret_get',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    key: { type: 'string' }
                }
            }
        }
    ], 'dpu_secret_get');

    assert.deepEqual(result, {
        key: 'GIT_GITHUB_TOKEN'
    });
});
