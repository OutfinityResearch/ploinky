#!/bin/bash
# Do not use -e here; we want to continue after failures
set -uo pipefail

THIS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
ROOT_DIR=$(cd "$THIS_DIR/../.." && pwd)
PLOINKY_CMD="$ROOT_DIR/bin/ploinky"

echo "Using Ploinky: $PLOINKY_CMD"

fail=0
pass=0
failed_tests=()

tests=(
  "agent_commands.sh"
  "agent_lifecycle.sh"
  "cleanup_commands.sh"
  "client_commands.sh"
  "expose_var.sh"
  "logs_command.sh"
  "repo_commands.sh"
  "restart_command.sh"
  "set_command.sh"
  "shell_cli_command.sh"
  "start_configuration.sh"
  "web_commands.sh"
  "demo_run.sh"
  "paramParser.test.mjs"
)

for t in "${tests[@]}"; do
  bn="$t"
  test_path="$THIS_DIR/$bn"
  echo "==== Running $bn ===="
  if [[ "$bn" == *.mjs ]]; then
    ( cd "$ROOT_DIR" && node "$test_path" ) && {
      echo "[PASS] $bn"
      ((pass++))
    } || {
      echo "[FAIL] $bn"
      ((fail++))
      failed_tests+=("$bn")
    }
  else
    ( cd "$ROOT_DIR" && PLOINKY_CMD="$PLOINKY_CMD" bash "$test_path" ) && {
      echo "[PASS] $bn"
      ((pass++))
    } || {
      echo "[FAIL] $bn"
      ((fail++))
      failed_tests+=("$bn")
    }
  fi
  echo
done

echo "Summary: PASS=$pass FAIL=$fail"

if [ ${#failed_tests[@]} -ne 0 ]; then
  echo
  echo "--- Failed Tests ---"
  for test_name in "${failed_tests[@]}"; do
    echo "- $test_name"
  done
  echo "--------------------"
fi

exit $fail
