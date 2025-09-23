#!/bin/bash
set -euo pipefail

# This test verifies the 'ploinky restart' command, both in its full
# and specific-agent forms.

# --- Setup ---

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-restart-test-XXXXXX)

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---

echo "--- Running Restart Command Test ---"

# --- Part 1: Full Restart ---
echo "--- Testing full restart (ploinky restart) ---"

# 1. Enable and start two agents
echo "Enabling demo repo..."
ploinky enable repo demo

echo "Starting demo and simulator agents..."
ploinky start demo
ploinky start simulator
sleep 5 # Give them time to start

# 2. Verify they are running initially
echo "Verifying initial state..."
pgrep -f "ploinky_agent_demo" > /dev/null || (echo "✗ Demo agent process not running initially" && exit 1)
echo "✓ Demo agent process is running."
pgrep -f "ploinky_agent_simulator" > /dev/null || (echo "✗ Simulator agent process not running initially" && exit 1)
echo "✓ Simulator agent process is running."
ROUTER_PID=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID" "RoutingServer.js should be running initially"
echo "✓ Initial state verified: demo, simulator, and router are running."

# 3. Call restart
echo "Issuing 'ploinky restart'..."
ploinky restart
sleep 5 # Give everything time to restart

# 4. Verify they are all running again
echo "Verifying state after full restart..."
pgrep -f "ploinky_agent_demo" > /dev/null || (echo "✗ Demo agent not running after restart" && exit 1)
echo "✓ Demo agent is running after restart."
pgrep -f "ploinky_agent_simulator" > /dev/null || (echo "✗ Simulator agent not running after restart" && exit 1)
echo "✓ Simulator agent is running after restart."
ROUTER_PID_AFTER_RESTART=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID_AFTER_RESTART" "RoutingServer.js should be running after restart"
echo "✓ Full restart successful."


# --- Part 2: Specific Agent Restart ---
echo "--- Testing specific agent restart (ploinky restart demo) ---"

# 1. Stop everything
echo "Stopping all services..."
ploinky stop
sleep 3 # Give them time to stop

# 2. Verify they are stopped
echo "Verifying stopped state..."
if pgrep -f "ploinky_agent_demo" > /dev/null; then
  echo "✗ Demo agent process still running after stop"
  exit 1
fi
if pgrep -f "ploinky_agent_simulator" > /dev/null; then
  echo "✗ Simulator agent process still running after stop"
  exit 1
fi
ROUTER_PID_AFTER_STOP=$(pgrep -f "RoutingServer.js" || true)
if [ -n "$ROUTER_PID_AFTER_STOP" ]; then
  echo "✗ RoutingServer.js still running after stop"
  exit 1
fi
echo "✓ All services stopped."

# 3. Restart only 'demo'
echo "Issuing 'ploinky restart demo'..."
ploinky restart demo
sleep 5 # Give it time to start

# 4. Verify final state
echo "Verifying state after 'restart demo'..."
pgrep -f "ploinky_agent_demo" > /dev/null || (echo "✗ Demo agent not running after specific restart" && exit 1)
echo "✓ Demo agent is running."

if pgrep -f "ploinky_agent_simulator" > /dev/null; then
  echo "✗ Simulator agent is running but should not be."
  exit 1
fi
echo "✓ Simulator agent is not running."

ROUTER_PID_FINAL=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID_FINAL" "RoutingServer.js should be running after specific restart"
echo "✓ Router is running."
echo "✓ Specific agent restart successful."

# If the script reaches this point, the trap will handle the final PASSED message.