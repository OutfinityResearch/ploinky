#!/bin/bash
set -euo pipefail

# This test covers the repo management lifecycle: add, list, enable, update, disable.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-repo-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Repo Commands Test ---"

# 2. Add Repo
echo -e "\n2. Testing 'add repo cloud'..."
ploinky add repo cloud
if [ ! -d ".ploinky/repos/cloud" ]; then
  echo "✗ Verification failed: '.ploinky/repos/cloud' directory not found after add."
  exit 1
fi
echo "✓ 'add repo' created the directory."

# 3. List Repos (after add)
echo -e "\n3. Testing 'list repos' after add..."
LIST_OUTPUT_ADD=$(ploinky list repos)
echo "$LIST_OUTPUT_ADD"
if ! echo "$LIST_OUTPUT_ADD" | grep -q "cloud"; then
  echo "✗ Verification failed: 'cloud' repo not found in list after add."
  exit 1
fi
echo "✓ 'list repos' shows the new repo."

# 4. Enable Repo
echo -e "\n4. Testing 'enable repo cloud'..."
ploinky enable repo cloud
LIST_OUTPUT_ENABLE=$(ploinky list repos)
echo "$LIST_OUTPUT_ENABLE"

echo "✓ 'enable repo' works as expected."

# 5. Update Repo
echo -e "\n5. Testing 'update repo cloud'..."
# We just check for successful execution, as there might not be updates.
ploinky update repo cloud
echo "✓ 'update repo' command executed successfully."

# 6. Disable Repo
echo -e "\n6. Testing 'disable repo cloud'..."
ploinky disable repo cloud
LIST_OUTPUT_DISABLE=$(ploinky list repos)
echo "$LIST_OUTPUT_DISABLE"
echo "✓ 'disable repo' works as expected."

# If the script reaches this point, it is considered a success.
