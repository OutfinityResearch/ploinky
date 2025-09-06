#!/bin/bash

# Test: Tab completion and command availability for core CLI commands

set -e

# Test setup
TEST_DIR=$(mktemp -d -t ploinky-completion-cli-XXXXXX)
PLOINKY="$(pwd)/bin/ploinky"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Cleanup function
cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Create test directory
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test: Core CLI Command Completion & Availability"

# Initialize environment
$PLOINKY >/dev/null 2>&1 || true

# Test 1: Test that help command works
echo -n "  1. Testing help command... "
if echo "help" | $PLOINKY 2>&1 | grep -q "PLOINKY"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Help command failed${NC}"
    exit 1
fi

# Test 2: Test that list commands work
echo -n "  2. Testing list commands... "
if echo "list repos" | $PLOINKY 2>&1 | grep -q "repositories\|PloinkyAgents"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ List command failed${NC}"
    exit 1
fi

# Test 3: Test main local commands are available
echo -n "  3. Testing main command availability... "

COMMANDS="add new set enable run list"
FAILED=""

for cmd in $COMMANDS; do
    if ! echo "help $cmd" | $PLOINKY 2>&1 | grep -q "HELP\|SYNTAX\|Usage\|Description" ; then
        FAILED="$FAILED $cmd"
    fi

done

if [ -z "$FAILED" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Commands failed: $FAILED${NC}"
    exit 1
fi

# Test 4: Test local subcommands are recognized
echo -n "  4. Testing subcommands... "

SUBCMDS=(
    "add repo"
    "run agent"
)

FAILED=""
for subcmd in "${SUBCMDS[@]}"; do
    if ! echo "help $subcmd" | $PLOINKY 2>&1 | grep -q "HELP\|SYNTAX\|Usage" ; then
        FAILED="$FAILED '$subcmd'"
    fi
done

if [ -z "$FAILED" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Subcommands failed: $FAILED${NC}"
    exit 1
fi

# Test 5: Verify internal commands don't conflict with file system
echo -n "  5. Testing command isolation from filesystem... "

# Create some test files that might interfere
touch add new set list

# Test that commands still work despite files with same names
if echo "help list" | $PLOINKY 2>&1 | grep -q "HELP\|List"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ Commands affected by filesystem${NC}"
    exit 1
fi

echo -e "${GREEN}All core CLI completion tests passed!${NC}"
