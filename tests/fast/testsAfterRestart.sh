#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

# Reuse standard running state verifications.
bash "$FAST_DIR/testsAfterStart.sh"

fast_load_state
fast_require_var "TEST_PRE_RESTART_PID"
fast_require_var "TEST_POST_RESTART_PID"
fast_require_var "TEST_PERSIST_MARKER"

FAST_CHECK_ERRORS=0

fast_check "Container PID changed after restart" fast_assert_not_equal "$TEST_PRE_RESTART_PID" "$TEST_POST_RESTART_PID" "Container PID did not change across restart."
fast_check "Persistence marker retained after restart" fast_assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"

fast_finalize_checks
