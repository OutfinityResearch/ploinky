#!/bin/bash

# Test: Command availability for cloud CLI commands

set -e

# Test setup
TEST_DIR=$(mktemp -d -t ploinky-completion-cloud-XXXXXX)
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

echo "Test: Cloud CLI Command Availability"

# Initialize environment
$PLOINKY >/dev/null 2>&1 || true

# Test 1: Test that 'cloud' command is available
echo -n "  1. Testing 'cloud' command availability... "

if ! echo "help cloud" | $PLOINKY 2>&1 | grep -q "HELP\|SYNTAX\|Usage\|Description" ; then
    echo -e "${RED}✗ Command 'cloud' not found${NC}"
    exit 1
else
    echo -e "${GREEN}✓${NC}"
fi

# Test 2: Test cloud subcommands are recognized
echo -n "  2. Testing cloud subcommands... "

SUBCMDS=(
    "cloud connect"
    "cloud login"
    "cloud status"
    "cloud host"
    "cloud repo"
    "cloud deploy"
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

echo -e "${GREEN}All cloud CLI availability tests passed!${NC}"
