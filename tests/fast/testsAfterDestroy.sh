#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_CONT_NAME"
fast_require_var "TEST_AGENT_LOG"
fast_require_var "TEST_PERSIST_MARKER"
fast_require_var "TEST_ROUTER_LOG_SNAPSHOT"
fast_require_var "TEST_ROUTER_PORT"

fast_check "Router log snapshot records shutdown" fast_check_router_stop_entry "$TEST_ROUTER_LOG_SNAPSHOT" "$TEST_ROUTER_PORT" "TEST_ROUTER_DESTROY_LAST_ENTRY" "${TEST_ROUTER_STOP_LAST_ENTRY:-}"
fast_check "Test agent container removed" fast_assert_container_absent "$TEST_AGENT_CONT_NAME"
fast_check "Temporary workspace directory deleted" fast_assert_file_not_exists "$TEST_RUN_DIR"
fast_check "Agent log removed with workspace" fast_assert_file_not_exists "$TEST_AGENT_LOG"
fast_check "Persistence marker removed with workspace" fast_assert_file_not_exists "$TEST_PERSIST_MARKER"

fast_finalize_checks
