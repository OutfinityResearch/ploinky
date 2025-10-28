#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-mcp-schema-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

# Prepare local agent repo with manifest, MCP config, and scripts
AGENT_REPO_DIR=".ploinky/repos/local/testAgent"
mkdir -p "$AGENT_REPO_DIR"
cp -f "$SCRIPT_DIR/testAgent/manifest.json" "$AGENT_REPO_DIR/manifest.json"
cp -f "$SCRIPT_DIR/testAgent/mcp-config.json" "$AGENT_REPO_DIR/mcp-config.json"
mkdir -p "$AGENT_REPO_DIR/tools"
cp -f "$SCRIPT_DIR/testAgent/tools"/*.sh "$AGENT_REPO_DIR/tools/"

ploinky enable agent testAgent

START_LOG=start.log
set +e
timeout 30s ploinky start testAgent 8115 > "$START_LOG" 2>&1
rc=$?
set -e
cat "$START_LOG"
if [ $rc -ne 0 ]; then
    echo "✗ ploinky start testAgent failed"
    exit 1
fi

# Give the MCP server a moment to come online
declare -i attempt=0
TOOLS_OUTPUT=""
while true; do
    set +e
    TOOLS_OUTPUT=$(ploinky client list tools 2>&1)
    status=$?
    set -e

    if [ $status -eq 0 ] && grep -q "type_string" <<<"$TOOLS_OUTPUT"; then
        break
    fi

    attempt+=1
    if [ $attempt -ge 10 ]; then
        echo "$TOOLS_OUTPUT"
        echo "✗ type_string tool not listed after waiting"
        exit 1
    fi

    echo "Retrying to fetch tools (attempt $attempt)"
    sleep 2
done

echo "✓ testAgent tools registered via MCP"

# Helper to extract result text
extract_text() {
    jq -r '.content[0].text // .result.content[0].text // empty' <<<"$1"
}

# 1. String tool
STRING_OUT=$(ploinky client tool type_string -message "HelloWorld")
STRING_TEXT=$(extract_text "$STRING_OUT")
if [ "$STRING_TEXT" != "STRING:HelloWorld" ]; then
    echo "✗ type_string expected 'STRING:HelloWorld' but got: $STRING_TEXT"
    exit 1
fi

echo "✓ type_string validated"

# 2. Number tool
NUMBER_OUT=$(ploinky client tool type_number -value 42)
NUMBER_TEXT=$(extract_text "$NUMBER_OUT")
if [ "$NUMBER_TEXT" != "NUMBER:42" ]; then
    echo "✗ type_number expected 'NUMBER:42' but got: $NUMBER_TEXT"
    exit 1
fi

echo "✓ type_number validated"

# 3. Boolean tool
BOOLEAN_OUT=$(ploinky client tool type_boolean -flag true)
BOOLEAN_TEXT=$(extract_text "$BOOLEAN_OUT")
if [ "$BOOLEAN_TEXT" != "BOOLEAN:true" ]; then
    echo "✗ type_boolean expected 'BOOLEAN:true' but got: $BOOLEAN_TEXT"
    exit 1
fi

echo "✓ type_boolean validated"

# 4. Object tool
OBJECT_OUT=$(ploinky client tool type_object -profile.name Alice -profile.age 31)
OBJECT_TEXT=$(extract_text "$OBJECT_OUT")
if [ "$OBJECT_TEXT" != "OBJECT:Alice:31" ]; then
    echo "✗ type_object expected 'OBJECT:Alice:31' but got: $OBJECT_TEXT"
    exit 1
fi

echo "✓ type_object validated"

# 5. Array tool
ARRAY_OUT=$(ploinky client tool type_array -numbers[] 1 -numbers[] 2 -numbers[] 3)
ARRAY_TEXT=$(extract_text "$ARRAY_OUT")
if [ "$ARRAY_TEXT" != "ARRAY:1,2,3" ]; then
    echo "✗ type_array expected 'ARRAY:1,2,3' but got: $ARRAY_TEXT"
    exit 1
fi

echo "✓ type_array validated"

echo "All MCP input schema tool checks passed."
