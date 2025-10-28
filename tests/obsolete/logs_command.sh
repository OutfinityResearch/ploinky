#!/bin/bash
set -euo pipefail

# This test verifies the 'logs' subcommands based on the application's actual logging behavior.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-logs-test-XXXXXX)

# Custom cleanup for this test. We need to kill background tail processes.
TAIL_PID=""
trap 'cleanup_logs_tests' EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cleanup_logs_tests() {
    echo "--- Logs Test Cleanup ---"
    if [ -n "$TAIL_PID" ]; then
        kill "$TAIL_PID" || true
    fi
    cleanup # Call original cleanup from testUtils.sh, which runs 'ploinky destroy'
}

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Logs Command Test ---"

echo "--- Setup: Preparing a fake router.log ---"
mkdir -p logs
ROUTER_LOG="logs/router.log"
echo '{"ts":"2020-01-01T00:00:00Z","path":"/bootstrap"}' > "$ROUTER_LOG"
echo "✓ Fake router.log prepared."


# --- Test 'logs last' ---
echo -e "\n--- Testing 'logs last' command ---"

LAST_TEST_PATH="/unique_path_for_last_test_$(date +%s)"
echo "[last] Appending log entry ${LAST_TEST_PATH}..."
echo "{\"ts\":\"$(date -Is)\",\"path\":\"${LAST_TEST_PATH}\"}" >> "$ROUTER_LOG"

# Act & Assert: Check if 'logs last' can find the new entry
LAST_OUTPUT=$(ploinky logs last 10)
if ! echo "$LAST_OUTPUT" | grep -q "\"path\":\"${LAST_TEST_PATH}\"" ; then
    echo "✗ Verification failed: 'logs last' did not show the latest log entry."
    echo "--- Output of 'logs last 10' ---"
    echo "$LAST_OUTPUT"
    echo "---------------------------------"
    exit 1
fi
echo "[last] ✓ 'logs last' correctly shows recent log entries."

echo "[last] Skipping webtty: only router logs supported."


# --- Test 'logs tail' ---
echo -e "\n--- Testing 'logs tail' command ---"

# Test 1: Default tail (router)
echo "[tail] Verifying 'logs tail' (router)..."
ploinky logs tail > tail_output_default.log 2>&1 &
TAIL_PID=$!
sleep 1

TAIL_TEST_PATH_1="/unique_path_for_tail_default_$(date +%s)"
echo "[tail] Generating log entry by curling ${TAIL_TEST_PATH_1}..."
echo "{\"ts\":\"$(date -Is)\",\"path\":\"${TAIL_TEST_PATH_1}\"}" >> "$ROUTER_LOG"
sleep 1
kill $TAIL_PID
TAIL_PID=""

if ! cat tail_output_default.log | grep -q "\"path\":\"${TAIL_TEST_PATH_1}\"" ; then
    echo "✗ Verification failed: Default 'logs tail' did not capture the new log entry."
    exit 1
fi
echo "[tail] ✓ 'logs tail' correctly follows the router log by default."

# Test 2: Explicit 'logs tail router'
echo "[tail] Verifying 'logs tail router' explicitly..."
ploinky logs tail router > tail_output_router.log 2>&1 &
TAIL_PID=$!
sleep 1

TAIL_TEST_PATH_2="/unique_path_for_tail_router_$(date +%s)"
echo "[tail] Generating log entry by curling ${TAIL_TEST_PATH_2}..."
echo "{\"ts\":\"$(date -Is)\",\"path\":\"${TAIL_TEST_PATH_2}\"}" >> "$ROUTER_LOG"
sleep 1
kill $TAIL_PID
TAIL_PID=""

if ! cat tail_output_router.log | grep -q "\"path\":\"${TAIL_TEST_PATH_2}\"" ; then
    echo "✗ Verification failed: 'logs tail router' did not capture the new log entry."
    exit 1
fi
echo "[tail] ✓ 'logs tail router' correctly follows the router log."

echo "[tail] Skipping webtty: only router logs supported."

# The final 'ploinky destroy' from the main cleanup trap will stop the server.
