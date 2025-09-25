#!/bin/bash
set -euo pipefail

# This test verifies that the 'ploinky expose' command correctly
# injects an environment variable into an agent's container.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-expose-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Expose Command Test ---"

# 1. Initialize workspace and enable the 'basic' repo
echo "Initializing Ploinky workspace and enabling 'basic' repo..."
ploinky enable repo demo

# 3. Use 'expose' to set a custom environment variable for the agent
echo "Exposing MY_SECRET_KEY to the demo agent..."
ploinky expose MY_SECRET_KEY "hello_from_the_test" demo

# 4. Start the agent, which will now have the new environment variable
echo "Starting the 'demo' agent..."
ploinky start demo
sleep 3 # Give the container time to start

# 5. Use 'shell' to run 'printenv' inside the container and verify the variable
echo "Verifying the environment variable inside the container..."
# We pipe the output to grep directly instead of capturing it to a variable,
# because 'ploinky shell' is interactive and uses inherited stdio.
if echo "printenv MY_SECRET_KEY && exit" | ploinky shell demo | grep -q "hello_from_the_test"; then
    echo "✓ Verification successful: Found the correct environment variable."
else
    echo "✗ Verification failed: The exposed environment variable was not found or had the wrong value."
    exit 1
fi

# If the script reaches this point, the trap will handle the final PASSED message.