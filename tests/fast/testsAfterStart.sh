#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_CONT_NAME"
fast_require_var "TEST_ROUTER_PORT"
fast_require_var "TEST_AGENT_HOST_PORT"
fast_require_var "TEST_AGENT_HEALTH_URL"
fast_require_var "TEST_AGENT_LOG"
fast_require_var "TEST_AGENT_NAME"
fast_require_var "TEST_PERSIST_FILE"
fast_require_var "TEST_AGENT_CONTAINER_PORT"

cd "$TEST_RUN_DIR"

fast_check "Service container is running" fast_assert_container_running "$TEST_AGENT_CONT_NAME"
fast_check "Router port ${TEST_ROUTER_PORT} listening" fast_assert_port_listening "$TEST_ROUTER_PORT"
fast_check "Agent host port ${TEST_AGENT_HOST_PORT} listening" fast_assert_port_listening "$TEST_AGENT_HOST_PORT"
fast_check "Agent port ${TEST_AGENT_HOST_PORT} bound to localhost" fast_assert_port_bound_local "$TEST_AGENT_CONT_NAME" "$TEST_AGENT_CONTAINER_PORT" "$TEST_AGENT_HOST_PORT"
fast_check "Router status endpoint responds" fast_assert_router_status_ok
fast_check "Agent health endpoint reports ok" fast_assert_http_response_contains "$TEST_AGENT_HEALTH_URL" '"ok":true'
fast_check "Container exposes AGENT_NAME" fast_assert_container_env "$TEST_AGENT_CONT_NAME" "AGENT_NAME" "$TEST_AGENT_NAME"
fast_check "Container exposes FAST_TEST_MARKER" fast_assert_container_env "$TEST_AGENT_CONT_NAME" "FAST_TEST_MARKER" "fast-suite"
fast_check "Agent log file created" fast_assert_file_contains "$TEST_AGENT_LOG" "listening"
fast_check "Persisted data file created" fast_assert_file_exists "$TEST_PERSIST_FILE"

fast_stage_header "Ploinky only var test"
export FAST_PLOINKY_ONLY="host-env-value"
fast_check "Host-only env var not visible inside container" fast_assert_container_env_absent "$TEST_AGENT_CONT_NAME" "FAST_PLOINKY_ONLY"

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

FAST_VAR_TEST_NAME="test_var"
FAST_VAR_TEST_VALUE="fast_test_value"

fast_cli_set_var() {
  ploinky var "$FAST_VAR_TEST_NAME" "$FAST_VAR_TEST_VALUE" >/dev/null
  ploinky var "$FAST_VAR_TEST_NAME":"$FAST_VAR_TEST_VALUE" >/dev/null
  ploinky var "$FAST_VAR_TEST_NAME"="$FAST_VAR_TEST_VALUE" >/dev/null
}

fast_cli_vars_contains() {
  local output
  if ! output=$(ploinky vars); then
    echo "Failed to run 'ploinky vars'." >&2
    return 1
  fi
  if ! grep -Fq "${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}" <<<"$output"; then
    echo "vars output missing ${FAST_VAR_TEST_NAME} entry." >&2
    echo "Output:" >&2
    echo "$output" >&2
    return 1
  fi
}

fast_cli_echo_var_matches() {
  local output
  if ! output=$(ploinky echo "$FAST_VAR_TEST_NAME"); then
    echo "Failed to run 'ploinky echo'." >&2
    return 1
  fi
  if [[ "$output" != "${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}" ]]; then
    echo "echo output mismatch: expected '${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}', got '${output}'." >&2
    return 1
  fi
}

fast_cli_expose_and_refresh() {
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "TEST_AGENT_CONT_NAME"
  fast_require_var "FAST_VAR_TEST_NAME"
  fast_require_var "FAST_VAR_TEST_VALUE"
  if ! ploinky expose VAR_SYNTAX_1="val1" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose VAR_SYNTAX_1 for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky expose VAR_SYNTAX_2:"val2" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose VAR_SYNTAX_2 for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky expose "$FAST_VAR_TEST_NAME" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose ${FAST_VAR_TEST_NAME} for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky refresh agent "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to refresh agent ${TEST_AGENT_NAME} after expose." >&2
    return 1
  fi

  fast_wait_for_container "$TEST_AGENT_CONT_NAME" || return 1
  return 0
}

