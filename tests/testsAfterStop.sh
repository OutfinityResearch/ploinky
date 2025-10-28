#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

load_state
require_var "TEST_RUN_DIR"
require_var "TEST_AGENT_CONT_NAME"
require_var "TEST_ROUTER_PORT"
require_var "TEST_AGENT_HOST_PORT"
require_var "TEST_PERSIST_MARKER"
require_var "TEST_PERSIST_FILE"
require_var "TEST_ROUTER_LOG"

cd "$TEST_RUN_DIR"

test_check "Container exists after stop" assert_container_exists "$TEST_AGENT_CONT_NAME"
test_check "Container is no longer running" assert_container_stopped "$TEST_AGENT_CONT_NAME"
test_check "Router port ${TEST_ROUTER_PORT} closed" assert_port_not_listening "$TEST_ROUTER_PORT"
test_check "Agent port ${TEST_AGENT_HOST_PORT} closed" assert_port_not_listening "$TEST_AGENT_HOST_PORT"
test_check "Manual persistence marker retained" assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"
test_check "Agent data file retained" assert_file_exists "$TEST_PERSIST_FILE"
test_check "Router log records shutdown" check_router_stop_entry "$TEST_ROUTER_LOG" "$TEST_ROUTER_PORT" "TEST_ROUTER_STOP_LAST_ENTRY"

finalize_checks
