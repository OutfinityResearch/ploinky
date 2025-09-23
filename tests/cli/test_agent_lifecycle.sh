#!/bin/bash
set -euo pipefail

# This test is self-contained and provides clear PASS/FAIL status and reason at the end.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-lifecycle-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Agent Lifecycle Test ---"

# 1. Enable the 'demo' repository
echo "Enabling 'demo' repository..."
ploinky enable repo demo

# 2. Start the workspace with 'demo' as the static agent
echo "Starting workspace with 'demo' agent on port 8080..."
ploinky start demo 8080

# Give the agent and router some time to initialize
echo "Waiting for services to start..."
sleep 2

# 3. Verify the router process is running directly
echo "Verifying the router process is running..."

# Find the PID of the RoutingServer.js process directly.
# pgrep -f matches against the full command line.
ROUTER_PID=$(pgrep -f "RoutingServer.js")

if [[ -n "$ROUTER_PID" && "$ROUTER_PID" -gt 0 ]]; then
    echo "✓ Verification successful: Found router process with PID $ROUTER_PID."
    # We can still run ploinky status for additional info/logging
    echo "--- Ploinky Status ---"
    ploinky status
    echo "----------------------"
else
    echo "✗ Verification failed: Could not find running router process."
    # Print process list for debugging
    echo "--- Current Processes ---"
    ps aux | grep -i "node" || true
    echo "-------------------------"
    exit 1
fi

# 4. Stop and clean up services
echo "Stopping all services..."
ploinky destroy

# If the script reaches this point, it is considered a success.
# The trap will handle the final PASSED/FAILED message.