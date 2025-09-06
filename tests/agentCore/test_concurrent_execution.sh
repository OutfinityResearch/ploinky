#!/bin/bash
set -e
echo "--- Running Test: Concurrent Task Execution Test ---"

# --- Setup ---
PROJECT_ROOT=$(pwd)
PLOINKY_CMD="$PROJECT_ROOT/bin/ploinky"
TEST_DIR=$(mktemp -d -t ploinky-concurrent-XXXXXX)
AGENT_NAME="concurrent-test-agent"
CONTAINER_NAME="ploinky_agent_${AGENT_NAME}"

# --- Cleanup ---
cleanup() {
    echo "[CLEANUP] Cleaning up container ${CONTAINER_NAME}..."
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    podman rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Main Test Logic ---
echo "[SETUP] Test directory is $TEST_DIR"
cd "$TEST_DIR"

# Create test repository and agent
git init --bare local_repo.git >/dev/null
$PLOINKY_CMD add repo test-repo "$TEST_DIR/local_repo.git" >/dev/null
$PLOINKY_CMD new agent test-repo "${AGENT_NAME}" >/dev/null

# Configure for HTTP mode
MANIFEST_PATH=".ploinky/repos/test-repo/${AGENT_NAME}/manifest.json"
node -e "
    const fs = require('fs');
    const path = '$MANIFEST_PATH';
    const manifest = JSON.parse(fs.readFileSync(path));
    manifest.taskRunner = 'http';
    fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
" 
echo "[SETUP] Configured agent for HTTP mode."

# Create a test handler that simulates work
AGENT_PATH=".ploinky/repos/test-repo/${AGENT_NAME}"
mkdir -p "$AGENT_PATH/handlers"
HANDLER_SCRIPT="$AGENT_PATH/handlers/process.sh"
cat > "$HANDLER_SCRIPT" <<'EOF'
#!/bin/sh
# Simulate processing with random delay
TASK_ID=$1
DELAY=$(awk 'BEGIN{srand(); print int(rand()*3)}')
sleep $DELAY
echo "{\"task_id\": \"$TASK_ID\", \"delay\": $DELAY, \"timestamp\": \"$(date +%s%N)\"}"
EOF
chmod +x "$HANDLER_SCRIPT"
echo "[SETUP] Created test handler with variable processing time."

# Test 1: Rapid sequential execution
echo ""
echo "[TEST 1] Rapid sequential execution..."
for i in {1..5}; do
    echo "  Task $i:"
    $PLOINKY_CMD run task "${AGENT_NAME}" process "seq-$i" 2>&1 | grep -E "Status:|Result:"
done

# Test 2: Truly parallel execution (background processes)
echo ""
echo "[TEST 2] Parallel execution (20 tasks simultaneously)..."
mkdir -p "$TEST_DIR/results"

# Launch tasks in background
for i in {1..20}; do
    (
        $PLOINKY_CMD run task "${AGENT_NAME}" process "parallel-$i" > "$TEST_DIR/results/task_$i.log" 2>&1
    ) &
done

# Wait for all background tasks
echo "  Waiting for all tasks to complete..."
wait

# Analyze results
echo "  Analyzing results..."
SUCCESS_COUNT=0
FAILED_COUNT=0
for i in {1..20}; do
    if grep -q "Status: SUCCESS" "$TEST_DIR/results/task_$i.log"; then
        ((SUCCESS_COUNT++))
    else
        ((FAILED_COUNT++))
        echo "    Task $i failed. Log excerpt:"
        head -n 5 "$TEST_DIR/results/task_$i.log" | sed 's/^/      /'
    fi
done

echo "  Results: $SUCCESS_COUNT successful, $FAILED_COUNT failed"

# Test 3: Check for port conflicts and lock timeouts
echo ""
echo "[TEST 3] Stress test with 50 concurrent tasks..."
rm -rf "$TEST_DIR/results"
mkdir -p "$TEST_DIR/results"

# Launch 50 tasks as fast as possible
for i in {1..50}; do
    (
        $PLOINKY_CMD run task "${AGENT_NAME}" process "stress-$i" > "$TEST_DIR/results/stress_$i.log" 2>&1
    ) &
done

echo "  Waiting for stress test to complete (this may take a minute)..."
wait

# Count successes and failures
STRESS_SUCCESS=0
STRESS_FAILED=0
LOCK_TIMEOUT=0
for i in {1..50}; do
    if grep -q "Status: SUCCESS" "$TEST_DIR/results/stress_$i.log"; then
        ((STRESS_SUCCESS++))
    elif grep -q "Could not acquire lock" "$TEST_DIR/results/stress_$i.log"; then
        ((LOCK_TIMEOUT++))
    else
        ((STRESS_FAILED++))
    fi
done

echo "  Stress test results:"
echo "    Successful: $STRESS_SUCCESS"
echo "    Failed: $STRESS_FAILED"
echo "    Lock timeouts: $LOCK_TIMEOUT"

# Verify results
echo ""
echo "[VERIFICATION]"
if [ "$SUCCESS_COUNT" -eq 20 ] && [ "$STRESS_SUCCESS" -gt 45 ]; then
    echo "✓ PASS: System handles concurrent tasks correctly"
    exit 0
else
    echo "✗ FAIL: Issues detected with concurrent execution"
    echo "  Expected: 20/20 for parallel test, >45/50 for stress test"
    echo "  Got: $SUCCESS_COUNT/20 for parallel, $STRESS_SUCCESS/50 for stress"
    exit 1
fi