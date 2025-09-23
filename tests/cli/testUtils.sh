#!/bin/bash

# This script provides common utility functions for bash-based tests.

# --- Error and Cleanup Handling ---

# This variable will be populated by the handle_error function.
FAIL_REASON=""

# Function to handle errors, capturing the reason for failure.
# This is intended to be used with `trap 'handle_error $LINENO "$BASH_COMMAND"' ERR`.
handle_error() {
  local exit_code=$?
  local line_no=$1
  local command="$2"
  FAIL_REASON="Command '${command}' failed on line ${line_no} with exit code ${exit_code}."
}

# Define a cleanup function that reports final status.
# This is intended to be used with `trap cleanup EXIT`.
# It relies on the sourcing script to define the $TEST_WORKSPACE_DIR variable.
cleanup() {
  local exit_code=$?
  echo "--- Cleaning up test workspace ---"

  echo "Running final 'ploinky destroy' to clean up services and containers..."
  # Run destroy but continue cleanup even if it fails
  ploinky destroy || echo "'ploinky destroy' failed with exit code $?. Continuing cleanup."

  # Make sure we are not in the directory when we remove it
  if [[ -d "$TEST_WORKSPACE_DIR" ]]; then
    cd /tmp
    rm -rf "$TEST_WORKSPACE_DIR"
  fi
  
  if [ "$exit_code" -eq 0 ]; then
    echo "--- Test PASSED ---"
  else
    echo "--- Test FAILED (Exit Code: $exit_code) ---"
    if [[ -n "$FAIL_REASON" ]]; then
      echo "Reason: $FAIL_REASON"
    fi
  fi
  # Exit with the original exit code
  exit $exit_code
}

# --- Assertion Functions ---

# Asserts that a value is not empty.
#
# @param $1 The value to check.
# @param $2 The error message to display if the assertion fails.
assert_not_empty() {
  local value="$1"
  local message="$2"
  if [ -z "$value" ]; then
    echo "Assertion failed: $message" >&2
    # Returning a non-zero status will trigger the ERR trap.
    return 1
  fi
}
