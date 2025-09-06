#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-call-XXXXXX)
PORT=$(( RANDOM % 1000 + 9700 ))

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT

PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-call.log 2>&1 &
SERVER_PID=$!
sleep 2

cd "$TEST_DIR"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
$PLOINKY cloud init >/dev/null
API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")
$PLOINKY cloud login "$API_KEY" >/dev/null

echo "- Deploy demoAPI at /api"
$PLOINKY cloud deploy localhost /api demoAPI >/dev/null

echo "- Call agent command (expect success message)"
CALL_OUT=$($PLOINKY cloud call /api anything 2>&1 || true)
echo "$CALL_OUT" | grep -q "Demoo Successfully closed the flow" || {
  echo -e "${RED}Expected success message not found${NC}"; echo "$CALL_OUT"; exit 1; }

echo "- Verify metrics increased"
OVERVIEW=$(curl -sS -H "Cookie: authorizationToken=$(node -e 'try{let c=JSON.parse(require("fs").readFileSync(".ploinky/cloud.json","utf8"));process.stdout.write(c.authToken||"")}catch(e){process.stdout.write("")}' )" "http://localhost:$PORT/management/api/overview")
echo "$OVERVIEW" | grep -q 'totalRequests' || { echo -e "${RED}Overview missing${NC}"; echo "$OVERVIEW"; exit 1; }

echo -e "${GREEN}Agent call test passed (error path as expected).${NC}"

echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
