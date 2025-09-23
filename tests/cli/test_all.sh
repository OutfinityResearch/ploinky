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

for t in "$THIS_DIR"/test_*.sh; do
  bn=$(basename "$t")
  [[ "$bn" == "test_all.sh" ]] && continue
  echo "==== Running $bn ===="
  ( cd "$ROOT_DIR" && PLOINKY_CMD="$PLOINKY_CMD" bash "$t" ) && {
    echo "[PASS] $bn"
    ((pass++))
  } || {
    echo "[FAIL] $bn"
    ((fail++))
    failed_tests+=("$bn")
  }
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
