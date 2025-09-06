#!/bin/bash

# Test: Command availability for client CLI commands

set -e

# Test setup
TEST_DIR=$(mktemp -d -t ploinky-completion-client-XXXXXX)
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

echo "Test: Client CLI Command Availability"

# Initialize environment
$PLOINKY >/dev/null 2>&1 || true

# Test 1: Test that 'client' command is available
echo -n "  1. Testing 'client' command availability... "

if ! echo "help client" | $PLOINKY 2>&1 | grep -q "HELP\|SYNTAX\|Usage\|Description" ; then
    echo -e "${RED}✗ Command 'client' not found${NC}"
    exit 1
else
    echo -e "${GREEN}✓${NC}"
fi

# Test 2: Test client subcommands are recognized
echo -n "  2. Testing client subcommands... "

SUBCMDS=(
    "client connect"
    "client call"
    "client methods"
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

echo -e "${GREEN}All client CLI availability tests passed!${NC}"
