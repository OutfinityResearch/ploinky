#!/bin/bash
set -euo pipefail

# This test verifies the 'ploinky set' and 'echo' commands for variables.

# --- Setup ---

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-set-test-XXXXXX)

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Set Command Test ---"

# 1. Set the variable directly
echo "Setting variable 'my_test_var' to 'hello_ploinky_123' ભા"
ploinky set "my_test_var" "hello_ploinky_123"
echo "✓ 'set' command executed."

# 2. List variables and verify
echo "Listing variables to verify..."
LIST_OUTPUT=$(ploinky set)
echo "--- ploinky set ---"
echo "$LIST_OUTPUT"
echo "-------------------------"

# 3. Check for the variable in the output
echo "Verifying output..."
echo "$LIST_OUTPUT" | grep -q "my_test_var=hello_ploinky_123" || (echo "✗ Verification failed: Did not find 'my_test_var=hello_ploinky_123' in the output." && exit 1)

echo "✓ Verification successful: Found the set variable."


# --- Test 'echo' command ---
echo -e "\n--- Running Echo Command Test ---"

# 1. Use 'echo' to retrieve the value of the variable we just set
echo "Retrieving value for 'my_test_var' ભા"
ECHO_OUTPUT=$(ploinky echo "my_test_var")

# 2. Verify the output
echo "Verifying 'echo' output..."
if [ "$ECHO_OUTPUT" = "hello_ploinky_123" ]; then
  echo "✓ Verification successful: 'echo' returned the correct value."
else
  echo "✗ Verification failed: 'echo' returned '$ECHO_OUTPUT', expected 'hello_ploinky_123'."
  exit 1
fi


# If the script reaches this point, the trap will handle the final PASSED message.
