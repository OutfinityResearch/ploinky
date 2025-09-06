#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-logs-XXXXXX)
PORT=$(( RANDOM % 1000 + 9400 ))

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT

PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-logs.log 2>&1 &
SERVER_PID=$!
sleep 2

$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
$PLOINKY cloud init >/dev/null
cd "$TEST_DIR"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")
$PLOINKY cloud login "$API_KEY" >/dev/null

echo "- List logs"
$PLOINKY cloud logs list | grep -E "^[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}$" >/dev/null || true

echo "- Show last 50 lines"
$PLOINKY cloud logs 50 >/dev/null || true

echo "- Download today gz"
DATE=$(date +%F)
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -H "Cookie: authorizationToken=$($PLOINKY cloud status >/dev/null 2>&1; node -e 'try{let c=JSON.parse(require("fs").readFileSync(".ploinky/cloud.json","utf8"));console.log(c.authToken||"")}catch(e){console.log("")}')" "http://localhost:$PORT/management/api/logs/download?date=$DATE") || true
if [ "$STATUS" != "200" ]; then echo -e "${RED}Download failed (HTTP $STATUS)${NC}"; exit 1; fi

echo -e "${GREEN}Logs tests passed.${NC}"

# Cleanup local and server agents and stop server
echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
