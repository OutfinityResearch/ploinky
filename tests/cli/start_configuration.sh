#!/bin/bash
set -euo pipefail

# This test verifies the 'ploinky start' command's configuration handling
# for explicit, default, and saved ports.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-start-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Start Command Configuration Test ---"

# 1. Initialize workspace and enable demo repo
echo "Initializing Ploinky workspace and enabling 'demo' repo..."
ploinky enable repo demo

# --- Test 1: Explicit Agent, Default Port ---
echo "--- Test 1: Starting with explicit agent and default port (demo on 8080) ---"
ploinky start demo
sleep 3

echo "Verifying that default port 8080 is in use..."
PORT_PID=$(lsof -i :8080 || true)
assert_not_empty "$PORT_PID" "Expected a process to be listening on the default port 8080, but none was found."
echo "✓ Default port 8080 is in use as expected."

# --- Test 2: Explicit Agent and Port ---
echo "--- Test 2: Starting with explicit agent and port (demo 1111) ---"
ploinky start demo 1111
sleep 2 # Give services time to start


echo "Verifying that port 1111 is in use..."
PORT_PID=$(lsof -i :1111 || true)
assert_not_empty "$PORT_PID" "Expected a process to be listening on port 1111, but none was found."
echo "✓ Port 1111 is in use as expected."

ploinky shutdown

# --- Test 3: Saved Configuration ---
echo "--- Test 3: Starting with saved configuration ---"
echo "Running 'ploinky start' to use the previously saved config..."
ploinky start
sleep 2

echo "Verifying that port 1111 is in use from saved configuration..."
PORT_PID=$(lsof -i :1111 || true)
assert_not_empty "$PORT_PID" "Expected a process to be listening on port 1111 from the saved configuration."
echo "✓ Port 1111 is in use from saved configuration as expected."

# The final 'ploinky destroy' will be handled by the cleanup trap on exit.
# If the script reaches this point, the trap will handle the final PASSED message.