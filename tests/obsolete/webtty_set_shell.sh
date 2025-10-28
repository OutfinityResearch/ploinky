#!/bin/bash
set -euo pipefail
exit 1
#testul se blocheaza
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

# --- Setup: Enable and start demo agent ---
echo "Enabling demo agent..."
ploinky enable repo demo
echo "Starting demo agent..."
ploinky start demo

# --- Test 1: webconsole ---
echo -e "\n--- Testing 'webconsole' command ---"

# 2. EXECUTE: Run the 'webconsole' command. Its main purpose is to ensure the service
# is running and to refresh the access token.
echo "Running 'ploinky webconsole'..."
WEBCONSOLE_OUTPUT=$(ploinky webconsole)

# 3. VERIFY: Token stored and URL printed.
echo "Verifying token and URL after 'webconsole'..."
grep -q '^WEBTTY_TOKEN=' .ploinky/.secrets || (echo "✗ WEBTTY_TOKEN not stored." && exit 1)
echo "$WEBCONSOLE_OUTPUT" | grep -q "/webtty?token=" || (echo "✗ 'webconsole' did not print access URL." && exit 1)
echo "✓ 'webconsole' test successful."

# --- Test 2: webtty with dash shell ---
echo -e "\n--- Testing 'webtty dash' command ---"

# 2. EXECUTE:
echo "Running 'ploinky webtty dash'..."
WEBTTY_OUTPUT=$(ploinky webtty dash)

# 3. VERIFY: Token stored, URL printed, WEBTTY_SHELL set to dash, and log confirms dash shell execution.
echo "Verifying token, URL, and shell config after 'webtty dash'..."
grep -q '^WEBTTY_TOKEN=' .ploinky/.secrets || (echo "✗ WEBTTY_TOKEN not stored after 'webtty dash'." && exit 1)
echo "$WEBTTY_OUTPUT" | grep -q "/webtty?token=" || (echo "✗ 'webtty dash' did not print access URL." && exit 1)
grep -q '^WEBTTY_SHELL=/usr/bin/dash' .ploinky/.secrets || (echo "✗ WEBTTY_SHELL not set to 'dash'." && exit 1)