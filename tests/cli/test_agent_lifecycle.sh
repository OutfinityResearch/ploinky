#!/bin/bash
set -euo pipefail

# Source the workspace utility functions
THIS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
source "$THIS_DIR/test_workspace_utils.sh"



# Initialize a temporary workspace
TEST_WORKSPACE_DIR=$(init_test_workspace)

# Ensure cleanup happens even if the script exits early
trap "cleanup_test_workspace \"$TEST_WORKSPACE_DIR\"" EXIT

# Change to the temporary workspace directory
cd "$TEST_WORKSPACE_DIR"

echo "--- Running Agent Lifecycle Test ---"

# 1. Enable repo demo
echo "Enabling 'demo' repository..."
"${PLOINKY_CMD}" enable repo demo || echo "Enable failed with $?"

# 2. Start demo agent
echo "Starting 'demo' agent on port 8080..."
"${PLOINKY_CMD}" start demo

# Give the agent some time to start up
sleep 5

# Verify agent is running
echo "Checking agent status..."
"${PLOINKY_CMD}" status | grep "demo: running"

# 3. Disable repo demo
echo "Disabling 'demo' repository..."
"${PLOINKY_CMD}" disable repo demo

# Verify repo is disabled (optional)
# `ploinky list repos` should no longer show it as enabled.

echo "--- Agent Lifecycle Test Completed Successfully ---"

# Cleanup is handled by the trap command