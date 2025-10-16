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
fast_require_var "TEST_AGENT_CONTAINER_PORT"

cd "$TEST_RUN_DIR"

fast_check "Service container is running" fast_assert_container_running "$TEST_SERVICE_CONTAINER"
fast_check "Router port ${TEST_ROUTER_PORT} listening" fast_assert_port_listening "$TEST_ROUTER_PORT"
fast_check "Agent host port ${TEST_AGENT_HOST_PORT} listening" fast_assert_port_listening "$TEST_AGENT_HOST_PORT"
fast_check "Agent port ${TEST_AGENT_HOST_PORT} bound to localhost" fast_assert_port_bound_local "$TEST_SERVICE_CONTAINER" "$TEST_AGENT_CONTAINER_PORT" "$TEST_AGENT_HOST_PORT"
fast_check "Router status endpoint responds" fast_assert_router_status_ok
fast_check "Agent health endpoint reports ok" fast_assert_http_response_contains "$TEST_AGENT_HEALTH_URL" '"ok":true'
fast_check "Container exposes AGENT_NAME" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "AGENT_NAME" "$TEST_AGENT_NAME"
fast_check "Container exposes FAST_TEST_MARKER" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "FAST_TEST_MARKER" "fast-suite"
fast_check "Agent log file created" fast_assert_file_contains "$TEST_AGENT_LOG" "listening"
fast_check "Persisted data file created" fast_assert_file_exists "$TEST_PERSIST_FILE"

fast_stage_header "Ploinky only var test"
export FAST_PLOINKY_ONLY="host-env-value"
fast_check "Host-only env var not visible inside container" fast_assert_container_env_absent "$TEST_SERVICE_CONTAINER" "FAST_PLOINKY_ONLY"

FAST_STATUS_OUTPUT=""

fast_collect_status_output() {
  if [[ -z "$FAST_STATUS_OUTPUT" ]]; then
    FAST_STATUS_OUTPUT=$(ploinky status 2>&1)
    fast_info "--- ploinky status output ---"
    fast_info "$FAST_STATUS_OUTPUT"
    fast_info "--------------------------------"
  fi
}

fast_assert_status_contains() {
  local needle="$1"
  fast_collect_status_output
  if ! grep -Fq -- "$needle" <<<"$FAST_STATUS_OUTPUT"; then
    echo "Status output missing expected text: $needle" >&2
    return 1
  fi
}

fast_stage_header "Workspace status command"
fast_check "Status reports SSO disabled" fast_assert_status_contains "- SSO: disabled"
fast_check "Status reports router listening" fast_assert_status_contains "- Router: listening"
fast_check "Status lists testRepo" fast_assert_status_contains "[Repo] testRepo"
fast_check "Status lists testAgent manifest" fast_assert_status_contains "- testAgent:"
fast_check "Status lists demo manifest" fast_assert_status_contains "- demo:"
fast_check "Status lists active containers for demo" fast_assert_status_contains "agent: demo"
fast_check "Status lists active containers for testAgent" fast_assert_status_contains "agent: testAgent"

