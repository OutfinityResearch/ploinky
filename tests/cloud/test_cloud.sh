#!/bin/bash

# Ploinky Cloud Test Suite
# Tests cloud functionality using ploinky/p-cli commands

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
TEST_DIR="/tmp/test-ploinky-cloud-$$"
TEST_PORT=8888
PLOINKY="$(pwd)/bin/ploinky"
P_CLI="$(pwd)/bin/p-cli"  # Should be same as ploinky

# Setup
echo -e "${YELLOW}Setting up test environment...${NC}"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    cd /
    $PLOINKY cloud-stop 2>/dev/null || true
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Test function
run_test() {
    local test_name="$1"
    local test_cmd="$2"
    local expected_result="$3"
    
    echo -n "Testing $test_name... "
    
    if eval "$test_cmd"; then
        if [ -z "$expected_result" ] || eval "$expected_result"; then
            echo -e "${GREEN}✓${NC}"
            ((TESTS_PASSED++))
        else
            echo -e "${RED}✗ (unexpected result)${NC}"
            ((TESTS_FAILED++))
        fi
    else
        echo -e "${RED}✗ (command failed)${NC}"
        ((TESTS_FAILED++))
    fi
}

# Start tests
echo -e "${YELLOW}Running Ploinky Cloud Tests${NC}"
echo "================================"

# Test 1: Test p-cli alias
run_test "p-cli alias" \
    "$P_CLI help | grep -q 'Ploinky'" \
    ""

# Test 2: Start cloud server
run_test "Start cloud server" \
    "$PLOINKY cloud-start --port $TEST_PORT --dir $TEST_DIR >/dev/null 2>&1 &" \
    ""

sleep 3  # Wait for server to start

# Test 3: Check server status
run_test "Server status" \
    "$PLOINKY cloud-status | grep -q 'Cloud Status'" \
    ""

# Test 4: Login as admin
run_test "Admin login" \
    "echo 'admin' | $PLOINKY cloud login admin >/dev/null 2>&1" \
    ""

# Test 5: Add a host/domain
run_test "Add host" \
    "$PLOINKY cloud host add test.local >/dev/null 2>&1" \
    ""

# Test 6: Add a repository
run_test "Add repository" \
    "$PLOINKY cloud repo add TestRepo https://github.com/test/repo.git >/dev/null 2>&1" \
    ""

# Test 7: List hosts
run_test "List hosts" \
    "$PLOINKY cloud host list | grep -q 'test.local'" \
    ""

# Test 8: List repositories
run_test "List repositories" \
    "$PLOINKY cloud repo list | grep -q 'TestRepo'" \
    ""

# Test 9: Create a simple agent for testing
echo -e "${YELLOW}Creating test agent...${NC}"
mkdir -p "$TEST_DIR/agents/test"
cat > "$TEST_DIR/agents/test/manifest.json" <<EOF
{
    "name": "TestAgent",
    "container": "docker.io/library/node:18-alpine",
    "about": "Test agent",
    "commands": {
        "echo": "echo",
        "test": "node -e 'console.log(\"test passed\")'"
    }
}
EOF

# Test 10: Deploy agent
run_test "Deploy agent" \
    "$PLOINKY cloud deploy test.local /api TestAgent >/dev/null 2>&1" \
    ""

# Test 11: List deployments
run_test "List deployments" \
    "$PLOINKY cloud deployments | grep -q 'test.local/api'" \
    ""

# Test 12: Call agent command
run_test "Call agent" \
    "$PLOINKY cloud call /api echo 'Hello World' | grep -q 'Hello World'" \
    ""

# Test 13: Show metrics
run_test "Show metrics" \
    "$PLOINKY cloud metrics 1h >/dev/null 2>&1" \
    ""

# Test 14: Show configuration
run_test "Show config" \
    "$PLOINKY cloud config show >/dev/null 2>&1" \
    ""

# Test 15: Check health
run_test "Health check" \
    "$PLOINKY cloud health >/dev/null 2>&1" \
    ""

# Test 16: Undeploy agent
run_test "Undeploy agent" \
    "$PLOINKY cloud undeploy test.local /api >/dev/null 2>&1" \
    ""

# Test 17: Remove repository
run_test "Remove repository" \
    "$PLOINKY cloud repo remove TestRepo >/dev/null 2>&1" \
    ""

# Test 18: Remove host
run_test "Remove host" \
    "$PLOINKY cloud host remove test.local >/dev/null 2>&1" \
    ""

# Test 19: Logout
run_test "Logout" \
    "$PLOINKY cloud logout >/dev/null 2>&1" \
    ""

# Test 20: Stop server
run_test "Stop server" \
    "$PLOINKY cloud-stop >/dev/null 2>&1" \
    ""

# Results
echo "================================"
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
fi