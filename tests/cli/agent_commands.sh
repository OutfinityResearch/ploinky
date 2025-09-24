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
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Verification failed: 'demo' agent process is not running after start." && exit 1)
echo "✓ 'start' command executed successfully."


# 5. Refresh the agent
echo -e "\n5. Testing 'refresh agent demo'..."
CONTAINER_NAME=$($CONTAINER_RUNTIME ps --format "{{.Names}}" | grep "ploinky_agent_demo" | head -n 1)
ID_BEFORE=$($CONTAINER_RUNTIME ps -q --filter name=$CONTAINER_NAME)
echo "Container ID before refresh: $ID_BEFORE"

ploinky refresh agent demo
echo "Waiting for agent to restart..."
sleep 5 # Increased sleep time to be safe

CONTAINER_NAME_AFTER=$($CONTAINER_RUNTIME ps --format "{{.Names}}" | grep "ploinky_agent_demo" | head -n 1)
ID_AFTER=$($CONTAINER_RUNTIME ps -q --filter name=$CONTAINER_NAME_AFTER)
echo "Container ID after refresh: $ID_AFTER"

if [ "$ID_BEFORE" == "$ID_AFTER" ]; then
  echo "✗ Verification failed: Container ID is the same after refresh."
  exit 1
fi
echo "✓ Container ID changed after refresh."

# 6. Final process check
echo -e "\n6. Final process check..."
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Verification failed: 'demo' agent process is not running after refresh." && exit 1)
echo "✓ Agent process is running after refresh."

# If the script reaches this point, it is considered a success.
