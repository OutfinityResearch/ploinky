#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_SERVICE_CONTAINER"
fast_require_var "TEST_AGENT_LOG"
fast_require_var "TEST_PERSIST_MARKER"

fast_check "Service container removed" fast_assert_container_absent "$TEST_SERVICE_CONTAINER"
fast_check "Temporary workspace directory deleted" fast_assert_file_not_exists "$TEST_RUN_DIR"
fast_check "Agent log removed with workspace" fast_assert_file_not_exists "$TEST_AGENT_LOG"
fast_check "Persistence marker removed with workspace" fast_assert_file_not_exists "$TEST_PERSIST_MARKER"

fast_finalize_checks