#MCP
fast_mcp_client_status() {
  local output
  output=$(ploinky client status simulator 2>&1)
  if ! echo "$output" | grep -q 'ok=true'; then
    echo "Output from 'ploinky client status simulator' did not include 'ok=true'." >&2
    echo "Output:" >&2
    echo "$output" >&2
    return 1
  fi
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
  local output
  output=$(ploinky client tool run_simulation -iterations 10)
   if ! echo "$output" | jq -e '.content[0].text | fromjson | .ok == true' >/dev/null; then
     echo "run_simulation did not return ok:true. Output: $output" >&2
     return 1
   fi
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
fast_check_moderator_get() {
  local routing_file=".ploinky/routing.json"
  local moderator_port
  if ! moderator_port=$(node -e "
    const fs = require('fs');
    try {
      const raw = fs.readFileSync('$routing_file', 'utf8');
      const data = JSON.parse(raw || '{}');
      const port = (data.routes || {}).moderator?.hostPort;
      if (!port) throw new Error('moderator port not found in $routing_file');
      process.stdout.write(String(port));
    } catch (e) {
      process.stderr.write(e.message);
      process.exit(1);
    }
  "); then
    echo "Failed to get moderator port: $moderator_port" >&2
    return 1
  fi

  # Use curl to send a GET request. -f fails on HTTP errors. -S shows errors, -v is verbose.
  curl -f -S -v -X GET "http://127.0.0.1:${moderator_port}/"
}

fast_stage_header "Demo agent dependency tests"
SIMULATOR_CONTAINER=$(compute_container_name "simulator")
MODERATOR_CONTAINER=$(compute_container_name "moderator")
fast_check "Simulator container is running" fast_assert_container_running "$SIMULATOR_CONTAINER"
fast_check "Moderator container is running" fast_assert_container_running "$MODERATOR_CONTAINER"
fast_check "Moderator server responds to GET" fast_check_moderator_get
fast_check "Verify repo 'webmeet' is cloned" fast_assert_dir_exists ".ploinky/repos/webmeet"
fast_check "Verify repo 'vibe1' is cloned" fast_assert_dir_exists ".ploinky/repos/vibe1"

fast_stage_header  "MCP tests"
fast_check "Status check: client status simulator" fast_mcp_client_status
fast_check "Tool check: client list tools" fast_mcp_list_tools
fast_check "Tool run check: client tool run_simulation -iterations 10" fast_mcp_run_simulation

fast_stage_header "RoutingServer aggregation test"
fast_check "Aggregation check: router server mcp aggregation" fast_mcp_list_tools_after_demo

fast_stage_header "Manifest Environment"
fast_check "Variable MY_TEST_VAR from manifest is present after start" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "MY_TEST_VAR" "hello-manifest"

fast_check_install_marker_via_shell() {
  local filename="install_marker.txt"
  # ploinky shell opens in the workspace, so no path is needed for ls.
  if ! { echo "ls -A"; echo "exit"; } | ploinky shell testAgent | grep -qF -- "$filename"; then
    echo "File '${filename}' not found in workspace via 'ploinky shell'." >&2
    echo "--- ploinky shell ls output ---" >&2
    { echo "ls -A"; echo "exit"; } | ploinky shell testAgent >&2
    echo "---------------------------" >&2
    return 1
  fi
}

fast_stage_header "Install Command Verification"
fast_check "Install command creates marker file (verified via shell)" fast_check_install_marker_via_shell

fast_check_global_agent_workdir() {
  fast_require_var "TEST_RUN_DIR"
  fast_require_var "TEST_GLOBAL_AGENT_NAME"
  
  # Global agents mount the entire workspace root in global mode.
  local expected_dir="$TEST_RUN_DIR"

  local raw_output
  if ! raw_output=$( { echo "pwd"; echo "exit"; } | ploinky shell "$TEST_GLOBAL_AGENT_NAME" ); then
      echo "Failed to execute 'pwd' in ${TEST_GLOBAL_AGENT_NAME} shell." >&2
      return 1
  fi

        # Use sed to extract the path, and tr to remove any trailing carriage returns.
  local actual_dir
  actual_dir=$(echo "$raw_output" | sed -n 's/^# \(\/.*\)/\1/p' | tr -d '\r')
  if [[ "$actual_dir" != "$expected_dir" ]]; then
    echo "Global agent working directory mismatch." >&2
    echo "Expected: '$expected_dir'" >&2
    echo "Got: '$actual_dir'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi
}

fast_check_devel_agent_workdir() {
  fast_require_var "TEST_RUN_DIR"
  fast_require_var "TEST_DEVEL_AGENT_NAME"
  fast_require_var "TEST_REPO_NAME"

  # For devel agents, the workspace is the source repo directory.
  local expected_dir="$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME"

  local raw_output
  if ! raw_output=$( { echo "pwd"; echo "exit"; } | ploinky shell "$TEST_DEVEL_AGENT_NAME" ); then
      echo "Failed to execute 'pwd' in ${TEST_DEVEL_AGENT_NAME} shell." >&2
      return 1
  fi

  # Use sed to extract the path, and tr to remove any trailing carriage returns.
  local actual_dir
  actual_dir=$(echo "$raw_output" | sed -n 's/^# \(\/.*\)/\1/p' | tr -d '\r')
  if [[ "$actual_dir" != "$expected_dir" ]]; then
    echo "Devel agent working directory mismatch." >&2
    echo "Expected: '$expected_dir'" >&2
    echo "Got: '$actual_dir'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi
}

fast_stage_header "Global Agent Verification"
fast_check "Global agent working directory is the test root" fast_check_global_agent_workdir

fast_stage_header "Devel Agent Verification"
fast_check "Devel agent working directory is the repo source" fast_check_devel_agent_workdir

fast_finalize_checks
