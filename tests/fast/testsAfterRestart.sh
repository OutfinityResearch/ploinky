#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_SERVICE_CONTAINER"
fast_require_var "TEST_ROUTER_PORT"
fast_require_var "TEST_AGENT_HOST_PORT"
fast_require_var "TEST_AGENT_HEALTH_URL"
fast_require_var "TEST_AGENT_LOG"
fast_require_var "TEST_PERSIST_FILE"
fast_require_var "TEST_PRE_RESTART_PID"
fast_require_var "TEST_POST_RESTART_PID"
fast_require_var "TEST_PERSIST_MARKER"

cd "$TEST_RUN_DIR"

fast_check "Service container is running" fast_assert_container_running "$TEST_SERVICE_CONTAINER"
fast_check "Router port ${TEST_ROUTER_PORT} listening" fast_assert_port_listening "$TEST_ROUTER_PORT"
fast_check "Agent host port ${TEST_AGENT_HOST_PORT} listening" fast_assert_port_listening "$TEST_AGENT_HOST_PORT"
fast_check "Router status endpoint responds" fast_assert_router_status_ok
fast_check "Agent health endpoint reports ok" fast_assert_http_response_contains "$TEST_AGENT_HEALTH_URL" '"ok":true'
fast_check "Container exposes AGENT_NAME" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "AGENT_NAME" "$TEST_AGENT_NAME"
fast_check "Container exposes FAST_TEST_MARKER" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "FAST_TEST_MARKER" "fast-suite"
fast_check "Agent log file created" fast_assert_file_contains "$TEST_AGENT_LOG" "listening"
fast_check "Persisted data file created" fast_assert_file_exists "$TEST_PERSIST_FILE"

fast_check "Container PID changed after restart" fast_assert_not_equal "$TEST_PRE_RESTART_PID" "$TEST_POST_RESTART_PID" "Container PID did not change across restart."
fast_check "Persistence marker retained after restart" fast_assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"

fast_stage_header "Manifest Environment"
fast_check "Variable MY_TEST_VAR from manifest is present after restart" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "MY_TEST_VAR" "hello-manifest"

fast_finalize_checks