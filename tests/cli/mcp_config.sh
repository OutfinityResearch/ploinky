#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-mcp-config-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# Prepare demo repo and MCP configuration
ploinky enable repo demo
ploinky start demo
sleep 3

CONFIG_OUTPUT=$(printf 'ls -1 /tmp/ploinky 2>/dev/null\nexit\n' | ploinky shell demo)
echo "$CONFIG_OUTPUT" | grep -q 'mcp-config.json' || (
    echo "✗ MCP config file not found inside container (expected /tmp/ploinky/mcp-config.json)." && exit 1
)

echo "✓ MCP config present inside demo container."
