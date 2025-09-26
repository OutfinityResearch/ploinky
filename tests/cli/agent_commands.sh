#!/bin/bash
set -euo pipefail

# This test covers the agent management lifecycle: list, enable, and refresh.

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
DIRNAME=$(basename "$TEST_WORKSPACE_DIR") # Extract dirname for process matching
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

echo "--- Running Agent Commands Test ---"

# 1. Initialize workspace and enable the 'demo' repository
echo "1. Initializing workspace and enabling 'demo' repository..."
ploinky enable repo demo
echo "✓ 'demo' repo enabled."

# 2. List agents to verify the 'demo' agent is available
echo -e "\n2. Testing 'list agents'..."
LIST_OUTPUT=$(ploinky list agents)
echo "$LIST_OUTPUT"
if ! echo "$LIST_OUTPUT" | grep -q "demo"; then
  echo "✗ Verification failed: 'demo' agent not found in 'list agents' output."
  exit 1
fi
echo "✓ 'list agents' shows the 'demo' agent."

# 3. Prepare routing.json and test 'list routes'
echo -e "\n3. Testing 'list routes'..."
mkdir -p .ploinky
cat > .ploinky/routing.json << 'EOF'
{
  "port": 8088,
  "static": {
    "agent": "demo",
    "hostPath": "/tmp/demo"
  },
  "routes": {
    "demo": {
      "container": "ploinky_test_service_demo",
      "hostPort": 7001
    }
  }
}
EOF
ROUTES_OUTPUT=$(ploinky list routes)
echo "$ROUTES_OUTPUT"
if ! echo "$ROUTES_OUTPUT" | grep -q "Configured routes:"; then
  echo "✗ Verification failed: 'list routes' did not print the routes header."
  exit 1
fi
if ! echo "$ROUTES_OUTPUT" | grep -q "demo: hostPort=7001"; then
  echo "✗ Verification failed: 'list routes' did not include demo with hostPort=7001."
  exit 1
fi
echo "✓ 'list routes' shows routes from .ploinky/routing.json."

# 4. Start the agent
echo -e "\n4. Testing 'start demo'..."
ploinky start demo
echo "Waiting for agent to start..."
sleep 5 # Give it time to start
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Verification failed: 'demo' agent container is not running after start."
  exit 1
fi
echo "✓ 'start' command executed successfully."


# 5. Refresh the agent (should re-create container)
echo -e "\n5. Testing 'refresh agent demo'..."

# Get container name before refresh
CONTAINER_NAME_BEFORE=$($CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | head -n 1)
if [ -z "$CONTAINER_NAME_BEFORE" ]; then
  echo "✗ Verification failed: Could not find container for 'demo' agent before refresh."
  exit 1
fi

# Get container ID before refresh
ID_BEFORE=$($CONTAINER_RUNTIME ps -q --filter "name=$CONTAINER_NAME_BEFORE")
if [ -z "$ID_BEFORE" ]; then
  echo "✗ Verification failed: Could not get ID for container '$CONTAINER_NAME_BEFORE'."
  exit 1
fi
echo "Container ID before refresh: $ID_BEFORE"

ploinky refresh agent demo
echo "Waiting for agent to be re-created..."
sleep 8 # Increased sleep time for re-creation

# Get container name after refresh
CONTAINER_NAME_AFTER=$($CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | head -n 1)
if [ -z "$CONTAINER_NAME_AFTER" ]; then
  echo "✗ Verification failed: Could not find container for 'demo' agent after refresh."
  exit 1
fi

# Get container ID after refresh
ID_AFTER=$($CONTAINER_RUNTIME ps -q --filter "name=$CONTAINER_NAME_AFTER")
if [ -z "$ID_AFTER" ]; then
  echo "✗ Verification failed: Could not get ID for container '$CONTAINER_NAME_AFTER'."
  exit 1
fi
echo "Container ID after refresh: $ID_AFTER"

if [ "$ID_BEFORE" == "$ID_AFTER" ]; then
  echo "✗ Verification failed: Container ID did not change after refresh, but it should have."
  exit 1
fi
echo "✓ Container ID changed after refresh."

# 6. Test refresh on a stopped container
echo -e "\n6. Testing 'refresh agent' on a stopped container..."
ploinky stop
sleep 3
# Verify container is not running
if $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Verification failed: 'demo' agent container is running after refresh on stopped, but it should not."
  exit 1
fi
echo "✓ 'refresh agent' on stopped container behaved as expected."

# 7. Final process check
echo -e "\n7. Final process check..."
# Restart the agent to check if it's still working
ploinky start demo
sleep 5
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Verification failed: 'demo' agent container is not running after final start."
  exit 1
fi
echo "✓ Agent container is running after final start."

# If the script reaches this point, it is considered a success.
