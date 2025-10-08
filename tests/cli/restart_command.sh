#!/bin/bash
set -euo pipefail

# This test verifies the 'ploinky restart' command, both in its full
# and specific-agent forms.

# --- Setup ---

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-restart-test-XXXXXX)
DIRNAME=$(basename "$TEST_WORKSPACE_DIR") # Extract dirname for process matching

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

if command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"
elif command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
else
    echo "Neither docker nor podman found in PATH."
    exit 1
fi
# --- Test Execution ---

echo "--- Running Restart Command Test ---"

# --- Part 1: Full Restart ---
echo "--- Testing full restart (ploinky restart) ---"

# 1. Enable and start two agents
echo "Enabling demo repo..."
ploinky enable repo demo

echo "Starting demo and simulator agents..."
ploinky start demo
sleep 2 # Give them time to start

# 2. Verify they are running initially
echo "Verifying initial state..."
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Verification failed: 'demo' agent container is not running after start."
  exit 1
fi
echo "✓ Demo agent container is running."
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_simulator" --format "{{.Names}}" | grep -q .; then
  echo "✗ Verification failed: 'simulator' agent container is not running after start."
  exit 1
fi
echo "✓ Simulator agent container is running."
ROUTER_PID=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID" "RoutingServer.js should be running initially"
echo "✓ Initial state verified: demo, simulator, and router are running."

# 3. Call restart
echo "Issuing 'ploinky restart'..."
ploinky restart
sleep 5 # Give everything time to restart

# 4. Verify they are all running again
echo "Verifying state after full restart..."
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Demo agent not running after restart"
  exit 1
fi
echo "✓ Demo agent is running after restart."
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_simulator" --format "{{.Names}}" | grep -q .; then
  echo "✗ Simulator agent not running after restart"
  exit 1
fi
echo "✓ Simulator agent is running after restart."
ROUTER_PID_AFTER_RESTART=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID_AFTER_RESTART" "RoutingServer.js should be running after restart"
echo "✓ Full restart successful."


# --- Part 2: Specific Agent Restart (non-destructive) ---
echo "--- Testing specific agent restart (ploinky restart demo) ---"

# 1. Make sure agents are running
ploinky start
sleep 3

# 2. Get container ID before restart
echo "Getting container ID for 'demo' agent..."
CONTAINER_NAME_BEFORE=$($CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | head -n 1)
if [ -z "$CONTAINER_NAME_BEFORE" ]; then
  echo "✗ Verification failed: Could not find running container for agent 'demo' before restart."
  exit 1
fi
ID_BEFORE=$($CONTAINER_RUNTIME ps -q --filter name="$CONTAINER_NAME_BEFORE")
if [ -z "$ID_BEFORE" ]; then
  echo "✗ Verification failed: Could not get ID for container '$CONTAINER_NAME_BEFORE'."
  exit 1
fi
echo "Container ID before restart: $ID_BEFORE"
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_simulator" --format "{{.Names}}" | grep -q .; then
  echo "✗ Simulator agent should be running before restart"
  exit 1
fi
echo "✓ Simulator agent is running."

# 3. Restart only 'demo'
echo "Issuing 'ploinky restart demo'..."
ploinky restart demo
sleep 5 # Give it time to restart

# 4. Verify final state
echo "Verifying state after 'restart demo'..."
CONTAINER_NAME_AFTER=$($CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | head -n 1)
if [ -z "$CONTAINER_NAME_AFTER" ]; then
  echo "✗ Verification failed: Container for demo agent not found after restart."
  exit 1
fi
ID_AFTER=$($CONTAINER_RUNTIME ps -q --filter name="$CONTAINER_NAME_AFTER")
if [ -z "$ID_AFTER" ]; then
  echo "✗ Verification failed: Could not get ID for container '$CONTAINER_NAME_AFTER'."
  exit 1
fi
echo "Container ID after restart: $ID_AFTER"

if [ "$ID_BEFORE" != "$ID_AFTER" ]; then
  echo "✗ Verification failed: Container ID changed after restart, but it should be the same."
  exit 1
fi
echo "✓ Container ID is the same after restart."

if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_demo" --format "{{.Names}}" | grep -q .; then
  echo "✗ Demo agent not running after specific restart"
  exit 1
fi
echo "✓ Demo agent is running."
if ! $CONTAINER_RUNTIME ps --filter "name=ploinky_agent_simulator" --format "{{.Names}}" | grep -q .; then
  echo "✗ Simulator agent should still be running"
  exit 1
fi
echo "✓ Simulator agent is still running."
echo "✓ Specific agent restart successful."

# --- Part 3: Test restart on a stopped container ---
echo "--- Testing restart on a stopped container ---"
ploinky stop
sleep 3
ploinky restart demo

# Verify the container is in 'exited' state
EXITED_CONTAINER=$($CONTAINER_RUNTIME ps -a --filter "name=ploinky_agent_demo" --filter "status=exited" --format "{{.Names}}")
if [ -z "$EXITED_CONTAINER" ]; then
    echo "✗ Verification failed: 'demo' agent container was not found in 'exited' state after 'restart' on stopped."
    exit 1
fi

echo "✓ 'restart' on stopped container behaved as expected."

# If the script reaches this point, the trap will handle the final PASSED message.
