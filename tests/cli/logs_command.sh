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

# 1. SETUP: Start the workspace to generate real log files.
echo "--- Setup: Starting workspace to generate router.log ---"
ploinky enable repo demo
ploinky start demo 8080
sleep 3 # Give server time to initialize and write the 'server_start' log.

# Verify the server and log file were created
ROUTER_LOG=".ploinky/logs/router.log"
pgrep -f "RoutingServer.js" > /dev/null || (echo "✗ Setup failed: RoutingServer.js did not start." && exit 1)
[ -f "$ROUTER_LOG" ] || (echo "✗ Setup failed: Log file $ROUTER_LOG was not created." && exit 1)
echo "✓ Workspace started and router.log created."


# --- Test 'logs last' ---
echo -e "\n--- Testing 'logs last' command ---"

# Arrange: Generate a unique log entry by making an HTTP request
LAST_TEST_PATH="/unique_path_for_last_test_$(date +%s)"
echo "[last] Generating log entry by curling ${LAST_TEST_PATH}..."
curl -s "http://localhost:8080${LAST_TEST_PATH}" > /dev/null || true # Ignore connection refused errors if server is slow

sleep 1 # Give server time to write the log

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

# Also test that 'logs last webtty' reports no file, as discovered
echo "[last] Verifying 'logs last webtty' gracefully fails..."
LAST_WEBTTY_OUTPUT=$(ploinky logs last 10 webtty)
if ! echo "$LAST_WEBTTY_OUTPUT" | grep -q "No log file"; then
    echo "✗ Verification failed: 'logs last webtty' did not report a missing file as expected."
    exit 1
fi
echo "[last] ✓ 'logs last webtty' correctly reports no file."


# --- Test 'logs tail' ---
echo -e "\n--- Testing 'logs tail' command ---"

# Test 1: Default tail (should be router)
echo "[tail] Verifying 'logs tail' (defaults to router)..."
ploinky logs tail > tail_output_default.log 2>&1 &
TAIL_PID=$!
sleep 1

TAIL_TEST_PATH_1="/unique_path_for_tail_default_$(date +%s)"
echo "[tail] Generating log entry by curling ${TAIL_TEST_PATH_1}..."
curl -s "http://localhost:8080${TAIL_TEST_PATH_1}" > /dev/null || true
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
curl -s "http://localhost:8080${TAIL_TEST_PATH_2}" > /dev/null || true
sleep 1
kill $TAIL_PID
TAIL_PID=""

if ! cat tail_output_router.log | grep -q "\"path\":\"${TAIL_TEST_PATH_2}\"" ; then
    echo "✗ Verification failed: 'logs tail router' did not capture the new log entry."
    exit 1
fi
echo "[tail] ✓ 'logs tail router' correctly follows the router log."

# Test 3: Explicit 'logs tail webtty' (should fail because file doesn't exist)
echo "[tail] Verifying 'logs tail webtty' fails as expected (no log file)..."
TAIL_WEBTTY_OUTPUT=$(ploinky logs tail webtty)
if echo "$TAIL_WEBTTY_OUTPUT" | grep -q "No log file yet"; then
    echo "✗ Verification failed: 'logs tail webtty' reported missing file. This is considered a bug."
    exit 1 # Fail the test because the file is missing
else
    echo "✓ Verification successful: 'logs tail webtty' did not report missing file (unexpected, but test passes)."
    # This else branch should ideally not be reached if the bug exists.
    # If it is reached, it means the file *was* created, which would be a different scenario.
fi

# The final 'ploinky destroy' from the main cleanup trap will stop the server.
