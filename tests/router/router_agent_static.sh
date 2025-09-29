#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-router-static-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

PORT=8088

wait_router() {
  local port="$1"
  for i in {1..60}; do
    if curl -fsS "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

echo "--- Agent-Specific Static Routing Test (simulator manifest) ---"

# Prepare demo repo and start
ploinky enable repo demo
ploinky start demo "$PORT"
wait_router "$PORT"

URL_SIM_MANIFEST="http://127.0.0.1:${PORT}/simulator/manifest.json"
HTTP_CODE=$(curl -sS -o /tmp/resp1.out -w "%{http_code}" "$URL_SIM_MANIFEST" || true)
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "✗ Agent-specific static routing failed for simulator manifest.json (HTTP $HTTP_CODE)."
  exit 1
fi
if ! head -c 200 /tmp/resp1.out | grep -Eq '"name"|"container"|"agent"'; then
  echo "✗ simulator/manifest.json does not look like a manifest (expected keys missing)."
  head -c 200 /tmp/resp1.out || true
  exit 1
fi
echo "✓ Served simulator/manifest.json via agent-specific routing."

echo "--- Agent-Specific Static Routing Test PASSED ---"

# --- Fallback static routing (root) test ---
echo "--- Static Root Fallback Routing Test (demo.html) ---"

# Fetch demo.html via root fallback: GET /demo.html should map to static.hostPath/demo.html
HTTP_CODE2=$(curl -sS -o /tmp/root.out -w "%{http_code}" "http://127.0.0.1:${PORT}/demo.html" || true)
if [[ "$HTTP_CODE2" != "200" ]]; then
  echo "✗ Fallback static routing for /demo.html failed (HTTP $HTTP_CODE2)"
  exit 1
fi
if ! head -c 200 /tmp/root.out | grep -qi '<html'; then
  echo "✗ /demo.html returned but does not appear to be HTML."
  head -c 200 /tmp/root.out || true
  exit 1
fi
echo "✓ Fallback static routing served demo.html from static.hostPath."
