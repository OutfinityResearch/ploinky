#!/bin/bash
set -e
echo "=== Testing Parallel Task Execution - Fixed Version ==="
echo

# --- Setup ---
PROJECT_ROOT=$(pwd)
PLOINKY_CMD="$PROJECT_ROOT/bin/ploinky"
P_CLI="$PROJECT_ROOT/bin/p-cli"
TEST_DIR=$(mktemp -d -t ploinky-parallel-fix-XXXXXX)
AGENT_NAME="parallel-fix-agent"
CONTAINER_NAME="ploinky_agent_${AGENT_NAME}"

# --- Cleanup ---
cleanup() {
    echo "[CLEANUP] Cleaning up..."
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    podman rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    # Also cleanup any cloud containers
    $P_CLI cloud destroy agents 2>/dev/null || true
}
trap cleanup EXIT

echo "[SETUP] Test directory: $TEST_DIR"
cd "$TEST_DIR"

# --- Test 1: p-cli direct execution ---
echo "=== Test 1: Direct p-cli execution (ploinky run task) ==="

# Setup agent
git init --bare local_repo.git >/dev/null 2>&1
$PLOINKY_CMD add repo test-repo "$TEST_DIR/local_repo.git" >/dev/null
$PLOINKY_CMD new agent test-repo "${AGENT_NAME}" >/dev/null

# Configure for HTTP
MANIFEST_PATH=".ploinky/repos/test-repo/${AGENT_NAME}/manifest.json"
node -e "
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync('$MANIFEST_PATH'));
    manifest.taskRunner = 'http';
    fs.writeFileSync('$MANIFEST_PATH', JSON.stringify(manifest, null, 2));
"

# Create test handler
AGENT_PATH=".ploinky/repos/test-repo/${AGENT_NAME}"
mkdir -p "$AGENT_PATH/handlers"
cat > "$AGENT_PATH/handlers/echo.sh" <<'EOF'
#!/bin/sh
TASK_NUM=$1
sleep 0.5  # Simulate work
echo "{\"task\": $TASK_NUM, \"pid\": $$, \"time\": \"$(date +%s%N)\"}"
EOF
chmod +x "$AGENT_PATH/handlers/echo.sh"

echo "Running 10 parallel tasks with ploinky..."
for i in {1..10}; do
    (
        $PLOINKY_CMD run task "${AGENT_NAME}" echo $i > "ploinky_$i.log" 2>&1
    ) &
done

echo "Waiting for ploinky tasks to complete..."
wait

# Check results
PLOINKY_SUCCESS=0
for i in {1..10}; do
    if grep -q "Status: SUCCESS" "ploinky_$i.log"; then
        ((PLOINKY_SUCCESS++))
    else
        echo "  Task $i failed"
    fi
done
echo "✓ Ploinky: $PLOINKY_SUCCESS/10 tasks succeeded"
echo

# --- Test 2: p-cloud execution ---
echo "=== Test 2: Cloud execution (p-cli client task) ==="

# Start cloud server
echo "Starting cloud server..."
export PLOINKY_FORCE_SINGLE=1
export PORT=9999
$P_CLI cloud start >/dev/null 2>&1 &
CLOUD_PID=$!
sleep 3

# Initialize and connect
echo "Initializing cloud..."
$P_CLI cloud connect http://localhost:9999 >/dev/null
API_KEY=$($P_CLI cloud init 2>/dev/null | grep -o 'sk_[a-zA-Z0-9]*' || echo "test_key")
$P_CLI cloud login "$API_KEY" >/dev/null 2>&1

# Deploy agent
echo "Deploying agent to cloud..."
$P_CLI cloud deploy localhost /test parallel-test >/dev/null 2>&1

# Run parallel tasks through cloud
echo "Running 10 parallel tasks through cloud..."
for i in {1..10}; do
    (
        $P_CLI client task /test echo $i > "cloud_$i.log" 2>&1
    ) &
done

echo "Waiting for cloud tasks to complete..."
wait

# Check cloud results
CLOUD_SUCCESS=0
for i in {1..10}; do
    if grep -q "task" "cloud_$i.log" || grep -q "SUCCESS" "cloud_$i.log"; then
        ((CLOUD_SUCCESS++))
    else
        echo "  Cloud task $i failed"
    fi
done
echo "✓ Cloud: $CLOUD_SUCCESS/10 tasks succeeded"

# Stop cloud server
kill $CLOUD_PID 2>/dev/null || true
echo

# --- Test 3: Mixed concurrent execution ---
echo "=== Test 3: Mixed execution (both p-cli and cloud simultaneously) ==="

# Restart cloud server
$P_CLI cloud start >/dev/null 2>&1 &
CLOUD_PID=$!
sleep 3

echo "Running 20 tasks (10 direct, 10 cloud) simultaneously..."
for i in {1..10}; do
    (
        $PLOINKY_CMD run task "${AGENT_NAME}" echo "direct-$i" > "mixed_direct_$i.log" 2>&1
    ) &
    (
        $P_CLI client task /test echo "cloud-$i" > "mixed_cloud_$i.log" 2>&1
    ) &
done

echo "Waiting for all mixed tasks to complete..."
wait

# Check mixed results
MIXED_DIRECT_SUCCESS=0
MIXED_CLOUD_SUCCESS=0
for i in {1..10}; do
    if grep -q "Status: SUCCESS" "mixed_direct_$i.log"; then
        ((MIXED_DIRECT_SUCCESS++))
    fi
    if grep -q "task" "mixed_cloud_$i.log" || grep -q "cloud-$i" "mixed_cloud_$i.log"; then
        ((MIXED_CLOUD_SUCCESS++))
    fi
done
echo "✓ Mixed Direct: $MIXED_DIRECT_SUCCESS/10 tasks succeeded"
echo "✓ Mixed Cloud: $MIXED_CLOUD_SUCCESS/10 tasks succeeded"

# Stop cloud server
kill $CLOUD_PID 2>/dev/null || true

# --- Summary ---
echo
echo "=== Test Summary ==="
echo "Direct p-cli:    $PLOINKY_SUCCESS/10 succeeded"
echo "Cloud:           $CLOUD_SUCCESS/10 succeeded"
echo "Mixed Direct:    $MIXED_DIRECT_SUCCESS/10 succeeded"
echo "Mixed Cloud:     $MIXED_CLOUD_SUCCESS/10 succeeded"

TOTAL_SUCCESS=$((PLOINKY_SUCCESS + CLOUD_SUCCESS + MIXED_DIRECT_SUCCESS + MIXED_CLOUD_SUCCESS))
echo
if [ "$TOTAL_SUCCESS" -ge 35 ]; then
    echo "✓ PASS: Parallel execution works correctly (${TOTAL_SUCCESS}/40 tasks succeeded)"
    exit 0
else
    echo "✗ FAIL: Too many failures in parallel execution (${TOTAL_SUCCESS}/40 tasks succeeded)"
    exit 1
fi