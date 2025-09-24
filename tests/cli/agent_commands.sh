#!/bin/bash
set -euo pipefail

# This test covers the agent management lifecycle: list, enable, and refresh.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-agent-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
DIRNAME=$(basename "$TEST_WORKSPACE_DIR") # Extract dirname for process matching
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Agent Commands Test ---"

# 1. Initialize workspace and enable the 'demo' repository
echo "1. Initializing workspace and enabling 'demo' repository..."
ploinky enable repo demo
echo "✓ 'demo' repo enabled."

# 2. List agents to verify the 'demo' agent is available
echo -e "\n2. Testing 'list agents'..."
LIST_OUTPUT=$(ploinky list agents)
echo "$LIST_OUTPUT"
if ! echo "$LIST_OUTPUT" | grep -q "demo"; then
  echo "✗ Verification failed: 'demo' agent not found in 'list agents' output."
  exit 1
fi
echo "✓ 'list agents' shows the 'demo' agent."

# 4. Refresh the agent
echo -e "\n4. Testing 'refresh agent demo'..."
# We just check for successful execution.
ploinky refresh agent demo
echo "Waiting for agent to restart..."
sleep 2
echo "✓ 'refresh agent' command executed successfully."

# 5. Final process check
echo -e "\n5. Final process check..."
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Verification failed: 'demo' agent process is not running after refresh." && exit 1)
echo "✓ Agent process is running after refresh."

# If the script reaches this point, it is considered a success.
