#!/bin/bash

# Run all management tests in this folder
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}       Ploinky Management Tests Runner        ${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}\n"

TESTS=$(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'test_*.sh' | sort)

if [ -z "$TESTS" ]; then
  echo -e "${YELLOW}No management tests found${NC}"
  exit 0
fi

TOTAL=0
PASSED=0
FAILED=0

# Detect if sourced
IS_SOURCED=0
(return 0 2>/dev/null) && IS_SOURCED=1 || true

for T in $TESTS; do
  TOTAL=$((TOTAL+1))
  NAME=$(basename "$T")
  echo -e "\n${YELLOW}Running: ${NAME}${NC}"
  echo "-----------------------------------"
    if bash "$T"; then
        echo -e "${GREEN}✓ ${NAME} passed${NC}"
        PASSED=$((PASSED+1))
    else
        echo -e "${RED}✗ ${NAME} failed${NC}"
        FAILED=$((FAILED+1))
    fi
done

echo -e "\n${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}                 Summary                       ${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}Passed: ${PASSED}/${TOTAL}${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: ${FAILED}${NC}"
  if [ $IS_SOURCED -eq 1 ]; then return 1; else exit 1; fi
else
  echo -e "${GREEN}All management tests passed! 🎉${NC}"
  if [ $IS_SOURCED -eq 1 ]; then return 0; else exit 0; fi
fi
