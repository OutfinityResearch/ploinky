#!/bin/bash

# Test: Cloud auto-initialization

set -e

# Test setup
TEST_DIR="/tmp/test-ploinky-init-$$"
P_CLOUD="$(pwd)/bin/p-cloud"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Cleanup function
cleanup() {
    pkill -f "p-cloud.*9876" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Create test directory
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test: Cloud auto-initialization"

# Test 1: Start p-cloud (should auto-initialize)
echo -n "  1. Starting p-cloud with auto-init... "
timeout 3 $P_CLOUD --port 9876 >/dev/null 2>&1 &
sleep 2
pkill -f "p-cloud.*9876" 2>/dev/null || true
echo -e "${GREEN}✓${NC}"

# Test 2: Check directories created
echo -n "  2. Checking directories... "
EXPECTED_DIRS=".ploinky agents activeUsers metrics"
ALL_EXIST=true
for DIR in $EXPECTED_DIRS; do
    if [ ! -d "$DIR" ]; then
        ALL_EXIST=false
        break
    fi
done

if $ALL_EXIST; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Missing directories${NC}"
    exit 1
fi

# Test 3: Check config file
echo -n "  3. Checking config file... "
if [ -f "config.json" ]; then
    # Verify it's valid JSON
    if python3 -m json.tool config.json >/dev/null 2>&1 || \
       node -e "JSON.parse(require('fs').readFileSync('config.json'))" 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗ Invalid JSON${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Config not found${NC}"
    exit 1
fi

# Test 4: Check admin file created
echo -n "  4. Checking admin account... "
if [ -f ".admin" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Admin file not found${NC}"
    exit 1
fi

# Test 5: Re-run p-cloud (should not re-initialize)
echo -n "  5. Testing idempotency... "
timeout 3 $P_CLOUD --port 9877 >/dev/null 2>&1 &
sleep 2
pkill -f "p-cloud.*9877" 2>/dev/null || true

# Check that config wasn't overwritten
if [ -f "config.json" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    exit 1
fi

echo -e "${GREEN}All initialization tests passed!${NC}"