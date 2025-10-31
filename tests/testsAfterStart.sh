#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"
source "$TESTS_DIR/test-functions/workspace_status_command.sh"
source "$TESTS_DIR/test-functions/demo_agent_dependency_tests.sh"
source "$TESTS_DIR/test-functions/mcp_tests.sh"
source "$TESTS_DIR/test-functions/routingserver_aggregation_test.sh"
source "$TESTS_DIR/test-functions/cli_variable_commands.sh"
source "$TESTS_DIR/test-functions/router_static_assets.sh"
source "$TESTS_DIR/test-functions/router_var_check.sh"
source "$TESTS_DIR/test-functions/check_preinstall_run.sh"
source "$TESTS_DIR/test-functions/install_command_verification.sh"
source "$TESTS_DIR/test-functions/agent_blob_upload_and_download.sh"
source "$TESTS_DIR/test-functions/demo_agent_dir_perm.sh"
source "$TESTS_DIR/test-functions/global_agent_verification.sh"
source "$TESTS_DIR/test-functions/devel_agent_verification.sh"
source "$TESTS_DIR/test-functions/watchdog_restart_services.sh"
source "$TESTS_DIR/test-functions/webchat_rotate_token.sh"
source "$TESTS_DIR/test-functions/test_sso_params.sh"
source "$TESTS_DIR/test-functions/webtty_command.sh"
source "$TESTS_DIR/test-functions/default_cli_tests.sh"
source "$TESTS_DIR/test-functions/logs_commands.sh"
source "$TESTS_DIR/test-functions/disable_repo_test.sh"

load_state
require_var "TEST_RUN_DIR"
require_var "TEST_AGENT_CONT_NAME"
require_var "TEST_ROUTER_PORT"
require_var "TEST_AGENT_HOST_PORT"
require_var "TEST_AGENT_HEALTH_URL"
require_var "TEST_AGENT_LOG"
require_var "TEST_AGENT_NAME"
require_var "TEST_PERSIST_FILE"
require_var "TEST_AGENT_CONTAINER_PORT"
require_var "TEST_AGENT_DEP_GLOBAL_NAME"
require_var "TEST_AGENT_DEP_DEVEL_NAME"

cd "$TEST_RUN_DIR"

test_check "Service container is running" assert_container_running "$TEST_AGENT_CONT_NAME"
test_check "Router port ${TEST_ROUTER_PORT} listening" assert_port_listening "$TEST_ROUTER_PORT"
test_check "Agent host port ${TEST_AGENT_HOST_PORT} listening" assert_port_listening "$TEST_AGENT_HOST_PORT"
test_check "Agent port ${TEST_AGENT_HOST_PORT} bound to localhost" assert_port_bound_local "$TEST_AGENT_CONT_NAME" "$TEST_AGENT_CONTAINER_PORT" "$TEST_AGENT_HOST_PORT"
test_check "Router status endpoint responds" assert_router_status_ok
test_check "Agent health endpoint reports ok" assert_http_response_contains "$TEST_AGENT_HEALTH_URL" '"ok":true'
test_check "Container exposes AGENT_NAME" assert_container_env "$TEST_AGENT_CONT_NAME" "AGENT_NAME" "$TEST_AGENT_NAME"
test_check "Container exposes FAST_TEST_MARKER" assert_container_env "$TEST_AGENT_CONT_NAME" "FAST_TEST_MARKER" "fast-suite"
test_check "Agent log file created" assert_file_contains "$TEST_AGENT_LOG" "listening"
test_check "Persisted data file created" assert_file_exists "$TEST_PERSIST_FILE"

stage_header "Watchdog restart services"
test_check "Watchdog restarts router and agent container" watchdog_restart_services

stage_header "Ploinky only var test"
export FAST_PLOINKY_ONLY="host-env-value"
test_check "Host-only env var not visible inside container" assert_container_env_absent "$TEST_AGENT_CONT_NAME" "FAST_PLOINKY_ONLY"

stage_header "Router var change"
test_check "Router reflects updated testVar without restart" fast_router_verify_test_var_dynamic

stage_header "Workspace status command"
test_check "Status reports SSO disabled" fast_assert_status_contains "- SSO: disabled"
test_check "Status reports router listening" fast_assert_status_contains "- Router: listening"
test_check "Status lists repos section" fast_assert_status_contains "- Repos:"
test_check "Status lists demo repo" fast_assert_status_contains "  - demo"
test_check "Status lists testRepo repo" fast_assert_status_contains "  - testRepo"
test_check "Status lists active containers for demo" fast_assert_status_contains "agent: demo"
test_check "Status lists active containers for testAgent" fast_assert_status_contains "agent: testAgent"

