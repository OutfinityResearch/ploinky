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

runTest('should parse a simple key-value pair', () => {
    const input = 'name=John';
    const expected = { name: 'John' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should parse multiple key-value pairs', () => {
    const input = 'name=John,age=30';
    const expected = { name: 'John', age: 30 };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle nested objects', () => {
    const input = 'user.name=John,user.age=30';
    const expected = { user: { name: 'John', age: 30 } };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle arrays', () => {
    const input = 'hobbies[]=coding,reading,hiking';
    const expected = { hobbies: ['coding', 'reading', 'hiking'] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle arrays with a single value', () => {
    const input = 'hobbies[]=coding';
    const expected = { hobbies: ['coding'] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle quoted values', () => {
    const input = 'message="Hello, world!"';
    const expected = { message: 'Hello, world!' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle quoted values with commas', () => {
    const input = 'message="Hello, world!",user.name="Doe, John"';
    const expected = { message: 'Hello, world!', user: { name: 'Doe, John' } };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle a mix of everything', () => {
    const input = 'name=John,user.age=30,user.location="New York",hobbies[]=coding,reading';
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

runTest('should handle keys with no value', () => {
    const input = 'name=';
    const expected = { name: '' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle multiple arrays', () => {
    const input = 'hobbies[]=coding,reading,skills[]=js,ts';
    const expected = { hobbies: ['coding', 'reading'], skills: ['js', 'ts'] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle deep nested objects', () => {
    const input = 'a.b.c.d=value';
    const expected = { a: { b: { c: { d: 'value' } } } };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle values with equal signs', () => {
    const input = 'formula=a=b+c';
    const expected = { formula: 'a=b+c' };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle an empty array with new syntax', () => {
    const input = 'hobbies[]';
    const expected = { hobbies: [] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

runTest('should handle new array syntax with values', () => {
    const input = 'hobbies[],reading,skills[]';
    const expected = { hobbies: ['reading'], skills: [] };
    assert.deepStrictEqual(parseParametersString(input), expected);
});

console.log('All paramParser tests passed!');
