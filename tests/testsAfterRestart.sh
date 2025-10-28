#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

load_state
require_var "TEST_RUN_DIR"
require_var "TEST_AGENT_CONT_NAME"
require_var "TEST_ROUTER_PORT"
require_var "TEST_AGENT_HOST_PORT"
require_var "TEST_AGENT_HEALTH_URL"
require_var "TEST_AGENT_LOG"
require_var "TEST_PERSIST_FILE"
require_var "TEST_PRE_RESTART_PID"
require_var "TEST_POST_RESTART_PID"
require_var "TEST_PERSIST_MARKER"

cd "$TEST_RUN_DIR"

test_check "Service container is running" assert_container_running "$TEST_AGENT_CONT_NAME"
test_check "Router port ${TEST_ROUTER_PORT} listening" assert_port_listening "$TEST_ROUTER_PORT"
test_check "Agent host port ${TEST_AGENT_HOST_PORT} listening" assert_port_listening "$TEST_AGENT_HOST_PORT"
test_check "Router status endpoint responds" assert_router_status_ok
test_check "Agent health endpoint reports ok" assert_http_response_contains "$TEST_AGENT_HEALTH_URL" '"ok":true'
test_check "Container exposes AGENT_NAME" assert_container_env "$TEST_AGENT_CONT_NAME" "AGENT_NAME" "$TEST_AGENT_NAME"
test_check "Container exposes FAST_TEST_MARKER" assert_container_env "$TEST_AGENT_CONT_NAME" "FAST_TEST_MARKER" "fast-suite"
test_check "Agent log file created" assert_file_contains "$TEST_AGENT_LOG" "listening"
test_check "Persisted data file created" assert_file_exists "$TEST_PERSIST_FILE"

test_check "Container PID changed after restart" assert_not_equal "$TEST_PRE_RESTART_PID" "$TEST_POST_RESTART_PID" "Container PID did not change across restart."
test_check "Persistence marker retained after restart" assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"

stage_header "Manifest Environment"
test_check "Variable MY_TEST_VAR from manifest is present after restart" assert_container_env "$TEST_AGENT_CONT_NAME" "MY_TEST_VAR" "hello-manifest"

finalize_checks