stage_header "Demo agent dependency tests"
SIMULATOR_CONTAINER=$(compute_container_name "simulator" "demo")
MODERATOR_CONTAINER=$(compute_container_name "moderator" "webmeet")
test_check "Simulator container is running" assert_container_running "$SIMULATOR_CONTAINER"
test_check "Moderator container is running" assert_container_running "$MODERATOR_CONTAINER"
test_check "Moderator server responds to GET" fast_check_moderator_get
test_check "Verify repo 'webmeet' is cloned" assert_dir_exists ".ploinky/repos/webmeet"
test_check "Verify repo 'vibe1' is cloned" assert_dir_exists ".ploinky/repos/vibe1"

stage_header "Check preinstall runs"
test_check "Explorer preinstall command executed" check_preinstall_run

stage_header  "MCP tests"
test_check "Status check: client status simulator" fast_mcp_client_status
test_check "Tool check: client list tools" fast_mcp_list_tools
test_check "Tool run check: client tool run_simulation -iterations 10" fast_mcp_run_simulation

stage_header "RoutingServer aggregation test"
test_check "Aggregation check: router server mcp aggregation" fast_mcp_list_tools_after_demo

stage_header "CLI Variable Commands"
test_check "var sets ${FAST_VAR_TEST_NAME}" fast_cli_set_var
test_check "vars lists ${FAST_VAR_TEST_NAME}" fast_cli_vars_contains
test_check "echo returns ${FAST_VAR_TEST_NAME}" fast_cli_echo_var_matches
test_check "expose applies to ${FAST_VAR_TEST_NAME}" fast_cli_expose_and_refresh
test_check "Agent sees exposed ${FAST_VAR_TEST_NAME} via shell" fast_cli_verify_var_in_shell

stage_header "WebChat Command"
test_check "webchat --rotate regenerates token" fast_check_webchat_token_rotation

stage_header "WebChat SSO Parameters"
test_action "Configure WebChat CLI for test agent" configure_webchat_cli_for_test_agent
wait_for_router
test_check "WebChat CLI session logs guest SSO args" test_sso_params_disabled
#test_check "WebChat CLI session logs SSO identity when enabled" test_sso_params_enabled

stage_header "Router Static Assets"
test_check "Router serves configured static asset" fast_assert_router_static_asset

stage_header "Manifest Environment"
test_check "Variable MY_TEST_VAR from manifest is present after start" assert_container_env "$TEST_AGENT_CONT_NAME" "MY_TEST_VAR" "hello-manifest"

stage_header "Install Command Verification"
test_check "Install command creates marker file (verified via shell)" fast_check_install_marker_via_shell

stage_header "Agent Blob Upload and Download"
test_check "Router upload stores blob in agent workspace" fast_check_agent_blob_upload
test_check "Router download returns uploaded blob" fast_check_agent_blob_download

stage_header "Demo Agent Filesystem"
test_check "Demo agent directories exist and are read-only" fast_check_demo_agent_readonly_dirs

stage_header "Global Agent Verification"
test_check "Global agent working directory is the test root" fast_assert_global_agent_workdir "TEST_GLOBAL_AGENT_NAME"
test_check "Manifest dependency global agent uses workspace root" fast_assert_global_agent_workdir "TEST_AGENT_DEP_GLOBAL_NAME"

stage_header "Devel Agent Verification"
test_check "Devel agent cwd is the repo source and has RW permissions" fast_assert_devel_agent_workdir "TEST_DEVEL_AGENT_NAME"
test_check "Manifest dependency devel agent uses repo root" fast_assert_devel_agent_workdir "TEST_AGENT_DEP_DEVEL_NAME"

stage_header "WebTTY Command"
test_action "Configure WebTTY shell to mock script" configure_mock_webtty_shell
test_check "webtty command records mock shell configuration" test_webtty_shell

stage_header "Default CLI Fallback"
#test_action "Capture default CLI help output" run_default_cli_help
#test_check "Default CLI help banner is shown" default_cli_help_has_banner

stage_header "Disable Repo Command"
test_check "disable repo removes demo entry" test_disable_repo_demo_updates_enabled_list

stage_header "Logs Commands"
test_check "logs tail router streams entries" test_logs_tail_router
test_check "logs last prints five lines" test_logs_last_five

finalize_checks