fast_cli_verify_var_in_shell() {
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "FAST_VAR_TEST_NAME"
  fast_require_var "FAST_VAR_TEST_VALUE"
  local output
  if ! output=$( {
    echo "printenv ${FAST_VAR_TEST_NAME}"
    echo "printenv VAR_SYNTAX_1"
    echo "printenv VAR_SYNTAX_2"
    echo "exit"
  } | ploinky shell "$TEST_AGENT_NAME" ); then
    echo "Failed to execute ploinky shell for ${TEST_AGENT_NAME}." >&2
    return 1
  fi
  local cleaned
  cleaned=$(echo "$output" | tr -d '\r')
  if [[ "$cleaned" != *"${FAST_VAR_TEST_VALUE}"* ]]; then
    echo "Exposed variable ${FAST_VAR_TEST_NAME} missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
  if [[ "$cleaned" != *"val1"* ]]; then
    echo "Exposed variable VAR_SYNTAX_1 missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
  if [[ "$cleaned" != *"val2"* ]]; then
    echo "Exposed variable VAR_SYNTAX_2 missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
}
fast_assert_router_static_asset() {
  fast_require_var "TEST_ROUTER_PORT"
  fast_require_var "TEST_STATIC_ASSET_PATH"
  fast_require_var "TEST_STATIC_ASSET_EXPECTED"
  local url="http://127.0.0.1:${TEST_ROUTER_PORT}${TEST_STATIC_ASSET_PATH}"
  local body
  if ! body=$(curl -fsS "$url" 2>/dev/null); then
    echo "Failed to fetch static asset at ${url}." >&2
    return 1
  fi
  if [[ "${body}" != "${TEST_STATIC_ASSET_EXPECTED}" ]]; then
    echo "Static asset content mismatch for ${url}." >&2
    echo "Expected: '${TEST_STATIC_ASSET_EXPECTED}'" >&2
    echo "Got: '${body}'" >&2
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

fast_stage_header "CLI Variable Commands"
fast_check "var sets ${FAST_VAR_TEST_NAME}" fast_cli_set_var
fast_check "vars lists ${FAST_VAR_TEST_NAME}" fast_cli_vars_contains
fast_check "echo returns ${FAST_VAR_TEST_NAME}" fast_cli_echo_var_matches
fast_check "expose applies to ${FAST_VAR_TEST_NAME}" fast_cli_expose_and_refresh
fast_check "Agent sees exposed ${FAST_VAR_TEST_NAME} via shell" fast_cli_verify_var_in_shell

fast_stage_header "Router Static Assets"
fast_check "Router serves configured static asset" fast_assert_router_static_asset

fast_stage_header "Manifest Environment"
fast_check "Variable MY_TEST_VAR from manifest is present after start" fast_assert_container_env "$TEST_AGENT_CONT_NAME" "MY_TEST_VAR" "hello-manifest"

fast_check_install_marker_via_shell() {
  local filename="install_marker.txt"
  # ploinky shell opens in the workspace, so no path is needed for ls.
  if ! { echo "ls -A"; echo "exit"; } | ploinky shell "$TEST_AGENT_NAME" | grep -qF -- "$filename"; then
    echo "File '${filename}' not found in workspace via 'ploinky shell'." >&2
    echo "--- ploinky shell ls output ---" >&2
    { echo "ls -A"; echo "exit"; } | ploinky shell "$TEST_AGENT_NAME" >&2
    echo "---------------------------" >&2
    return 1
  fi
}

fast_check_agent_blob_upload() {
  fast_require_var "TEST_RUN_DIR"
  fast_require_var "TEST_ROUTER_PORT"
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "TEST_AGENT_WORKSPACE"

  local upload_file
  if ! upload_file=$(mktemp -p "$TEST_RUN_DIR" fast-agent-upload.XXXXXX.bin); then
    echo "Failed to allocate temporary upload file." >&2
    return 1
  fi

  if ! dd if=/dev/urandom of="$upload_file" bs=1M count=1 2>/dev/null; then
    echo "Failed to generate random upload payload." >&2
    rm -f "$upload_file"
    return 1
  fi

  local response
  if ! response=$(curl -fsS -X POST --data-binary @"$upload_file" \
      -H 'Content-Type: application/octet-stream' \
      -H 'X-Mime-Type: application/octet-stream' \
      "http://127.0.0.1:${TEST_ROUTER_PORT}/blobs/${TEST_AGENT_NAME}"); then
    echo "curl upload request failed." >&2
    rm -f "$upload_file"
    return 1
  fi

  local blob_id
  blob_id=$(echo "$response" | jq -r '.id // empty')
  if [[ -z "$blob_id" ]]; then
    echo "Upload response missing blob id. Response: $response" >&2
    rm -f "$upload_file"
    return 1
  fi

  local blob_download_url
  local blob_url
  blob_download_url=$(echo "$response" | jq -r '.downloadUrl // empty')
  if [[ -n "$blob_download_url" ]]; then
    if [[ "$blob_download_url" != "http://127.0.0.1:${TEST_ROUTER_PORT}/blobs/${TEST_AGENT_NAME}/"* ]]; then
      echo "Upload downloadUrl unexpected. downloadUrl='$blob_download_url' response='$response'" >&2
      rm -f "$upload_file"
      return 1
    fi
    blob_url="${blob_download_url#http://127.0.0.1:${TEST_ROUTER_PORT}}"
    if [[ -z "$blob_url" || "$blob_url" == "$blob_download_url" ]]; then
      echo "Unable to derive blob path from downloadUrl='$blob_download_url'." >&2
      rm -f "$upload_file"
      return 1
    fi
    if [[ "$blob_url" != "/blobs/${TEST_AGENT_NAME}/"* ]]; then
      echo "Derived blob path unexpected. path='$blob_url' downloadUrl='$blob_download_url'" >&2
      rm -f "$upload_file"
      return 1
    fi
  else
    blob_url=$(echo "$response" | jq -r '.url // empty')
    if [[ -z "$blob_url" || "$blob_url" != "/blobs/${TEST_AGENT_NAME}/"* ]]; then
      echo "Upload response URL unexpected. url='$blob_url' response='$response'" >&2
      rm -f "$upload_file"
      return 1
    fi
    blob_download_url="http://127.0.0.1:${TEST_ROUTER_PORT}${blob_url}"
  fi

  local blob_path="$TEST_AGENT_WORKSPACE/blobs/$blob_id"
  local blob_meta="${blob_path}.json"

  if [[ ! -f "$blob_path" ]]; then
    echo "Uploaded blob file not found at $blob_path" >&2
    rm -f "$upload_file"
    return 1
  fi

  if ! cmp -s "$upload_file" "$blob_path"; then
    echo "Blob contents do not match uploaded payload." >&2
    rm -f "$upload_file"
    return 1
  fi

  if [[ ! -f "$blob_meta" ]]; then
    echo "Blob metadata file missing at $blob_meta" >&2
    rm -f "$upload_file"
    return 1
  fi

  fast_write_state_var "FAST_AGENT_UPLOAD_FILE" "$upload_file"
  fast_write_state_var "FAST_AGENT_BLOB_ID" "$blob_id"
  fast_write_state_var "FAST_AGENT_BLOB_URL" "$blob_url"
  fast_write_state_var "FAST_AGENT_BLOB_DOWNLOAD_URL" "$blob_download_url"
  fast_write_state_var "FAST_AGENT_BLOB_PATH" "$blob_path"
  fast_write_state_var "FAST_AGENT_BLOB_META" "$blob_meta"
}

fast_stage_header "Install Command Verification"
fast_check "Install command creates marker file (verified via shell)" fast_check_install_marker_via_shell

fast_check_agent_blob_download() {
  fast_require_var "TEST_ROUTER_PORT"
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "TEST_AGENT_WORKSPACE"

  fast_load_state

  if [[ -z "${FAST_AGENT_UPLOAD_FILE:-}" || -z "${FAST_AGENT_BLOB_ID:-}" || -z "${FAST_AGENT_BLOB_DOWNLOAD_URL:-}" ]]; then
    echo "Agent blob upload state missing. Did the upload test run?" >&2
    return 1
  fi

  local download_file
  if ! download_file=$(mktemp -p "$TEST_RUN_DIR" fast-agent-download.XXXXXX.bin); then
    echo "Failed to allocate temporary download file." >&2
    return 1
  fi

  if ! curl -fsS -o "$download_file" "$FAST_AGENT_BLOB_DOWNLOAD_URL"; then
    echo "curl download request failed for ${FAST_AGENT_BLOB_DOWNLOAD_URL}." >&2
    rm -f "$download_file"
    return 1
  fi

  if ! cmp -s "$FAST_AGENT_UPLOAD_FILE" "$download_file"; then
    echo "Downloaded blob does not match original payload." >&2
    rm -f "$download_file"
    return 1
  fi

  rm -f "$download_file"
  rm -f "$FAST_AGENT_UPLOAD_FILE"
  rm -f "$FAST_AGENT_BLOB_PATH" "$FAST_AGENT_BLOB_META"
  fast_write_state_var "FAST_AGENT_UPLOAD_FILE" ""
  fast_write_state_var "FAST_AGENT_BLOB_ID" ""
  fast_write_state_var "FAST_AGENT_BLOB_URL" ""
  fast_write_state_var "FAST_AGENT_BLOB_DOWNLOAD_URL" ""
  fast_write_state_var "FAST_AGENT_BLOB_PATH" ""
  fast_write_state_var "FAST_AGENT_BLOB_META" ""
}

fast_stage_header "Agent Blob Upload and Download"
fast_check "Router upload stores blob in agent workspace" fast_check_agent_blob_upload
fast_check "Router download returns uploaded blob" fast_check_agent_blob_download

fast_check_demo_agent_readonly_dirs() {
  local agent_name="demo"

  local raw_output
if ! raw_output=$(cat <<'EOS' | ploinky shell "$agent_name"
check_dir() {
  local path="$1" label="$2"
  local test_file="$path/.fast-readonly-test-$$"
  if [ -d "$path" ]; then
    echo "Exists $label"
  else
    echo "Missing $label"
  fi
  if touch "$test_file" 2>/dev/null; then
    rm -f "$test_file"
    echo "Writable $label"
  else
    echo "ReadOnly $label"
  fi
  rm -f "$test_file" >/dev/null 2>&1
}

check_dir "/node_modules" "node_modules_root"
check_dir "/code" "code_dir"
check_dir "/Agent" "agent_root"
exit
EOS
  ); then
    echo "Failed to execute directory checks in ${agent_name}." >&2
    return 1
  fi

  local parsed_output
  parsed_output=$(echo "$raw_output" | tr -d '\r' | grep -E '^(Exists|Missing|ReadOnly|Writable) ')

  local expected_markers=(
    "Exists node_modules_root"
    "ReadOnly node_modules_root"
    "Exists code_dir"
    "ReadOnly code_dir"
    "Exists agent_root"
    "ReadOnly agent_root"
  )

  local marker
  local missing_markers=()
  for marker in "${expected_markers[@]}"; do
    if ! grep -Fqx -- "$marker" <<<"$parsed_output"; then
      missing_markers+=("$marker")
    fi
  done

  if (( ${#missing_markers[@]} > 0 )); then
    echo "Missing expected directory markers: ${missing_markers[*]}" >&2
    echo "--- Parsed directory markers ---" >&2
    echo "$parsed_output" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi

  local writable
  local writable_markers=(
    "Writable node_modules_root"
    "Writable code_dir"
    "Writable agent_root"
  )

  for writable in "${writable_markers[@]}"; do
    if grep -Fqx -- "$writable" <<<"$parsed_output"; then
      echo "Directory write test unexpectedly succeeded: ${writable#Writable }" >&2
      echo "--- Parsed directory markers ---" >&2
      echo "$parsed_output" >&2
      echo "--- Full shell output ---" >&2
      echo "$raw_output" >&2
      echo "-------------------------" >&2
      return 1
    fi
  done

}

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
  if ! raw_output=$( {
    echo "pwd"
    echo "if [ -r . ] && [ -w . ]; then echo PERM_OK; else echo PERM_FAIL; fi"
    echo "exit"
  } | ploinky shell "$TEST_DEVEL_AGENT_NAME" ); then
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

  local perm_status
  perm_status=$(echo "$raw_output" | tr -d '\r' | sed -n 's/^# \(PERM_[A-Z0-9]\+\)$/\1/p' | tail -n 1)
  if [[ "$perm_status" != "PERM_OK" ]]; then
    echo "Devel agent workspace lacks read/write permissions." >&2
    echo "Expected PERM_OK marker but saw: '${perm_status}'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi
}

fast_stage_header "Demo Agent Filesystem"
fast_check "Demo agent directories exist and are read-only" fast_check_demo_agent_readonly_dirs

fast_stage_header "Global Agent Verification"
fast_check "Global agent working directory is the test root" fast_check_global_agent_workdir

fast_stage_header "Devel Agent Verification"
fast_check "Devel agent cwd is the repo source and has RW permissions" fast_check_devel_agent_workdir

fast_finalize_checks
