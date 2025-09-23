#!/bin/bash
set -euo pipefail

# This test verifies the cleanup commands: stop, clean, shutdown, and destroy.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-cleanup-test-XXXXXX)
DIRNAME=$(basename "$TEST_WORKSPACE_DIR") # Extract dirname for process matching

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Cleanup Commands Test ---"

# --- Test 1: stop ---
echo -e "\n--- Testing 'stop' command ---"
# Arrange: Start a full workspace
echo "[stop] Setting up workspace..."
ploinky enable repo demo
ploinky start demo 8080
sleep 2
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Setup failed: Demo agent did not start." && exit 1)
pgrep -f "RoutingServer.js" > /dev/null || (echo "✗ Setup failed: RoutingServer did not start." && exit 1)
echo "[stop] ✓ Workspace is running."

# Act: Run the stop command
ploinky stop
sleep 1

# Assert: Check that both agent and router are stopped
echo "[stop] Verifying processes are stopped..."
if pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null; then
  echo "✗ Verification failed: Demo agent process still running after 'stop'."
  exit 1
fi
if pgrep -f "RoutingServer.js" > /dev/null; then
  echo "✗ Verification failed: RoutingServer process still running after 'stop'."
  exit 1
fi
echo "[stop] ✓ 'stop' command successful."


# --- Test 2: clean ---
echo -e "\n--- Testing 'clean' command ---"
# Arrange: Start a full workspace
echo "[clean] Setting up workspace..."
ploinky start demo 8080 # Already enabled, just need to start
sleep 3
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Setup failed: Demo agent did not start." && exit 1)
pgrep -f "RoutingServer.js" > /dev/null || (echo "✗ Setup failed: RoutingServer did not start." && exit 1)
echo "[clean] ✓ Workspace is running."

# Act: Run the clean command
ploinky clean
sleep 1

# Assert: Check that agent is stopped, but router is still running
echo "[clean] Verifying processes..."
if pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null; then
  echo "✗ Verification failed: Demo agent process still running after 'clean'."
  exit 1
fi
pgrep -f "RoutingServer.js" > /dev/null || (echo "✗ Verification failed: RoutingServer was stopped by 'clean', but should not have been." && exit 1)
echo "[clean] ✓ 'clean' command successful."


# --- Test 3: shutdown ---
echo -e "\n--- Testing 'shutdown' command ---"
# Arrange: Workspace is already running from previous test, but let's restart agent for a clean state
ploinky start demo
sleep 3
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Setup failed: Demo agent did not start." && exit 1)
echo "[shutdown] ✓ Workspace is running."

# Act: Run the shutdown command
ploinky shutdown
sleep 1

# Assert: Check that both agent and router are stopped
echo "[shutdown] Verifying processes are stopped..."
if pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null; then
  echo "✗ Verification failed: Demo agent process still running after 'shutdown'."
  exit 1
fi
if pgrep -f "RoutingServer.js" > /dev/null; then
  echo "✗ Verification failed: RoutingServer process still running after 'shutdown'."
  exit 1
fi
echo "[shutdown] ✓ 'shutdown' command successful."


# --- Test 4: destroy ---
# This test is effectively the same as shutdown and confirms the alias behavior
echo -e "\n--- Testing 'destroy' command ---"
# Arrange: Start a full workspace
echo "[destroy] Setting up workspace..."
ploinky start demo 8080
sleep 3
pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null || (echo "✗ Setup failed: Demo agent did not start." && exit 1)
pgrep -f "RoutingServer.js" > /dev/null || (echo "✗ Setup failed: RoutingServer did not start." && exit 1)
echo "[destroy] ✓ Workspace is running."

# Act: Run the destroy command
ploinky destroy
sleep 1

# Assert: Check that both agent and router are stopped
echo "[destroy] Verifying processes are stopped..."
if pgrep -f "ploinky_agent_demo_$DIRNAME" > /dev/null; then
  echo "✗ Verification failed: Demo agent process still running after 'destroy'."
  exit 1
fi
if pgrep -f "RoutingServer.js" > /dev/null; then
  echo "✗ Verification failed: RoutingServer process still running after 'destroy'."
  exit 1
fi
echo "[destroy] ✓ 'destroy' command successful."


# If the script reaches this point, the trap will handle the final PASSED message.
