#!/bin/bash
set -euo pipefail

# This test verifies the 'client' subcommands: status, methods, and task.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-client-test-XXXXXX)

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Client Commands Test ---"

# 1. SETUP: Start the workspace to create a context for client commands.
echo "--- Setup: Starting workspace with 'demo' agent on port 8080 ---"
ploinky enable repo demo
ploinky start demo 8080
sleep 3 # Give server and agent time to initialize

# Verify the server is running before testing
echo "Verifying that RoutingServer is running..."
ROUTER_PID=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID" "Setup failed: RoutingServer.js did not start."
echo "✓ Workspace started successfully."


# --- Test 1: client status ---
echo -e "\n--- Testing 'client status demo' ---"
STATUS_OUTPUT=$(ploinky client status demo)
echo "Command output: $STATUS_OUTPUT"

echo "$STATUS_OUTPUT" | grep -q "http=200" || (echo "✗ Verification failed: 'client status' did not return HTTP 200." && exit 1)
echo "$STATUS_OUTPUT" | grep -q "ok=true" || (echo "✗ Verification failed: 'client status' did not return ok=true." && exit 1)
echo "✓ 'client status' verification successful."


# --- Test 2: client methods ---
echo -e "\n--- Testing 'client methods demo' ---"
METHODS_OUTPUT=$(ploinky client methods demo)
echo "Command output: $METHODS_OUTPUT"

# Verify the output is a valid JSON array (starts with [ and ends with ])
if [[ "$METHODS_OUTPUT" =~ ^\[.*\]$ ]]; then
    echo "✓ 'client methods' returned a valid JSON array."
else
    echo "✗ Verification failed: 'client methods' did not return a JSON array."
    exit 1
fi
echo "✓ 'client methods' verification successful."


# --- Test 3: client task ---
echo -e "\n--- Testing 'client task demo' ---"
# This test assumes the 'demo' agent supports a task that echoes arguments.
TASK_TEXT="hello_from_the_test"
TASK_OUTPUT=$(ploinky client task demo -command echo -text "$TASK_TEXT")
echo "Command output: $TASK_OUTPUT"

# Verify the JSON output contains the echoed text.
# We use grep for simplicity. A more robust test would use a JSON parser like 'jq'.
echo "$TASK_OUTPUT" | grep -q "$TASK_TEXT" || (echo "✗ Verification failed: Task output did not contain the expected text '$TASK_TEXT'." && exit 1)
echo "$TASK_OUTPUT" | grep -q '"ok": true' || (echo "✗ Verification failed: Task output did not contain '"ok": true'." && exit 1)
echo "✓ 'client task' verification successful."


# The final 'ploinky destroy' from the main cleanup trap will stop the server and agent.
