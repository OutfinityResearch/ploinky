#!/bin/bash
set -euo pipefail

# This test verifies the 'ploinky shell' command by executing a
# command non-interactively within the agent's container.

# --- Setup ---

# Source the utility functions
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

# Create a temporary directory for the test workspace
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-shell-test-XXXXXX)

# Set traps to call the appropriate functions on exit or error
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

# This test assumes 'ploinky' is available in the system's PATH.
# Navigate into the temporary workspace
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Shell Command Test ---"

# 1. Enable the agent to register it for use
echo "Enabling 'alpine-bash' agent..."
ploinky enable agent alpine-bash

# 2. Run a sequence of commands inside the agent's shell and capture the output.
# We use a "here document" to pipe multiple commands that a user would type.
echo "Executing a whoami, ls via 'ploinky shell'..."
SHELL_OUTPUT=$(ploinky shell alpine-bash <<'EOF'
echo "--- First command: whoami ---"
whoami
echo "--- Second command: ls / ---"
ls /
exit
EOF
)

# 3. Verify the output contains the expected results from the shell commands
echo "Verifying shell output..."
echo "$SHELL_OUTPUT" | grep -q "root" || (echo "✗ Verification failed: 'whoami' did not return 'root'." && exit 1)
echo "✓ 'whoami' command executed successfully."

echo "$SHELL_OUTPUT" | grep -q "etc" || (echo "✗ Verification failed: 'ls /' did not list the 'etc' directory." && exit 1)
echo "✓ 'ls' command executed successfully."



echo "--- Running CLI Command Test for 'demo' ---"

# 1. Enable the demo repo to register it for use
echo "Enabling 'demo' repo..."
ploinky enable repo demo

# 2. Run a sequence of commands inside the agent's cli and capture the output.
echo "Executing a whoami, ls / via 'ploinky cli demo'..."
CLI_OUTPUT=$(ploinky cli demo <<'EOF'
echo "--- First command: whoami ---"
whoami
echo "--- Second command: ls / ---"
ls /
exit
EOF
)

# 3. Verify the output contains the expected results from the cli commands
echo "Verifying cli output..."
echo "$CLI_OUTPUT" | grep -q "root" || (echo "✗ Verification failed: 'whoami' (in demo) did not return 'root'." && exit 1)
echo "✓ 'whoami' command (in demo) executed successfully."

echo "$CLI_OUTPUT" | grep -q "etc" || (echo "✗ Verification failed: 'ls /' (in demo) did not list the 'etc' directory." && exit 1)
echo "✓ 'ls' command (in demo) executed successfully."


# If the script reaches this point, the trap will handle the final PASSED message.
