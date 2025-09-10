#!/bin/bash
set -euo pipefail

THIS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
ROOT_DIR=$(cd "$THIS_DIR/../.." && pwd)
PLOINKY_CMD="$ROOT_DIR/bin/ploinky"

echo "Using Ploinky: $PLOINKY_CMD"

fail=0
pass=0

for t in "$THIS_DIR"/test_*.sh; do
  bn=$(basename "$t")
  [[ "$bn" == "test_all.sh" ]] && continue
  echo "==== Running $bn ===="
  ( cd "$ROOT_DIR" && PLOINKY_CMD="$PLOINKY_CMD" bash "$t" ) && { echo "[PASS] $bn"; ((pass++)) || true; } || { echo "[FAIL] $bn"; ((fail++)) || true; }
  echo
done

echo "Summary: PASS=$pass FAIL=$fail"
exit $fail
