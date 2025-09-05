#!/bin/bash

# Ploinky Test Suite Runner
# Runs all test scripts in the tests directory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the tests directory
TESTS_DIR=$(dirname "$(readlink -f "$0")")
TOTAL_PASSED=0
TOTAL_FAILED=0

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}       Ploinky Complete Test Suite         ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}\n"

# Find all test scripts
TEST_SCRIPTS=$(find "$TESTS_DIR" -name "test_*.sh" -type f | sort)

if [ -z "$TEST_SCRIPTS" ]; then
    echo -e "${YELLOW}No test scripts found${NC}"
    exit 0
fi

# Run each test script
for TEST_SCRIPT in $TEST_SCRIPTS; do
    TEST_NAME=$(basename "$TEST_SCRIPT" .sh)
    echo -e "\n${YELLOW}Running: $TEST_NAME${NC}"
    echo "-----------------------------------"
    
    if bash "$TEST_SCRIPT"; then
        echo -e "${GREEN}✓ $TEST_NAME passed${NC}"
        ((TOTAL_PASSED++))
    else
        echo -e "${RED}✗ $TEST_NAME failed${NC}"
        ((TOTAL_FAILED++))
    fi
done

# Summary
echo -e "\n${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}                 Summary                    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}Passed: $TOTAL_PASSED${NC}"

if [ $TOTAL_FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $TOTAL_FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed! 🎉${NC}"
fi