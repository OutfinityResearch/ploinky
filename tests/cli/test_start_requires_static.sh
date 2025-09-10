#!/bin/bash
set -euo pipefail

echo "--- Test: start requires static config first ---"

PLOINKY_CMD="$(pwd)/bin/ploinky"

rm -rf .ploinky || true

OUT=$($PLOINKY_CMD start 2>&1 || true)
echo "$OUT" | grep -qi missing static agent" || { echo "Expected error about static agent"; echo "$OUT"; exit 1; }

echo "PASS"

