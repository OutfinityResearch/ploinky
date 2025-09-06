#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-vhosts-XXXXXX)
PORT=$(( RANDOM % 1000 + 9200 ))

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT

PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-vhosts.log 2>&1 &
SERVER_PID=$!
sleep 2

cd "$TEST_DIR"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
$PLOINKY cloud init >/dev/null
API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")
$PLOINKY cloud login "$API_KEY" >/dev/null

echo "- Verify localhost host exists"
HOSTS=$($PLOINKY cloud host list 2>/dev/null)
echo "$HOSTS" | grep -q "localhost" || { echo -e "${RED}localhost host missing${NC}"; echo "$HOSTS"; exit 1; }

echo "- Map /api -> TestAgent"
$PLOINKY cloud deploy localhost /api TestAgent >/dev/null

echo "- Verify mapping present"
DEPS=$($PLOINKY cloud deployments)
echo "$DEPS" | grep -q "localhost/api -> TestAgent" || { echo -e "${RED}Mapping missing${NC}"; echo "$DEPS"; exit 1; }

echo "- Remove mapping"
$PLOINKY cloud undeploy localhost /api || { echo >&2 "[ERR] undeploy returned non-zero"; $PLOINKY cloud logs 500 2>&1 | tail -n +1 >&2; }
DEPS2=$($PLOINKY cloud deployments)
if echo "$DEPS2" | grep -q "localhost/api"; then echo -e "${RED}Undeploy failed${NC}"; echo "$DEPS2"; exit 1; fi

echo -e "${GREEN}Virtual Hosts tests passed.${NC}"

# Cleanup local and server agents and stop server
echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
