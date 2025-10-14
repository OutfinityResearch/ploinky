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

#MCP
fast_mcp_start_simulator() {
  ploinky start simulator >/dev/null
  sleep 2
}

fast_mcp_client_status() {
  ploinky client status simulator | grep -q 'ok=true'
}

fast_mcp_list_tools() {
  local output
  output=$(ploinky client list tools)
  if ! grep -q 'run_simulation' <<<"$output"; then
    echo "run_simulation not found in client list tools" >&2
    return 1
  fi
}

fast_mcp_run_simulation() {
  ploinky client tool run_simulation -iterations 10 | tee "$TEST_RUN_DIR/mcp_cli_run_simulation.log" | grep -q '"iterations":10'
}

fast_mcp_start_demo() {
  ploinky start demo >/dev/null
  sleep 2
}

fast_mcp_list_tools_after_demo() {
  local output
  output=$(ploinky client list tools)
  fast_info "--- ploinky client list tools output (after demo) ---"
  fast_info "$output"
  fast_info "-------------------------------------------------"
  if ! grep -q 'run_simulation' <<<"$output"; then
    echo "run_simulation not found after starting demo" >&2
    return 1
  fi
  if ! grep -q 'echo_script' <<<"$output"; then
    echo "echo_script not found after starting demo" >&2
    return 1
  fi
}

fast_info  "MCP tests"
fast_check "running: start simulator" fast_mcp_start_simulator
fast_check "running: client status simulator" fast_mcp_client_status
fast_check "running: client list tools" fast_mcp_list_tools
fast_check "running: client tool run_simulation -iterations 10" fast_mcp_run_simulation

fast_info "MCP demo agent tests"
fast_check "running: start demo" fast_mcp_start_demo
fast_check "router server mcp agregation" fast_mcp_list_tools_after_demo

fast_finalize_checks
