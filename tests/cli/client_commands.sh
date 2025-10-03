#!/bin/bash
set -euo pipefail

# This test verifies the 'client' subcommands: status, list (tools/resources), and tool.

# --- Setup ---
source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-client-test-XXXXXX)

trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# --- Test Execution ---
echo "--- Running Client Commands Test ---"

# 1. SETUP: Start the workspace to create a context for client commands.
echo "--- Setup: Starting workspace with 'demo' agent on port 8080 ---"

ploinky enable repo demo
ploinky start demo
sleep 3 # Give server and agent time to initialize

# Verify the server is running before testing
echo "Verifying that RoutingServer is running..."
ROUTER_PID=$(pgrep -f "RoutingServer.js" || true)
assert_not_empty "$ROUTER_PID" "Setup failed: RoutingServer.js did not start."
echo "✓ Workspace started successfully."


# --- Test 1: client status ---
echo -e "\n--- Testing 'client status demo' ---"
STATUS_OUTPUT=$(ploinky client status demo)
echo "Command output: $STATUS_OUTPUT"

echo "$STATUS_OUTPUT" | grep -q "http=200" || (echo "✗ Verification failed: 'client status' did not return HTTP 200." && exit 1)
echo "$STATUS_OUTPUT" | grep -q "ok=true" || (echo "✗ Verification failed: 'client status' did not return ok=true." && exit 1)
echo "✓ 'client status' verification successful."


# --- Test 2: client list tools ---
echo -e "\n--- Testing 'client list tools' ---"
TOOLS_OUTPUT=$(ploinky client list tools)
echo "Command output:\n$TOOLS_OUTPUT"

echo "$TOOLS_OUTPUT" | grep -q "echo_script" || (
    echo "✗ Verification failed: echo_script tool not found in 'client list tools' output." && exit 1
)
echo "$TOOLS_OUTPUT" | grep -q "random_probability" || (
    echo "✗ Verification failed: random_probability tool not found in 'client list tools' output." && exit 1
)
echo "✓ 'client list tools' reported demo tools."

# --- Test 3: client list resources ---
echo -e "\n--- Testing 'client list resources' ---"
RES_OUTPUT=$(ploinky client list resources)
echo "Command output:\n$RES_OUTPUT"

echo "$RES_OUTPUT" | grep -q "echo_script" || (
    echo "✗ Verification failed: echo_script resource not listed." && exit 1
)
echo "$RES_OUTPUT" | grep -q "random_probability" || (
    echo "✗ Verification failed: random_probability resource not listed." && exit 1
)
echo "✓ 'client list resources' reported demo resources."



# --- Test 4: client tool invocations with demo MCP config ---
echo -e "\n--- Testing 'client tool echo_script' ---"
ECHO_TOOL_OUTPUT=$(ploinky client tool echo_script -message "Client Commands Test")
echo "Command output: $ECHO_TOOL_OUTPUT"

if ! echo "$ECHO_TOOL_OUTPUT" | jq -e '.ok == true and .agent == "demo"' >/dev/null; then
    echo "✗ Verification failed: echo_script tool call did not report ok=true for agent 'demo'."
    exit 1
fi

ECHO_TEXT=$(echo "$ECHO_TOOL_OUTPUT" | jq -r '.result.content[0].text')
if ! echo "$ECHO_TEXT" | grep -q "Echo: Client Commands Test"; then
    echo "✗ Verification failed: echo_script tool did not echo the expected text." && exit 1
fi
echo "✓ echo_script tool invocation verified."

echo -e "\n--- Testing 'client tool random_probability --agent demo' ---"
PROB_TOOL_OUTPUT=$(ploinky client tool random_probability --agent demo -samples 7)
echo "Command output: $PROB_TOOL_OUTPUT"

if ! echo "$PROB_TOOL_OUTPUT" | jq -e '.ok == true and .agent == "demo"' >/dev/null; then
    echo "✗ Verification failed: random_probability tool call did not report ok=true for agent 'demo'."
    exit 1
fi

PROB_TEXT=$(echo "$PROB_TOOL_OUTPUT" | jq -r '.result.content[0].text')
if ! echo "$PROB_TEXT" | grep -q "Samples used: 7"; then
    echo "✗ Verification failed: random_probability tool did not report the expected sample count." && exit 1
fi
if ! echo "$PROB_TEXT" | grep -q "Estimated probability:"; then
    echo "✗ Verification failed: random_probability tool output missing probability summary." && exit 1
fi
echo "✓ random_probability tool invocation verified."


# The final 'ploinky destroy' from the main cleanup trap will stop the server and agent.
