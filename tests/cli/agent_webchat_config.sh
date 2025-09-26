#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-agent-webchat-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

echo "--- Preparing local test agent with webchat setup ---"
mkdir -p .ploinky/repos/local/testAgent
cp -f "$SCRIPT_DIR/testAgent/manifest.json" .ploinky/repos/local/testAgent/manifest.json

echo "--- Enabling and starting testAgent ---"
ploinky enable agent testAgent

# Run start with a timeout and capture output to a file to avoid any blocking issues
set +e
timeout 25s ploinky start testAgent 8090 > start.out 2>&1
rc=$?
set -e
cat start.out || true

if ! grep -q "hello world" start.out; then
  echo "✗ Did not see 'hello world' from webchat hook in 'start' output"
  exit 1
fi

echo "✓ Found 'hello world' from webchat setup in start output."
