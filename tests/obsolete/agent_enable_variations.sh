#!/bin/bash
set -euo pipefail

# This test verifies the different modes of the 'enable agent' command by
# running 'pwd' inside the agent container using 'ploinky cli <agent>' and
# checking the reported working directory.

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-enable-test-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

run_pwd_with_cli() {
  # Pipes 'pwd' into 'ploinky cli demo' and captures output
  local outfile="$1"
  set +e
  printf 'pwd\nexit\n' | ploinky cli demo > "$outfile" 2>&1
  local code=$?
  set -e
  return $code
}

ploinky enable repo demo

echo "--- Running Agent Enable Variations Test (HTTP PWD checks) ---"

echo "1) Isolated mode: enable agent demo (expects PWD=\"$TEST_WORKSPACE_DIR/demo\")"
ploinky enable agent demo
# Ensure container is prepared; start is optional but keeps behavior consistent
ploinky start demo 8091 || true
run_pwd_with_cli stream_def.log
if ! grep -q "${TEST_WORKSPACE_DIR}/demo" stream_def.log; then
  echo "--- cli output (isolated) ---"; sed -n '1,120p' stream_def.log
  echo "✗ Isolated mode: expected PWD '${TEST_WORKSPACE_DIR}/demo' in cli output."
  exit 1
fi
echo "✓ Isolated mode PWD verified via cli."
ploinky refresh agent demo || true
sleep 2

echo "\n2) Global mode: enable agent demo global (expects PWD=\"$TEST_WORKSPACE_DIR\")"
ploinky enable agent demo global
ploinky start demo 8092 || true
run_pwd_with_cli stream_glob.log
if ! grep -q "${TEST_WORKSPACE_DIR}" stream_glob.log; then
  echo "--- cli output (global) ---"; sed -n '1,120p' stream_glob.log
  echo "✗ Global mode: expected PWD '${TEST_WORKSPACE_DIR}' in cli output."
  exit 1
fi
echo "✓ Global mode PWD verified via cli."
ploinky refresh agent demo || true
sleep 2

echo "\n3) Devel mode: enable agent demo devel demo (expects PWD=\"$TEST_WORKSPACE_DIR/.ploinky/repos/demo\")"
ploinky enable agent demo devel demo
ploinky start demo 8093 || true
run_pwd_with_cli stream_dev.log
if ! grep -q "${TEST_WORKSPACE_DIR}/.ploinky/repos/demo" stream_dev.log; then
  echo "--- cli output (devel) ---"; sed -n '1,120p' stream_dev.log
  echo "✗ Devel mode: expected PWD '${TEST_WORKSPACE_DIR}/.ploinky/repos/demo' in cli output."
  exit 1
fi
echo "✓ Devel mode PWD verified via cli."

echo "--- All enable agent mode checks passed ---"
