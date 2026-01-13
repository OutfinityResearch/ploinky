# bin/runPlonkyTests.sh - Integration Test Runner

## Overview

Shell script that runs all Ploinky integration tests. Creates a temporary test environment, discovers test cases, executes them sequentially, and cleans up containers and temporary files on completion.

## Source File

`bin/runPlonkyTests.sh`

## Complete Implementation

```bash
#!/bin/bash

# This script runs all Ploinky integration tests.
# It is designed to be run from any directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Robustly find the script's absolute directory ---
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR=$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
SCRIPT_DIR=$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )
# ---

# The project root is one level up from the 'bin' directory
PROJECT_ROOT=$(realpath "${SCRIPT_DIR}/..")

PLOINKY_EXECUTABLE="${PROJECT_ROOT}/cli/index.js"
TESTS_DIR="${PROJECT_ROOT}/tests"

# Check if the main script and tests directory exist
if [ ! -f "$PLOINKY_EXECUTABLE" ]; then
    echo "Error: Could not find the main ploinky script at ${PLOINKY_EXECUTABLE}"
    exit 1
fi
if [ ! -d "$TESTS_DIR" ]; then
    echo "Error: Could not find the tests directory at ${TESTS_DIR}"
    exit 1
fi

# Create a temporary directory for the test run
TEST_RUN_DIR=$(mktemp -d)
echo "Running tests in temporary directory: ${TEST_RUN_DIR}"

# Ensure cleanup happens on script exit
cleanup() {
    echo "Cleaning up..."

    # Determine container runtime
    if command -v podman &> /dev/null; then
        RUNTIME="podman"
    elif command -v docker &> /dev/null; then
        RUNTIME="docker"
    else
        RUNTIME=""
    fi

    # Stop and remove any containers created by the tests
    if [ -n "$RUNTIME" ]; then
        CONTAINERS=$($RUNTIME ps -a --filter "name=^ploinky_" --format "{{.ID}}")
        if [ -n "$CONTAINERS" ]; then
            echo "Stopping and removing test containers..."
            $RUNTIME stop $CONTAINERS > /dev/null
            $RUNTIME rm $CONTAINERS > /dev/null
        fi
    fi

    rm -rf "${TEST_RUN_DIR}"
}
trap cleanup EXIT

# ---

PLOINKY_CMD="node ${PLOINKY_EXECUTABLE}"

echo "--- Running All Ploinky Tests ---"
echo "Project Root: ${PROJECT_ROOT}"

# Change to the temp directory to run the tests
cd "${TEST_RUN_DIR}"

# Find all directories in the tests folder, which represent the test cases
AVAILABLE_TESTS=$(find "${TESTS_DIR}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \;)

if [ -z "$AVAILABLE_TESTS" ]; then
    echo "No tests found in ${TESTS_DIR}"
    exit 0
fi

FAILURES=0
for test_name in $AVAILABLE_TESTS; do
    echo ""
    echo "======================================="
    echo "Executing test: $test_name"
    echo "======================================="
    # Run each test individually. If a test fails, catch the error and continue.
    $PLOINKY_CMD test "$test_name" || {
        echo "Test '$test_name' failed."
        ((FAILURES++))
    }
done

echo ""
echo "======================================="
if [ "$FAILURES" -gt 0 ]; then
    echo "Test run finished with $FAILURES failure(s)."
    exit 1
else
    echo "All tests passed successfully!"
    exit 0
fi
```

## Behavior

### Initialization

1. Resolves script directory (handles symlinks)
2. Locates project root (`SCRIPT_DIR/..`)
3. Validates required files exist:
   - `cli/index.js` - Main CLI
   - `tests/` - Test directory

### Test Discovery

Finds test cases as subdirectories in `tests/`:

```
tests/
├── smoke-basic/      # Test case 1
├── agent-lifecycle/  # Test case 2
└── ...
```

### Test Execution

For each discovered test:

```bash
node cli/index.js test "$test_name"
```

Continues on failure, tracking failure count.

### Cleanup

Trap on EXIT performs:
1. Detects container runtime (podman or docker)
2. Stops containers with `ploinky_` prefix
3. Removes stopped containers
4. Deletes temporary test directory

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 1 | Required files not found |

## Environment

| Variable | Description |
|----------|-------------|
| `PROJECT_ROOT` | Absolute path to project root |
| `PLOINKY_EXECUTABLE` | Path to CLI entrypoint |
| `TESTS_DIR` | Path to tests directory |
| `TEST_RUN_DIR` | Temporary directory for test run |

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│                  Test Execution Flow                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  bin/runPlonkyTests.sh                                  │
│       │                                                 │
│       ▼                                                 │
│  1. Resolve script directory                            │
│       │                                                 │
│       ▼                                                 │
│  2. Validate files exist                                │
│       │                                                 │
│       ▼                                                 │
│  3. Create temp directory                               │
│       │                                                 │
│       ▼                                                 │
│  4. Register cleanup trap                               │
│       │                                                 │
│       ▼                                                 │
│  5. Discover tests in tests/                            │
│       │                                                 │
│       ▼                                                 │
│   ┌─────────────────────────────────────────────────┐   │
│   │  for test_name in $AVAILABLE_TESTS; do          │   │
│   │       │                                         │   │
│   │       ▼                                         │   │
│   │  node cli/index.js test "$test_name"            │   │
│   │       │                                         │   │
│   │       ├── Success: continue                     │   │
│   │       │                                         │   │
│   │       └── Failure: FAILURES++                   │   │
│   │                                                 │   │
│   └─────────────────────────────────────────────────┘   │
│       │                                                 │
│       ▼                                                 │
│  6. Report results                                      │
│       │                                                 │
│       ▼                                                 │
│  7. Cleanup (via trap)                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Container Cleanup

Handles both Docker and Podman:

```bash
# Detect runtime
if command -v podman &> /dev/null; then
    RUNTIME="podman"
elif command -v docker &> /dev/null; then
    RUNTIME="docker"
fi

# Stop and remove containers with ploinky_ prefix
CONTAINERS=$($RUNTIME ps -a --filter "name=^ploinky_" --format "{{.ID}}")
if [ -n "$CONTAINERS" ]; then
    $RUNTIME stop $CONTAINERS
    $RUNTIME rm $CONTAINERS
fi
```

## Usage

```bash
# Run all tests
./bin/runPlonkyTests.sh

# Or from any directory
/path/to/ploinky/bin/runPlonkyTests.sh
```

## Output

```
Running tests in temporary directory: /tmp/tmp.XXXXXX
--- Running All Ploinky Tests ---
Project Root: /path/to/ploinky

=======================================
Executing test: smoke-basic
=======================================
... test output ...

=======================================
Executing test: agent-lifecycle
=======================================
... test output ...

=======================================
All tests passed successfully!
```

## Related Modules

- [../cli/cli-main.md](../cli/cli-main.md) - CLI test command
- [../../tests/README.md](../../tests/README.md) - Test specifications
