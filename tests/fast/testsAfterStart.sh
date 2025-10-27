#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"
source "$FAST_DIR/test-functions/workspace_status_command.sh"
source "$FAST_DIR/test-functions/demo_agent_dependency_tests.sh"
source "$FAST_DIR/test-functions/mcp_tests.sh"
source "$FAST_DIR/test-functions/routingserver_aggregation_test.sh"
source "$FAST_DIR/test-functions/cli_variable_commands.sh"
source "$FAST_DIR/test-functions/router_static_assets.sh"
source "$FAST_DIR/test-functions/install_command_verification.sh"
source "$FAST_DIR/test-functions/agent_blob_upload_and_download.sh"
source "$FAST_DIR/test-functions/demo_agent_dir_perm.sh"
source "$FAST_DIR/test-functions/global_agent_verification.sh"
source "$FAST_DIR/test-functions/devel_agent_verification.sh"

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
fast_require_var "TEST_AGENT_DEP_GLOBAL_NAME"
fast_require_var "TEST_AGENT_DEP_DEVEL_NAME"

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

fast_stage_header "Workspace status command"
fast_check "Status reports SSO disabled" fast_assert_status_contains "- SSO: disabled"
fast_check "Status reports router listening" fast_assert_status_contains "- Router: listening"
fast_check "Status lists repos section" fast_assert_status_contains "- Repos:"
fast_check "Status lists demo repo" fast_assert_status_contains "  - demo"
fast_check "Status lists testRepo repo" fast_assert_status_contains "  - testRepo"
fast_check "Status lists active containers for demo" fast_assert_status_contains "agent: demo"
fast_check "Status lists active containers for testAgent" fast_assert_status_contains "agent: testAgent"

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

fast_stage_header "Install Command Verification"
fast_check "Install command creates marker file (verified via shell)" fast_check_install_marker_via_shell

fast_stage_header "Agent Blob Upload and Download"
fast_check "Router upload stores blob in agent workspace" fast_check_agent_blob_upload
fast_check "Router download returns uploaded blob" fast_check_agent_blob_download

fast_stage_header "Demo Agent Filesystem"
fast_check "Demo agent directories exist and are read-only" fast_check_demo_agent_readonly_dirs

fast_stage_header "Global Agent Verification"
fast_check "Global agent working directory is the test root" fast_assert_global_agent_workdir "TEST_GLOBAL_AGENT_NAME"
fast_check "Manifest dependency global agent uses workspace root" fast_assert_global_agent_workdir "TEST_AGENT_DEP_GLOBAL_NAME"

fast_stage_header "Devel Agent Verification"
fast_check "Devel agent cwd is the repo source and has RW permissions" fast_assert_devel_agent_workdir "TEST_DEVEL_AGENT_NAME"
fast_check "Manifest dependency devel agent uses repo root" fast_assert_devel_agent_workdir "TEST_AGENT_DEP_DEVEL_NAME"

fast_finalize_checks
