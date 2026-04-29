import test from 'node:test';
import assert from 'node:assert/strict';

import { describeShellFailure } from '../../Agent/lib/toolError.mjs';

test('describeShellFailure prefers JSON message field on stdout', () => {
    const result = {
        code: 1,
        stdout: '{"ok":false,"error":"dpu_tool_failed","message":"Authentication required."}',
        stderr: ''
    };
    assert.equal(
        describeShellFailure(result),
        'dpu_tool_failed: Authentication required.'
    );
});

test('describeShellFailure returns just the message when no error field', () => {
    const result = {
        code: 1,
        stdout: '{"ok":false,"message":"Bad payload"}',
        stderr: ''
    };
    assert.equal(describeShellFailure(result), 'Bad payload');
});

test('describeShellFailure returns just the error field when no message', () => {
    const result = {
        code: 2,
        stdout: '{"ok":false,"error":"NOT_FOUND"}',
        stderr: ''
    };
    assert.equal(describeShellFailure(result), 'NOT_FOUND');
});

test('describeShellFailure deduplicates when message and error match', () => {
    const result = {
        code: 1,
        stdout: '{"error":"timeout","message":"timeout"}',
        stderr: ''
    };
    assert.equal(describeShellFailure(result), 'timeout');
});

test('describeShellFailure falls back to stderr when stdout is non-JSON', () => {
    const result = {
        code: 127,
        stdout: 'not json output',
        stderr: '/usr/bin/sh: bad-cmd: not found'
    };
    assert.equal(describeShellFailure(result), '/usr/bin/sh: bad-cmd: not found');
});

test('describeShellFailure ignores non-envelope JSON message stdout', () => {
    const result = {
        code: 1,
        stdout: '{"message":"ordinary stdout"}',
        stderr: 'real failure'
    };
    assert.equal(describeShellFailure(result), 'real failure');
});

test('describeShellFailure truncates very large failure messages', () => {
    const longMessage = 'x'.repeat(5000);
    const result = {
        code: 1,
        stdout: JSON.stringify({ ok: false, message: longMessage }),
        stderr: ''
    };
    const message = describeShellFailure(result);
    assert.equal(message.length, 4099);
    assert.match(message, /\.\.\.$/);
});

test('describeShellFailure falls back to exit code when stdout and stderr are empty', () => {
    const result = { code: 1, stdout: '', stderr: '' };
    assert.equal(describeShellFailure(result), 'command exited with code 1');
});

test('describeShellFailure handles JSON without error/message fields by falling back', () => {
    const result = {
        code: 5,
        stdout: '{"ok":false}',
        stderr: 'permission denied'
    };
    assert.equal(describeShellFailure(result), 'permission denied');
});

test('describeShellFailure tolerates whitespace and surfaces null code as-is', () => {
    const result = {
        code: null,
        stdout: '   ',
        stderr: '   '
    };
    assert.equal(describeShellFailure(result), 'command exited with code null');
});
