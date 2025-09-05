#!/bin/bash

# Test: Cloud server start/stop

set -e

# Test setup
TEST_DIR="/tmp/test-ploinky-server-$$"
TEST_PORT=9999
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

echo "Test: Cloud server operations"

# Test 1: Start server directly with p-cloud
echo -n "  1. Starting server... "
P_CLOUD="$(dirname "$PLOINKY")/p-cloud"
$P_CLOUD --port $TEST_PORT --dir "$TEST_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 3  # Give server time to start

# Check if server responds
if curl -s "http://localhost:$TEST_PORT" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Server not responding${NC}"
    exit 1
fi

# Test 2: Check redirect to /management
echo -n "  2. Testing root redirect... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$TEST_PORT/")
if [ "$RESPONSE" = "302" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Expected 302, got $RESPONSE${NC}"
    exit 1
fi

# Test 3: Check management page accessible
echo -n "  3. Testing management page... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$TEST_PORT/management")
if [ "$RESPONSE" = "200" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Expected 200, got $RESPONSE${NC}"
    exit 1
fi

# Test 4: Check 404 handling
echo -n "  4. Testing 404 page... "
RESPONSE=$(curl -s "http://localhost:$TEST_PORT/nonexistent")
if echo "$RESPONSE" | grep -q "404"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ 404 page not working${NC}"
    exit 1
fi

# Test 5: Stop server
echo -n "  5. Stopping server... "
kill $SERVER_PID 2>/dev/null
sleep 2

# Check if server stopped
if ! curl -s "http://localhost:$TEST_PORT" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Server still running${NC}"
    exit 1
fi

echo -e "${GREEN}All server tests passed!${NC}"