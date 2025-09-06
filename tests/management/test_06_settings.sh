#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-settings-XXXXXX)
PORT=$(( RANDOM % 1000 + 9500 ))

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT

PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-settings.log 2>&1 &
SERVER_PID=$!
sleep 2

cd "$TEST_DIR"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
$PLOINKY cloud init >/dev/null
API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")
$PLOINKY cloud login "$API_KEY" >/dev/null

echo "- Show settings"
$PLOINKY cloud settings show >/dev/null || { echo -e "${RED}Show failed${NC}"; exit 1; }

echo "- Set logLevel to debug"
$PLOINKY cloud settings set logLevel debug >/dev/null || { echo -e "${RED}Set failed${NC}"; exit 1; }

echo -e "${GREEN}Settings tests passed.${NC}"

# Cleanup local and server agents and stop server
echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
