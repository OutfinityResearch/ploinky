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
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
SCRIPT_DIR=$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )
# ---

# The project root is one level up from the 'bin' directory
PROJECT_ROOT=$(realpath "${SCRIPT_DIR}/..")

PLOINKY_EXECUTABLE="${PROJECT_ROOT}/src/index.js"
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
trap 'echo "Cleaning up..."; rm -rf "${TEST_RUN_DIR}"' EXIT

# ---

PLOINKY_CMD="node ${PLOINKY_EXECUTABLE}"

echo "--- Running All Ploinky Tests ---"
echo "Project Root: ${PROJECT_ROOT}"

# Change to the temp directory to run the tests
cd "${TEST_RUN_DIR}"

# Find all directories in the tests folder, which represent the test cases
# Note: We use the absolute path to TESTS_DIR now
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
    echo "❌ Test run finished with $FAILURES failure(s)."
    exit 1
else
    echo "✅ All tests passed successfully!"
    exit 0
fi