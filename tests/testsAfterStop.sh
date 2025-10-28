#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_CONT_NAME"
fast_require_var "TEST_ROUTER_PORT"
fast_require_var "TEST_AGENT_HOST_PORT"
fast_require_var "TEST_PERSIST_MARKER"
fast_require_var "TEST_PERSIST_FILE"
fast_require_var "TEST_ROUTER_LOG"

cd "$TEST_RUN_DIR"

fast_check "Container exists after stop" fast_assert_container_exists "$TEST_AGENT_CONT_NAME"
fast_check "Container is no longer running" fast_assert_container_stopped "$TEST_AGENT_CONT_NAME"
fast_check "Router port ${TEST_ROUTER_PORT} closed" fast_assert_port_not_listening "$TEST_ROUTER_PORT"
fast_check "Agent port ${TEST_AGENT_HOST_PORT} closed" fast_assert_port_not_listening "$TEST_AGENT_HOST_PORT"
fast_check "Manual persistence marker retained" fast_assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"
fast_check "Agent data file retained" fast_assert_file_exists "$TEST_PERSIST_FILE"
fast_check "Router log records shutdown" fast_check_router_stop_entry "$TEST_ROUTER_LOG" "$TEST_ROUTER_PORT" "TEST_ROUTER_STOP_LAST_ENTRY"

fast_finalize_checks
