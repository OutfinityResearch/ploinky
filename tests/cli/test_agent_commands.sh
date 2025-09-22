#!/bin/bash
set -euo pipefail

# This test covers the agent management lifecycle: new, list, enable, refresh.

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
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Agent Commands Test ---"

# 1. Prerequisite: Add a repository to host the new agent
echo "1. Adding 'basic' repository for setup..."
ploinky add repo basic
echo "✓ 'basic' repo added."

# 2. Create a new agent
echo -e "\n2. Testing 'new agent MyTestAgent basic'..."
ploinky new agent MyTestAgent basic
AGENT_DIR=".ploinky/repos/basic/MyTestAgent"
if [ ! -d "$AGENT_DIR" ] || [ ! -f "$AGENT_DIR/agent.json" ]; then
  echo "✗ Verification failed: Agent directory or manifest not found after 'new'."
  ls -R .ploinky
  exit 1
fi
echo "✓ 'new agent' created the agent directory and manifest."

# 3. List agents to verify creation
echo -e "\n3. Testing 'list agents' after new..."
LIST_OUTPUT_NEW=$(ploinky list agents)
echo "$LIST_OUTPUT_NEW"
if ! echo "$LIST_OUTPUT_NEW" | grep -q "MyTestAgent"; then
  echo "✗ Verification failed: 'MyTestAgent' not found in list after 'new'."
  exit 1
fi
echo "✓ 'list agents' shows the new agent."

# 4. Enable the new agent
echo -e "\n4. Testing 'enable agent MyTestAgent'..."
ploinky enable agent MyTestAgent
LIST_OUTPUT_ENABLE=$(ploinky list agents)
echo "$LIST_OUTPUT_ENABLE"
# Assuming enabled agents are marked with an asterisk
if ! echo "$LIST_OUTPUT_ENABLE" | grep -q "* MyTestAgent"; then
  echo "✗ Verification failed: 'MyTestAgent' not marked as enabled in list."
  exit 1
fi
echo "✓ 'enable agent' works as expected."

# 5. Refresh the agent
echo -e "\n5. Testing 'refresh agent MyTestAgent'..."
# We just check for successful execution.
ploinky refresh agent MyTestAgent
echo "✓ 'refresh agent' command executed successfully."

# 6. Final list agents check
echo -e "\n6. Final 'list agents' check..."
LIST_OUTPUT_FINAL=$(ploinky list agents)
echo "$LIST_OUTPUT_FINAL"
if ! echo "$LIST_OUTPUT_FINAL" | grep -q "* MyTestAgent"; then
  echo "✗ Verification failed: 'MyTestAgent' no longer marked as enabled after refresh."
  exit 1
fi
echo "✓ Agent remains enabled after refresh."

# If the script reaches this point, it is considered a success.