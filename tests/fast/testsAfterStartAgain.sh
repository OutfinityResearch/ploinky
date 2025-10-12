#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

# Reuse the primary start verification suite.
bash "$FAST_DIR/testsAfterStart.sh"

fast_load_state
fast_require_var "TEST_PERSIST_MARKER"
fast_require_var "TEST_PERSIST_FILE"

# Reset counter for additional persistence checks.
FAST_CHECK_ERRORS=0

fast_check "Persistence marker survived restart" fast_assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"
fast_check "Agent data file still present after restart" fast_assert_file_exists "$TEST_PERSIST_FILE"
fast_check "Agent data file retains initialization signature" fast_assert_file_contains "$TEST_PERSIST_FILE" "initialized"

fast_finalize_checks
