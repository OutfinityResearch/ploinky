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

# Ensure cleanup happens on script exit
trap 'rm -rf "$TEST_DIR"' EXIT

# If PLOINKY_CMD is not set, use a default path
PLOINKY_CMD=${PLOINKY_CMD:-"ploinky"}
info "Using ploinky command: $PLOINKY_CMD"

# --- Test Execution ---
info "--- Running Test: list command ---"

# 1. Initialize Ploinky (this will also clone the default 'plonkyAgents' repo)
$PLOINKY_CMD > /dev/null 2>&1 || true # Run once to init

# 2. Add a new local repository for testing
git init --bare .git > /dev/null 2>&1
$PLOINKY_CMD add repo local-test-repo "$(pwd)/.git" > /dev/null 2>&1

# 3. Create a new agent in the local repo
$PLOINKY_CMD new agent local-test-repo my-list-agent > /dev/null 2>&1

# 4. Test 'list repos'
info "Testing 'list repos'..."
LIST_REPOS_OUTPUT=$($PLOINKY_CMD list repos)
echo "$LIST_REPOS_OUTPUT"

if ! echo "$LIST_REPOS_OUTPUT" | grep -q "plonkyAgents"; then
    fail "'list repos' output did not contain the default 'plonkyAgents' repository."
fi

if ! echo "$LIST_REPOS_OUTPUT" | grep -q "local-test-repo"; then
    fail "'list repos' output did not contain the new 'local-test-repo' repository."
fi
pass "'list repos' command works as expected."

# 5. Test 'list agents'
info "Testing 'list agents'..."
LIST_AGENTS_OUTPUT=$($PLOINKY_CMD list agents)
echo "$LIST_AGENTS_OUTPUT"

# Check for the default repo and its agent
if ! echo "$LIST_AGENTS_OUTPUT" | grep -q "Repository: plonkyAgents"; then
    fail "'list agents' output did not contain the 'plonkyAgents' repository header."
fi
if ! echo "$LIST_AGENTS_OUTPUT" | grep -q -- "- bash"; then
    fail "'list agents' output did not contain the 'bash' agent."
fi

# Check for the new local repo and its agent
if ! echo "$LIST_AGENTS_OUTPUT" | grep -q "Repository: local-test-repo"; then
    fail "'list agents' output did not contain the 'local-test-repo' repository header."
fi
if ! echo "$LIST_AGENTS_OUTPUT" | grep -q -- "- my-list-agent"; then
    fail "'list agents' output did not contain the new 'my-list-agent'."
fi
pass "'list agents' command works as expected."

# --- Test Success ---
# If we reach here, all checks passed. The main runner script will see the exit code 0.
