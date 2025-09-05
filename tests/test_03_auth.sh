#!/bin/bash

# Test: Authentication and admin operations

set -e

# Test setup
TEST_DIR="/tmp/test-ploinky-auth-$$"
TEST_PORT=9998
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

echo "Test: Authentication"

# Start server directly with p-cloud (will auto-initialize)
P_CLOUD="$(dirname "$PLOINKY")/p-cloud"
$P_CLOUD --port $TEST_PORT --dir "$TEST_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 3

# Connect to the server
$PLOINKY cloud connect "localhost:$TEST_PORT" >/dev/null 2>&1

# Test 1: Login with default credentials
echo -n "  1. Login with admin/admin... "
# Save config for auth token
CONFIG_FILE=".ploinky/cloud.json"
echo "admin" | $PLOINKY cloud login admin >/dev/null 2>&1

if [ -f "$CONFIG_FILE" ] && grep -q "authToken" "$CONFIG_FILE"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Login failed${NC}"
    exit 1
fi

# Test 2: Check authenticated status
echo -n "  2. Checking auth status... "
if $PLOINKY cloud status 2>&1 | grep -q "Logged in as"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Status check failed${NC}"
    exit 1
fi

# Test 3: Logout
echo -n "  3. Testing logout... "
$PLOINKY cloud logout >/dev/null 2>&1

if grep -q "authToken" "$CONFIG_FILE" 2>/dev/null; then
    echo -e "${RED}✗ Token still present${NC}"
    exit 1
else
    echo -e "${GREEN}✓${NC}"
fi

# Test 4: Verify logged out
echo -n "  4. Verifying logged out... "
if $PLOINKY cloud status 2>&1 | grep -q "Not logged in"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Still logged in${NC}"
    exit 1
fi

echo -e "${GREEN}All auth tests passed!${NC}"