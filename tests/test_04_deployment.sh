#!/bin/bash

# Test: Agent deployment and management

set -e

# Test setup
TEST_DIR="/tmp/test-ploinky-deploy-$$"
TEST_PORT=9997
PLOINKY="$(pwd)/bin/ploinky"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Cleanup function
cleanup() {
    # Kill server if running
    [ ! -z "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null || true
    pkill -f "p-cloud.*$TEST_PORT" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Create test directory
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test: Deployment operations"

# Start server directly with p-cloud (will auto-initialize)
P_CLOUD="$(dirname "$PLOINKY")/p-cloud"
$P_CLOUD --port $TEST_PORT --dir "$TEST_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 3

# Connect to the server
$PLOINKY cloud connect "localhost:$TEST_PORT" >/dev/null 2>&1

# Login
echo "admin" | $PLOINKY cloud login admin >/dev/null 2>&1

# Test 1: Add host
echo -n "  1. Adding host... "
if $PLOINKY cloud host add test.local >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    exit 1
fi

# Test 2: List hosts
echo -n "  2. Listing hosts... "
if $PLOINKY cloud host list 2>&1 | grep -q "test.local"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Host not found${NC}"
    exit 1
fi

# Test 3: Add repository
echo -n "  3. Adding repository... "
if $PLOINKY cloud repo add TestRepo https://github.com/test/repo.git >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    exit 1
fi

# Test 4: List repositories
echo -n "  4. Listing repositories... "
if $PLOINKY cloud repo list 2>&1 | grep -q "TestRepo"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Repository not found${NC}"
    exit 1
fi

# Test 5: Create test agent
echo -n "  5. Creating test agent... "
mkdir -p agents/TestAgent
cat > agents/TestAgent/manifest.json <<EOF
{
    "name": "TestAgent",
    "container": "node:18-alpine",
    "about": "Test agent",
    "commands": {
        "hello": "echo 'Hello from TestAgent'"
    }
}
EOF
echo -e "${GREEN}✓${NC}"

# Test 6: Deploy agent
echo -n "  6. Deploying agent... "
if $PLOINKY cloud deploy test.local /test TestAgent >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi

# Test 7: List deployments
echo -n "  7. Listing deployments... "
if $PLOINKY cloud deployments 2>&1 | grep -q "test.local/test"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Deployment not listed${NC}"
    exit 1
fi

# Test 8: Undeploy agent
echo -n "  8. Undeploying agent... "
if $PLOINKY cloud undeploy test.local /test >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Undeploy failed${NC}"
    exit 1
fi

# Test 9: Remove host
echo -n "  9. Removing host... "
if $PLOINKY cloud host remove test.local >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    exit 1
fi

echo -e "${GREEN}All deployment tests passed!${NC}"