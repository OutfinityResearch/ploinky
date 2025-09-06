#!/bin/bash
set -e
echo "--- Running Test: agentCore Stress Test (HTTP Architecture) ---"

# --- Setup ---
PROJECT_ROOT=$(pwd)
PLOINKY_CMD="$PROJECT_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-http-stress-XXXXXX)
AGENT_NAME="http-stress-agent"
CONTAINER_NAME="ploinky_agent_${AGENT_NAME}"

# --- Cleanup ---
cleanup() {
    echo "[CLEANUP] Cleaning up container ${CONTAINER_NAME}..."
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Main Test Logic ---
echo "[SETUP] Test directory is $TEST_DIR"
cd "$TEST_DIR"

git init --bare local_repo.git >/dev/null
$PLOINKY_CMD add repo test-repo "$TEST_DIR/local_repo.git" >/dev/null
$PLOINKY_CMD new agent test-repo "${AGENT_NAME}" >/dev/null

MANIFEST_PATH=".ploinky/repos/test-repo/${AGENT_NAME}/manifest.json"
node -e "
    const fs = require('fs');
    const path = '$MANIFEST_PATH';
    const manifest = JSON.parse(fs.readFileSync(path));
    manifest.taskRunner = 'http';
    fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
" 
echo "[SETUP] Added 'taskRunner: http' to manifest."

AGENT_PATH=".ploinky/repos/test-repo/${AGENT_NAME}"
mkdir -p "$AGENT_PATH/handlers"
HANDLER_SCRIPT="$AGENT_PATH/handlers/count.sh"
cat > "$HANDLER_SCRIPT" <<EOF
#!/bin/sh
# Simulate some work
sleep 0.1
echo "{\"count\": \"$1\"}"
EOF
chmod +x "$HANDLER_SCRIPT"
echo "[SETUP] Created dummy handler."

# Run 10 tasks in parallel
echo "[ACTION] Enqueuing 10 tasks in parallel..."
for i in {1..10}
do
    $PLOINKY_CMD run task "${AGENT_NAME}" count $i > "$TEST_DIR/output_$i.log" 2>&1 &
done

# Wait for all background jobs to finish
wait
echo "[ACTION] All tasks submitted."

# Verification
echo "[VERIFY] Verifying results..."
SUCCESS_COUNT=0
for i in {1..10}
do
    if grep -q "Status: SUCCESS" "$TEST_DIR/output_$i.log"; then
        ((SUCCESS_COUNT++))
    else
        echo "[WARN] Task $i did not succeed. Log:"
        cat "$TEST_DIR/output_$i.log"
    fi
done

echo "[INFO] Successful tasks: $SUCCESS_COUNT/10"

if [ "$SUCCESS_COUNT" -ne 10 ]; then
    echo "[FAIL] Not all tasks succeeded."
    exit 1
fi

echo "[PASS] All 10 tasks succeeded."
exit 0
