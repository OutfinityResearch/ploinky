// tests/cli/paramParser.test.mjs
import assert from 'node:assert';
import { parseParametersString } from '../../cli/services/utils.js';

function runTest(name, testFunction) {
    try {
        testFunction();
        console.log(`✔ ${name}`);
    } catch (error) {
        console.error(`✖ ${name}`);
        console.error(error);
        process.exit(1);
    }
}

runTest('should parse a simple flag/value pair', () => {
    const input = '-name John';
    const expected = { name: 'John' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should parse multiple flag/value pairs', () => {
    const input = '-name John -age 30';
    const expected = { name: 'John', age: 30 };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle nested dot-keys', () => {
    const input = '-user.name John -user.age 30';
    const expected = { user: { name: 'John', age: 30 } };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle bracket arrays', () => {
    const input = '-hobbies [coding reading hiking]';
    const expected = { hobbies: ['coding', 'reading', 'hiking'] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle quoted values', () => {
    const input = '-message "Hello, world!"';
    const expected = { message: 'Hello, world!' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle quoted tokens in arrays', () => {
    const input = '-tags ["one tag" two]';
    const expected = { tags: ['one tag', 'two'] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle a mix of everything', () => {
    const input = '-name John -user.age 30 -user.location "New York" -hobbies [coding reading]';
    const expected = {
        name: 'John',
        user: {
            age: 30,
            location: 'New York'
        },
        hobbies: ['coding', 'reading']
    };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle empty string', () => {
    const input = '';
    const expected = {};
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should allow missing value (empty string)', () => {
    const input = '-flag';
    const expected = { flag: '' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

console.log('All paramParser tests passed!');
