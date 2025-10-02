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

TOOLS_PRESENT=0
if echo "$TOOLS_OUTPUT" | grep -q "^- \["; then
    TOOLS_PRESENT=1
    echo "✓ 'client list tools' returned tool definitions."
elif echo "$TOOLS_OUTPUT" | grep -q "No entries found."; then
    echo "✓ 'client list tools' reported no tools (no config detected)."
else
    echo "✗ Verification failed: 'client list tools' did not return a recognizable response." && exit 1
fi

# --- Test 3: client list resources ---
echo -e "\n--- Testing 'client list resources' ---"
RES_OUTPUT=$(ploinky client list resources)
echo "Command output:\n$RES_OUTPUT"

RES_PRESENT=0
if echo "$RES_OUTPUT" | grep -q "^- \["; then
    RES_PRESENT=1
    echo "✓ 'client list resources' returned resource definitions."
elif echo "$RES_OUTPUT" | grep -q "No entries found."; then
echo "✓ 'client list resources' reported no resources (no config detected)."
else
    echo "✗ Verification failed: 'client list resources' did not return a recognizable response." && exit 1
fi



# --- Test 4A: client tool without --agent should detect duplicates ---
if [ "$TOOLS_PRESENT" -eq 1 ]; then
    echo -e "\n--- Testing 'client tool list_things' ambiguity detection ---"
    AMBIG_OUTPUT=$(ploinky client tool list_things -category fruits)
    echo "Command output: $AMBIG_OUTPUT"

    echo "$AMBIG_OUTPUT" | jq -e '.ok == false and (.agents | length) > 1' >/dev/null || (
        echo "✗ Verification failed: ambiguous tool invocation did not report multiple agents." && exit 1
    )
    echo "✓ Ambiguity detection verification successful."

    echo -e "\n--- Testing 'client tool list_things --agent demo' ---"
    TOOL_OUTPUT=$(ploinky client tool list_things --agent demo -category fruits)
    echo "Command output: $TOOL_OUTPUT"

    TOOL_OK=$(echo "$TOOL_OUTPUT" | jq -r '.ok')
    if [ "$TOOL_OK" != "true" ]; then
        echo "✗ Verification failed: Tool invocation did not report ok=true."
        exit 1
    fi

    AGENT_NAME=$(echo "$TOOL_OUTPUT" | jq -r '.agent')
    if [ "$AGENT_NAME" != "demo" ]; then
        echo "✗ Verification failed: Tool invocation did not report the expected agent 'demo'."
        exit 1
    fi

    LIST_TEXT=$(echo "$TOOL_OUTPUT" | jq -r '.result.content[0].text')
    if ! echo "$LIST_TEXT" | grep -q "fruits"; then
        echo "✗ Verification failed: Tool response did not include the requested category.";
        exit 1
    fi

    echo "✓ 'client tool' verification successful."
else
    echo "Skipping tool execution tests because no MCP tools were detected."
fi


# The final 'ploinky destroy' from the main cleanup trap will stop the server and agent.
