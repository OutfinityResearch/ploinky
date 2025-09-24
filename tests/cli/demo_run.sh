#!/bin/bash
set -euo pipefail

# This test covers the demo agent and its dependencies.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"
TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-demo-run-test-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR
cd "$TEST_WORKSPACE_DIR"
DIRNAME=$(basename "$TEST_WORKSPACE_DIR")
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# Determine container runtime
if command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
elif command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"
else
    echo "Neither docker nor podman found in PATH."
    exit 1
fi

# --- Test Execution ---
echo "--- Running Demo Run Test ---"

# 1. Enable the 'demo' repository
echo "1. Enabling 'demo' repository..."
ploinky enable repo demo
echo "✓ 'demo' repo enabled."

# 2. Start the 'demo' agent, which should trigger dependency installation
echo -e "\n2. Starting 'demo' agent..."
ploinky start demo
echo "Waiting for agents to start..."
sleep 10 # Give it enough time to pull images and start containers

# 3. Verify containers are running
echo -e "\n3. Verifying containers..."
$CONTAINER_RUNTIME ps --format "{{.Names}}" | grep "ploinky_agent_demo" || (echo "✗ Verification failed: 'demo' agent container is not running." && exit 1)
echo "✓ 'demo' agent container is running."
$CONTAINER_RUNTIME ps --format "{{.Names}}" | grep "ploinky_agent_simulator" || (echo "✗ Verification failed: 'simulator' agent container is not running." && exit 1)
echo "✓ 'simulator' agent container is running."
$CONTAINER_RUNTIME ps --format "{{.Names}}" | grep "ploinky_agent_moderator" || (echo "✗ Verification failed: 'moderator' agent container is not running." && exit 1)
echo "✓ 'moderator' agent container is running."

# 4. Verify repositories are cloned
echo -e "\n4. Verifying repositories..."
[ -d ".ploinky/repos/webmeet" ] || (echo "✗ Verification failed: 'webmeet' repository not found." && exit 1)
echo "✓ 'webmeet' repository is present."

# 5. Verify list repos
echo -e "\n5. Verifying 'list repos'..."
LIST_REPOS_OUTPUT=$(ploinky list repos)
echo "$LIST_REPOS_OUTPUT"
echo "$LIST_REPOS_OUTPUT" | grep -q "webmeet" || (echo "✗ Verification failed: 'webmeet' not found in 'list repos' output." && exit 1)
echo "✓ Repositories are correctly listed."

# 6. Verify list agents
echo -e "\n6. Verifying 'list agents'..."
LIST_AGENTS_OUTPUT=$(ploinky list agents)
echo "$LIST_AGENTS_OUTPUT"
echo "$LIST_AGENTS_OUTPUT" | grep -q "demo" || (echo "✗ Verification failed: 'demo' agent not found in 'list agents' output." && exit 1)
echo "$LIST_AGENTS_OUTPUT" | grep -q "simulator" || (echo "✗ Verification failed: 'simulator' agent not found in 'list agents' output." && exit 1)
echo "$LIST_AGENTS_OUTPUT" | grep -q "moderator" || (echo "✗ Verification failed: 'moderator' agent not found in 'list agents' output." && exit 1)
echo "✓ Agents are correctly listed."

# If the script reaches this point, it is considered a success.
