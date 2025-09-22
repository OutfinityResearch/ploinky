#!/bin/bash
set -euo pipefail

# This test is self-contained and does not require external utility scripts.
# It creates its own temporary workspace and cleans up after itself.

# --- Setup ---

# Define the project root and the path to the ploinky command
THIS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
PROJECT_ROOT=$(cd -- "$THIS_DIR/../../" &>/dev/null && pwd)
PLOINKY_CMD="$PROJECT_ROOT/bin/ploinky"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-lifecycle-test-XXXXXX)

# Ensure cleanup happens on script exit
trap 'echo "--- Cleaning up test workspace ---"; rm -rf "$TEST_WORKSPACE_DIR"' EXIT

# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Agent Lifecycle Test ---"

# 1. Enable the 'demo' repository
echo "Enabling 'demo' repository..."
"$PLOINKY_CMD" enable repo demo

# 2. Start the workspace with 'demo' as the static agent
echo "Starting workspace with 'demo' agent on port 8080..."
"$PLOINKY_CMD" start demo 8080

# Give the agent and router some time to initialize
echo "Waiting for services to start..."
sleep 5

# 3. Verify the agent is running
echo "Checking agent status and verifying process ID..."
STATUS_OUTPUT=$("$PLOINKY_CMD" status)
echo "Status output:"
echo "$STATUS_OUTPUT"

# Extract PID from status output, e.g., "demo: running (pid: 12345)"
# Using grep and sed to be robust.
AGENT_PID=$(echo "$STATUS_OUTPUT" | grep "demo: running" | sed -n 's/.*(pid: \([0-9]*\)).*/\1/p')

if [[ -n "$AGENT_PID" && "$AGENT_PID" -gt 0 ]]; then
    echo "Found agent PID: $AGENT_PID"
    # Check if the process with the extracted PID is actually running
    if ps -p "$AGENT_PID" > /dev/null; then
        echo "✓ Verification successful: Process with PID $AGENT_PID is running."
    else
        echo "✗ Verification failed: Process with PID $AGENT_PID not found."
        exit 1
    fi
else
    echo "✗ Verification failed: Could not extract PID for 'demo' agent from status output."
    exit 1
fi

# 4. Stop and clean up services
echo "Stopping all services..."
"$PLOINKY_CMD" stop

echo "--- Agent Lifecycle Test Completed Successfully ---"

# Cleanup of the workspace directory is handled by the trap command
