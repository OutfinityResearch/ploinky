#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
REPO_ROOT=$(readlink -f "$SCRIPT_DIR/../..")
PLOINKY="$REPO_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-demo-XXXXXX)
PORT=$(( RANDOM % 1000 + 9800 ))

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  # Cleanup local and server agents
  (cd "$TEST_DIR" && $PLOINKY cloud destroy agents >/dev/null 2>&1 || true)
  (cd "$TEST_DIR" && $PLOINKY cloud destroy server-agents >/dev/null 2>&1 || true)
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

PLOINKY_FORCE_SINGLE=1 node "$REPO_ROOT/bin/p-cloud" --port "$PORT" --dir "$TEST_DIR" >/tmp/ploinky-demo.log 2>&1 &
SERVER_PID=$!
sleep 2

cd "$TEST_DIR"
$PLOINKY cloud connect "http://localhost:$PORT" >/dev/null
$PLOINKY cloud init >/dev/null
API_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.plionky/remotes.json','utf8')).apiKey)")
$PLOINKY cloud login "$API_KEY" >/dev/null

echo "- Deploy demoAPI at /demo"
$PLOINKY cloud deploy localhost /demo demoAPI >/dev/null

# Compute deployment name how server does it: domain + '_' + path with '/' -> '_'
DEP_NAME="localhost_$(echo /demo | sed 's#/#_#g')"
RUNTIME="$TEST_DIR/.ploinky/agents/${DEP_NAME}.runtime.json"

echo "- Wait for runtime ${DEP_NAME}"
TRIES=0
until [ -f "$RUNTIME" ] || [ $TRIES -ge 50 ]; do sleep 0.2; TRIES=$((TRIES+1)); done
if [ ! -f "$RUNTIME" ]; then echo -e "${RED}Runtime not created${NC}"; tail -n 200 /tmp/ploinky-demo.log || true; exit 1; fi

HOST_PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hostPort||'')" "$RUNTIME")
if [ -z "$HOST_PORT" ]; then echo -e "${RED}hostPort missing in runtime${NC}"; cat "$RUNTIME"; exit 1; fi

echo "- Call agentCore /task on 127.0.0.1:$HOST_PORT"
TRIES=0; RESP=""
until [ $TRIES -ge 50 ]; do
  RESP=$(curl -sS -X POST -H 'Content-Type: application/json' --data '{"command":"anything","params":[]}' "http://127.0.0.1:${HOST_PORT}/task" || true)
  echo "$RESP" | grep -q "Demoo Successfully closed the flow" && break
  sleep 0.2; TRIES=$((TRIES+1))
done
echo "$RESP" | grep -q "Demoo Successfully closed the flow" || { echo -e "${RED}Expected success message not found${NC}"; echo "$RESP"; tail -n 200 /tmp/ploinky-demo.log || true; exit 1; }

echo -e "${GREEN}Demo forward test passed.${NC}"
