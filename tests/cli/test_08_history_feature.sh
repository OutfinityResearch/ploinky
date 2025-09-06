#!/bin/bash
set -e
set -o pipefail

# --- Helper Functions ---
info() {
    echo "[INFO] $1"
}

pass() {
    echo "✅ PASS: $1"
}

fail() {
    echo "❌ FAIL: $1"
    exit 1
}

# --- Test Setup ---
# Use a temporary directory for a clean test environment
TEST_DIR=$(mktemp -d -t ploinky-test-XXXXXX)
info "Running test in temporary directory: $TEST_DIR"
cd "$TEST_DIR"

# The history file should be created inside the .ploinky directory
HISTORY_FILE=".ploinky/.history"

# Ensure cleanup happens on script exit
trap 'rm -rf "$TEST_DIR"' EXIT

# If PLOINKY_CMD is not set, use a default path
PLOINKY_CMD=${PLOINKY_CMD:-"ploinky"}
info "Using ploinky command: $PLOINKY_CMD"
info "Expecting history file at: $HISTORY_FILE"

# --- Test Execution ---
info "--- Running Test: History Feature ---"

# 1. Run ploinky in interactive mode and pipe commands to it.
# This will initialize the .ploinky directory and create the history file.
$PLOINKY_CMD <<EOF
list repos
list agents
exit
EOF

# 2. Verify the history file was created
if [ ! -f "$HISTORY_FILE" ]; then
    fail "History file was not created at $HISTORY_FILE."
fi
pass "History file was created successfully."

# 3. Verify the contents of the history file
info "Checking history file contents..."
HISTORY_CONTENTS=$(cat "$HISTORY_FILE")
echo "$HISTORY_CONTENTS"

if ! echo "$HISTORY_CONTENTS" | grep -q "list repos"; then
    fail "History file did not contain 'list repos'."
fi

if ! echo "$HISTORY_CONTENTS" | grep -q "list agents"; then
    fail "History file did not contain 'list agents'."
fi

pass "History file contains the correct commands."

# --- Test Success ---
# If we reach here, all checks passed.