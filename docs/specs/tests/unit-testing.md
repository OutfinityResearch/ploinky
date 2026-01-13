# Unit Testing Guidelines

## Overview

Guidelines for writing and maintaining unit tests for Ploinky components. Unit tests verify individual functions and classes in isolation from external dependencies.

## Principles

### Isolation

Each unit test should test exactly one thing:

```javascript
// Good: Tests one behavior
test('parseManifest returns null for invalid JSON', () => {
    const result = parseManifest('not json');
    expect(result).toBeNull();
});

// Bad: Tests multiple behaviors
test('parseManifest works', () => {
    expect(parseManifest('not json')).toBeNull();
    expect(parseManifest('{}')).toEqual({});
    expect(parseManifest('{"name":"x"}')).toHaveProperty('name');
});
```

### Determinism

Tests must produce the same result every time:

```javascript
// Good: Predictable output
test('generateId returns 16-char hex', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
});

// Bad: Time-dependent
test('isRecent returns true for recent items', () => {
    const item = { created: Date.now() - 100 };
    expect(isRecent(item)).toBe(true);
});
```

### Speed

Unit tests should execute quickly:

- Target: < 100ms per test
- No network calls
- No file system (except mocked)
- No container operations

## Test Structure

### File Organization

```
cli/
├── services/
│   ├── config.js
│   └── config.test.js     # Test file alongside source
└── commands/
    ├── cli.js
    └── cli.test.js
```

### Test Template

```javascript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { functionUnderTest } from './module.js';

describe('functionUnderTest', () => {
    let context;

    beforeEach(() => {
        // Setup
        context = {};
    });

    afterEach(() => {
        // Cleanup
    });

    describe('when given valid input', () => {
        test('returns expected output', () => {
            const result = functionUnderTest('valid');
            expect(result).toEqual({ success: true });
        });
    });

    describe('when given invalid input', () => {
        test('throws appropriate error', () => {
            expect(() => functionUnderTest(null))
                .toThrow('Input required');
        });
    });
});
```

## Mocking

### Dependency Mocking

```javascript
import { vi } from 'vitest';
import fs from 'node:fs';
import { loadConfig } from './config.js';

vi.mock('node:fs');

test('loadConfig reads from file', () => {
    fs.readFileSync.mockReturnValue('{"key": "value"}');

    const config = loadConfig('/path/to/config.json');

    expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/config.json', 'utf8');
    expect(config).toEqual({ key: 'value' });
});
```

### Module Mocking

```javascript
vi.mock('./dependency.js', () => ({
    dependencyFunction: vi.fn(() => 'mocked value')
}));
```

### Time Mocking

```javascript
import { vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
});

afterEach(() => {
    vi.useRealTimers();
});

test('formats date correctly', () => {
    expect(formatDate(new Date())).toBe('2024-01-01');
});
```

## Assertions

### Common Patterns

```javascript
// Equality
expect(result).toBe(5);
expect(result).toEqual({ a: 1, b: 2 });

// Truthiness
expect(result).toBeTruthy();
expect(result).toBeFalsy();
expect(result).toBeNull();
expect(result).toBeUndefined();

// Numbers
expect(result).toBeGreaterThan(5);
expect(result).toBeLessThanOrEqual(10);
expect(result).toBeCloseTo(0.3, 5);

// Strings
expect(result).toMatch(/pattern/);
expect(result).toContain('substring');

// Arrays
expect(array).toHaveLength(3);
expect(array).toContain(item);
expect(array).toContainEqual({ id: 1 });

// Objects
expect(object).toHaveProperty('key');
expect(object).toHaveProperty('nested.key', 'value');

// Errors
expect(() => fn()).toThrow();
expect(() => fn()).toThrow('specific message');
expect(() => fn()).toThrow(ErrorType);

// Async
await expect(asyncFn()).resolves.toBe('result');
await expect(asyncFn()).rejects.toThrow('error');
```

## Coverage

### Running Coverage

```bash
npm run test:coverage
```

### Coverage Thresholds

```javascript
// vitest.config.js
export default {
    test: {
        coverage: {
            statements: 80,
            branches: 75,
            functions: 80,
            lines: 80
        }
    }
};
```

### Excluding from Coverage

```javascript
/* istanbul ignore next */
function debugOnlyCode() {
    // Not covered
}
```

## Best Practices

### Naming

- Describe behavior, not implementation
- Use "should" or "when" patterns
- Be specific about conditions

```javascript
// Good
test('should throw when config file is missing')
test('returns empty array when no agents found')

// Bad
test('config test 1')
test('works correctly')
```

### Arrange-Act-Assert

```javascript
test('adds item to cart', () => {
    // Arrange
    const cart = new Cart();
    const item = { id: 1, price: 10 };

    // Act
    cart.add(item);

    // Assert
    expect(cart.items).toContainEqual(item);
    expect(cart.total).toBe(10);
});
```

### Single Responsibility

Each test should have one reason to fail:

```javascript
// Good: Separate tests
test('adds item to cart', () => {
    cart.add(item);
    expect(cart.items).toContainEqual(item);
});

test('updates total when item added', () => {
    cart.add(item);
    expect(cart.total).toBe(item.price);
});
```

## Related Documentation

- [integration-testing.md](./integration-testing.md) - Integration tests
- [cli/README.md](./cli/README.md) - CLI tests
