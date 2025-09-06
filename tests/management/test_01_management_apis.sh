#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "== Management API tests (API Key auth) =="

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"

TEST_DIR=$(mktemp -d -t ploinky-cloud-mgmt-XXXXXX)
PORT=$(( RANDOM % 1000 + 9000 ))

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "- Starting server on port $PORT"
PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-cloud-test.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 2.5

echo "- Connect CLI to server"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null

echo -n "- Initialize server (generate API Key)... "
INIT_OUT=$($PLOINKY cloud init 2>/dev/null || true)
if ! echo "$INIT_OUT" | grep -qi "API Key"; then
  echo -e "${RED}FAILED${NC}"; echo "$INIT_OUT"; exit 1
else
  echo -e "${GREEN}OK${NC}"
fi

REMOTE_FILE="$HOME/.plionky/remotes.json"
echo -n "- Check remotes.json saved... "
if [ ! -f "$REMOTE_FILE" ]; then echo -e "${RED}MISSING${NC}"; exit 1; else echo -e "${GREEN}OK${NC}"; fi

API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")

echo -n "- Login using API key... "
LOGIN_OUT=$($PLOINKY cloud login "$API_KEY" 2>&1)
echo "$LOGIN_OUT" | grep -q "Logged in using API Key" && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAILED${NC}"; echo "$LOGIN_OUT"; exit 1; }

echo "- Verify localhost host exists"
HOSTS=$($PLOINKY cloud host list 2>/dev/null)
echo "$HOSTS" | grep -q "localhost" || { echo -e "${RED}localhost host missing${NC}"; echo "$HOSTS"; exit 1; }

echo "- Add repo and verify list"
$PLOINKY cloud repo add TestRepo https://example.com/repo.git >/dev/null
REPOS=$($PLOINKY cloud repo list 2>/dev/null)
echo "$REPOS" | grep -q "TestRepo" || { echo -e "${RED}Repo not listed${NC}"; exit 1; }

echo "- Deploy and verify deployments"
$PLOINKY cloud deploy localhost /api TestAgent >/dev/null
DEPS=$($PLOINKY cloud deployments 2>/dev/null)
echo "$DEPS" | grep -q "localhost/api -> TestAgent" || { echo -e "${RED}Deployment not listed${NC}"; echo "$DEPS"; exit 1; }

echo "- Undeploy and verify removal"
$PLOINKY cloud undeploy localhost /api || { echo >&2 "[ERR] undeploy returned non-zero"; $PLOINKY cloud logs 500 2>&1 | tail -n +1 >&2; }
DEPS2=$($PLOINKY cloud deployments 2>/dev/null)
if echo "$DEPS2" | grep -q "localhost/api -> TestAgent"; then echo -e "${RED}Undeploy failed${NC}"; echo "$DEPS2"; exit 1; fi

echo "- Remove host and verify"
$PLOINKY cloud host remove example.com >/dev/null
HOSTS2=$($PLOINKY cloud host list 2>/dev/null)
if echo "$HOSTS2" | grep -q "example.com"; then echo -e "${RED}Host still present${NC}"; exit 1; fi

echo "- Show remote"
$PLOINKY cloud show | grep -q "API Key" || { echo -e "${RED}cloud show failed${NC}"; exit 1; }

echo -e "${GREEN}All management API tests passed.${NC}"


# Cleanup local and server agents and stop server
echo "- Cleanup local agents"
$PLOINKY cloud destroy agents >/dev/null 2>&1 || true
echo "- Cleanup server agents"
$PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true
