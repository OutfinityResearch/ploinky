#!/bin/bash
set -euo pipefail

# Define PLOINKY_CMD if not already set (for individual execution or when sourced)
if [ -z "${PLOINKY_CMD:-}" ]; then
  THIS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
  ROOT_DIR=$(cd "$THIS_DIR/../.." &>/dev/null && pwd)
  PLOINKY_CMD="$ROOT_DIR/bin/ploinky"
  echo "Using PLOINKY_CMD: $PLOINKY_CMD"
fi

# Function to initialize a temporary Ploinky workspace
# Usage: init_test_workspace
# Returns: The path to the temporary workspace directory
init_test_workspace() {
  TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-test-XXXXXX)
  cd "$TEST_WORKSPACE_DIR"

  # Initialize ploinky in the temporary workspace
  # PLOINKY_CMD is now guaranteed to be set by the block above
  "${PLOINKY_CMD}" > /dev/null # Initialize .ploinky directory
  
  echo "$TEST_WORKSPACE_DIR" # Return the path
}

# Function to clean up a temporary Ploinky workspace
# Usage: cleanup_test_workspace <workspace_path>
cleanup_test_workspace() {
  local WORKSPACE_PATH="$1"
  echo "Cleaning up temporary workspace: $WORKSPACE_PATH"
  
  # Ensure we are not in the workspace directory before removing it
  # This is important if the calling script is still inside it
  if [[ "$(pwd)" == "$WORKSPACE_PATH" ]]; then
    echo "Warning: Still inside the test workspace. Moving to parent directory for cleanup."
    cd ..
  fi

  # Shutdown any running ploinky processes in the workspace
  # PLOINKY_CMD is now guaranteed to be set by the block above
  if [ -n "${PLOINKY_CMD}" ]; then
    ( cd "$WORKSPACE_PATH" && "${PLOINKY_CMD}" shutdown ) || true
  fi

  rm -rf "$WORKSPACE_PATH"
}