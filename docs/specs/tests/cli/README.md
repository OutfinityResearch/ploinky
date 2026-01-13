# CLI Test Specifications

## Overview

Test specifications for Ploinky command-line interface operations. These tests verify command parsing, execution, output formatting, and error handling.

## Test Categories

### Command Parsing

Tests for argument and option parsing.

```
tests/cli-parsing/
├── manifest.json
├── test-valid-args.sh
├── test-invalid-args.sh
├── test-help-flags.sh
└── expected/
```

#### Test Cases

| Test | Description | Expected |
|------|-------------|----------|
| valid-args | Parse standard arguments | Clean execution |
| invalid-args | Handle invalid arguments | Error message |
| help-flags | Display help with --help | Help text output |
| version-flag | Display version with --version | Version number |

### Command Execution

Tests for core command functionality.

```
tests/cli-commands/
├── manifest.json
├── test-init.sh
├── test-start.sh
├── test-stop.sh
├── test-list.sh
└── expected/
```

#### Test Cases

| Test | Description | Expected |
|------|-------------|----------|
| init | Initialize workspace | .ploinky created |
| start | Start agent | Container running |
| stop | Stop agent | Container stopped |
| list | List agents | Agent list output |
| status | Show status | Status display |
| connect | Connect to agent | PTY session |

### Output Formats

Tests for output formatting options.

```
tests/cli-output/
├── manifest.json
├── test-json-output.sh
├── test-table-output.sh
├── test-quiet-output.sh
└── expected/
```

#### Test Cases

| Test | Description | Expected |
|------|-------------|----------|
| json-output | JSON format with --json | Valid JSON |
| table-output | Table format (default) | Formatted table |
| quiet-output | Minimal output with --quiet | Essential only |
| verbose-output | Detailed with --verbose | Debug info |

### Error Handling

Tests for error conditions.

```
tests/cli-errors/
├── manifest.json
├── test-missing-agent.sh
├── test-permission-denied.sh
├── test-network-error.sh
└── expected/
```

#### Test Cases

| Test | Description | Expected |
|------|-------------|----------|
| missing-agent | Non-existent agent | Clear error |
| permission-denied | Access denied | Permission error |
| network-error | Connection failure | Network error |
| timeout | Operation timeout | Timeout error |

## Test Implementation

### Test Script Template

```bash
#!/bin/bash
# test-<name>.sh

set -e

# Setup
PLOINKY_CMD="${PLOINKY_CMD:-ploinky}"
WORK_DIR=$(mktemp -d)
cd "$WORK_DIR"

cleanup() {
    cd /
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Test
echo "Testing: <description>"

# Execute command
OUTPUT=$($PLOINKY_CMD <command> 2>&1)
EXIT_CODE=$?

# Assertions
if [[ $EXIT_CODE -ne 0 ]]; then
    echo "FAIL: Expected exit code 0, got $EXIT_CODE"
    exit 1
fi

if [[ ! $OUTPUT =~ "expected pattern" ]]; then
    echo "FAIL: Output did not match expected pattern"
    echo "Got: $OUTPUT"
    exit 1
fi

echo "PASS"
```

### Manifest Format

```json
{
    "name": "cli-parsing",
    "description": "CLI argument parsing tests",
    "type": "cli",
    "timeout": 30,
    "requires": ["node"],
    "tests": [
        {
            "name": "valid-args",
            "script": "test-valid-args.sh",
            "expected_exit": 0
        },
        {
            "name": "invalid-args",
            "script": "test-invalid-args.sh",
            "expected_exit": 1
        }
    ]
}
```

## Running CLI Tests

### All CLI Tests

```bash
ploinky test cli
```

### Specific Test

```bash
ploinky test cli-parsing
```

### With Verbose Output

```bash
PLOINKY_TEST_VERBOSE=1 ploinky test cli
```

## Expected Output Files

Store expected outputs for comparison:

```
expected/
├── init-output.txt
├── list-output.txt
├── help-output.txt
└── version-output.txt
```

### Comparison

```bash
# In test script
EXPECTED=$(cat expected/output.txt)
if [[ "$OUTPUT" != "$EXPECTED" ]]; then
    echo "FAIL: Output mismatch"
    diff <(echo "$EXPECTED") <(echo "$OUTPUT")
    exit 1
fi
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLOINKY_CMD` | Path to ploinky command | `ploinky` |
| `PLOINKY_TEST_VERBOSE` | Enable verbose output | `0` |
| `PLOINKY_TEST_TIMEOUT` | Test timeout seconds | `30` |

## Test Matrix

| Command | Parsing | Execution | Output | Error |
|---------|---------|-----------|--------|-------|
| init | Yes | Yes | Yes | Yes |
| start | Yes | Yes | Yes | Yes |
| stop | Yes | Yes | Yes | Yes |
| restart | Yes | Yes | Yes | Yes |
| list | Yes | Yes | Yes | Yes |
| status | Yes | Yes | Yes | Yes |
| connect | Yes | Yes | N/A | Yes |
| config | Yes | Yes | Yes | Yes |
| profile | Yes | Yes | Yes | Yes |

## Related Documentation

- [../README.md](../README.md) - Testing overview
- [../unit-testing.md](../unit-testing.md) - Unit tests
- [../../src/cli/commands/](../../src/cli/commands/) - Command implementations
