# Ploinky Testing Specifications

## Overview

This directory contains testing specifications for the Ploinky platform. Tests are organized by type and scope, providing comprehensive coverage of all platform functionality.

## Directory Structure

```
tests/
├── README.md                    # This file
├── unit-testing.md              # Unit test guidelines
├── integration-testing.md       # Integration test guidelines
├── unit/                        # Unit test specifications
│   └── profile-system.md
├── cli/                         # CLI test specifications
│   ├── README.md
│   └── fast-suite.md
└── smoke/                       # Smoke test specifications
    └── README.md
```

## Test Categories

### Unit Tests

Individual component tests in isolation.

- Function-level testing
- Mocking of dependencies
- Fast execution
- High coverage

See: [unit-testing.md](./unit-testing.md)
See: [unit/profile-system.md](./unit/profile-system.md)

### Integration Tests

Tests for component interactions.

- Multi-module testing
- Real dependencies
- Container orchestration
- API contracts

See: [integration-testing.md](./integration-testing.md)

### CLI Tests

Command-line interface testing.

- Command execution
- Argument parsing
- Output validation
- Error handling

See: [cli/README.md](./cli/README.md)
See: [cli/fast-suite.md](./cli/fast-suite.md)

### Smoke Tests

Basic functionality verification.

- Critical path testing
- Quick validation
- Pre-deployment checks
- Sanity testing

See: [smoke/README.md](./smoke/README.md)

## Running Tests

### All Tests

```bash
# Run complete test suite
./bin/runPlonkyTests.sh
```

### Specific Category

```bash
# Run specific test category
ploinky test smoke
ploinky test cli
```

### Single Test

```bash
# Run individual test
ploinky test smoke-basic
```

## Test Development

### Creating New Tests

1. Choose appropriate category
2. Create test directory in `ploinky/tests/`
3. Add test implementation
4. Create documentation in `docs/specs/tests/`
5. Verify with test runner

### Test Directory Structure

```
tests/
└── my-new-test/
    ├── manifest.json     # Test configuration
    ├── setup.sh          # Optional setup script
    ├── test.sh           # Test implementation
    ├── teardown.sh       # Optional cleanup
    └── expected/         # Expected outputs
```

### Test Manifest Format

```json
{
  "name": "my-new-test",
  "description": "Test description",
  "type": "integration",
  "timeout": 120,
  "requires": ["docker", "network"],
  "skip_reason": null
}
```

## Coverage Requirements

| Component | Minimum Coverage |
|-----------|------------------|
| Core CLI | 80% |
| Services | 70% |
| Server | 60% |
| Agent | 70% |
| WebChat | 50% |

## Test Environment

### Required Tools

- Node.js 18+
- Docker or Podman
- Bash 4+
- curl
- jq

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PLOINKY_TEST_TIMEOUT` | Test timeout in seconds |
| `PLOINKY_TEST_VERBOSE` | Enable verbose output |
| `PLOINKY_TEST_CLEANUP` | Auto-cleanup after tests |

## Continuous Integration

Tests run on:
- Pull request creation
- Push to main branch
- Scheduled nightly runs

### CI Configuration

```yaml
test:
  stages:
    - unit
    - integration
    - smoke
  timeout: 30m
  parallel: 4
```

## Related Documentation

- [../evals/README.md](../evals/README.md) - Evaluation scenarios
- [../DS/DS02-architecture.md](../DS/DS02-architecture.md) - System architecture
- [../src/bin/bin-run-tests.md](../src/bin/bin-run-tests.md) - Test runner docs
