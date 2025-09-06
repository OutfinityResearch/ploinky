#!/bin/bash

echo "--- Running Test: Final Diagnostics ---"

# --- Setup ---
PROJECT_ROOT=$(pwd)
PLOINKY_CMD="$PROJECT_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-final-test-XXXXXX)
AGENT_NAME="final-test-agent"
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
HANDLER_SCRIPT="$AGENT_PATH/handlers/greet.sh"
cat > "$HANDLER_SCRIPT" <<EOF
#!/bin/sh
echo "{\"greeting\": \"Hello\"}"
EOF
chmod +x "$HANDLER_SCRIPT"
echo "[SETUP] Created dummy handler."

# --- Execution ---
echo "[ACTION] Running 'run task' and checking for errors..."

set +e # Disable exit on error
$PLOINKY_CMD run task "${AGENT_NAME}" greet World
EXIT_CODE=$?
set -e # Re-enable

if [ $EXIT_CODE -ne 0 ]; then
    echo "[FAIL] The ploinky command failed with exit code $EXIT_CODE."
    echo "[INFO] Retrieving container logs for ${CONTAINER_NAME}..."
    # Give a slight delay for logs to flush
    sleep 1 
    docker logs "${CONTAINER_NAME}"
    exit 1
fi

echo "[PASS] Ploinky command executed successfully."
exit 0
