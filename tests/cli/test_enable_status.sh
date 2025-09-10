#!/bin/bash
set -euo pipefail

echo "--- Test: enable agent + status output ---"

PLOINKY_CMD="$(pwd)/bin/ploinky"

rm -rf .ploinky || true

$PLOINKY_CMD enable repo basic >/dev/null 2>&1 || true

$PLOINKY_CMD enable agent my-test-agent

OUT=$($PLOINKY_CMD status)
echo "$OUT" | grep -q "Workspace status" || { echo "missing status header"; exit 1; }
echo "$OUT" | grep -q "Agents:" || { echo "missing Agents section"; exit 1; }
echo "$OUT" | grep -q "my-test-agent" || { echo "missing enabled agent"; exit 1; }

echo "PASS"

