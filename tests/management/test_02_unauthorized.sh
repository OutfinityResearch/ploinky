#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "== Unauthorized access tests =="

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"

TEST_DIR=$(mktemp -d -t ploinky-cloud-mgmt-XXXXXX)
PORT=$(( RANDOM % 1000 + 9100 ))

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DIR"
PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-cloud-test-unauth.log 2>&1 &
SERVER_PID=$!
sleep 2

echo -n "- Call management API without login... "
OUT=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/management/api/overview") || true
if [ "$OUT" = "401" ]; then echo -e "${GREEN}OK${NC}"; else echo -e "${RED}FAILED${NC} (status $OUT)"; exit 1; fi

echo -n "- Logs API without login... "
OUT2=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/management/api/logs?lines=10") || true
if [ "$OUT2" = "401" ]; then echo -e "${GREEN}OK${NC}"; else echo -e "${RED}FAILED${NC} (status $OUT2)"; exit 1; fi

echo -e "${GREEN}Unauthorized tests passed.${NC}"

# Cleanup local and server agents and stop server
echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
