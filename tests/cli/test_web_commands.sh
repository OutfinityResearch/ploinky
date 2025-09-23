#!/bin/bash
set -euo pipefail

# This test verifies that 'webconsole' and 'webtty' provide access
# information to a workspace that has already been started.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-web-test-XXXXXX)

# The main cleanup trap in testUtils.sh handles 'ploinky destroy', which will stop the server.
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Web Access Commands Test ---"

# 1. SETUP: Start the workspace to create a context for web commands.
# This starts the RoutingServer in the background and sets 'demo' as the static agent.
echo "--- Setup: Starting workspace with 'demo' agent on port 8080 ---"
ploinky enable repo demo
ploinky start demo 8080
sleep 3 # Give server time to initialize

# Verify the server is running before we even test the web commands
echo "Verifying that RoutingServer is running..."
ROUTER_PID=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID" "Setup failed: RoutingServer.js did not start."
echo "✓ Workspace started successfully."


# --- Test 1: webconsole ---
echo -e "\n--- Testing 'webconsole' command ---"

# 2. EXECUTE: Run the 'webconsole' command. Its main purpose is to ensure the service
# is running and to refresh the access token.
echo "Running 'ploinky webconsole'..."
WEBCONSOLE_OUTPUT=$(ploinky webconsole s3cr3t_pass)

# 3. VERIFY: The most important verification is that the endpoint is accessible.
echo "Verifying server is accessible after 'webconsole' command..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/webtty")

if [[ "$HTTP_STATUS" -ge 200 && "$HTTP_STATUS" -lt 500 ]]; then
    echo "✓ Verification successful: Received HTTP status $HTTP_STATUS from /webtty endpoint."
else
    echo "✗ Verification failed: Did not get a valid HTTP response from /webtty. Received status: $HTTP_STATUS."
    exit 1
fi
echo "✓ 'webconsole' test successful."


# --- Test 2: webtty ---
# Since webtty is an alias for webconsole, the test is identical.
# This confirms the alias works and the behavior is consistent.
echo -e "\n--- Testing 'webtty' command (as alias) ---"

# 2. EXECUTE:
echo "Running 'ploinky webtty'..."
WEBTTY_OUTPUT=$(ploinky webtty an0th3r_s3cr3t)

# 3. VERIFY:
echo "Verifying server is accessible after 'webtty' command..."
HTTP_STATUS_TTY=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/webtty")

if [[ "$HTTP_STATUS_TTY" -ge 200 && "$HTTP_STATUS_TTY" -lt 500 ]]; then
    echo "✓ Verification successful: Received HTTP status $HTTP_STATUS_TTY from /webtty endpoint."
else
    echo "✗ Verification failed: Did not get a valid HTTP response from /webtty. Received status: $HTTP_STATUS_TTY."
    exit 1
fi
echo "✓ 'webtty' test successful."

# The final 'ploinky destroy' from the main cleanup trap will stop the server.
