#!/bin/bash
set -uo pipefail

SMOKE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SMOKE_DIR/../.." && pwd)
source "$SMOKE_DIR/harness.sh"
source "$SMOKE_DIR/common.sh"
source "$ROOT_DIR/tests/cli/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-start-restart-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"

if command -v podman >/dev/null 2>&1; then
  export SMOKE_CONTAINER_RUNTIME="podman"
elif command -v docker >/dev/null 2>&1; then
  export SMOKE_CONTAINER_RUNTIME="docker"
else
  echo "Neither docker nor podman found in PATH." >&2
  exit 1
fi

SMOKE_PORT=8080
SMOKE_VAR_NAME="smoke_restart_var"
SMOKE_VAR_VALUE="restart_sequence"
SMOKE_ENV_NAME="SMOKE_RESTART_SECRET"
SMOKE_ENV_VALUE="restart_secret"

test_enable_demo_repository() {
  smoke_expect_success "enable repo demo" ploinky enable repo demo || return 1
  local listing
  listing=$(ploinky list repos) || {
    smoke_fail "'ploinky list repos' failed"
    return 1
  }
  smoke_assert_contains "$listing" "demo" "'demo' repo not listed after enabling"
}

test_repo_listing_pre_restart() {
  local listing
  listing=$(ploinky list repos) || {
    smoke_fail "'ploinky list repos' failed"
    return 1
  }
  smoke_assert_contains "$listing" "webmeet" "'webmeet' repo not listed after start"
}

test_agent_listing_pre_restart() {
  local agents
  agents=$(ploinky list agents) || {
    smoke_fail "'ploinky list agents' failed"
    return 1
  }
  for agent in demo simulator moderator; do
    smoke_assert_contains "$agents" "$agent" "'$agent' agent missing from listing"
  done
}

test_cli_workspace_pre_restart() {
  local expected_path="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_cli_pwd_contains "$expected_path" || return 1
}

test_variables_pre_restart() {
  smoke_expect_success "set ${SMOKE_VAR_NAME}" ploinky var "$SMOKE_VAR_NAME" "$SMOKE_VAR_VALUE" || return 1
  local var_ref="\$${SMOKE_VAR_NAME}"
  if ! ploinky echo "$var_ref" | tail -n 1 | grep -q "$SMOKE_VAR_VALUE"; then
    smoke_fail "Variable ${SMOKE_VAR_NAME} not available via 'ploinky echo'"
    return 1
  fi
  smoke_expect_success "expose ${SMOKE_ENV_NAME}" ploinky expose "$SMOKE_ENV_NAME" "$SMOKE_ENV_VALUE" demo || return 1
  if ! printf 'printenv %s\nexit\n' "$SMOKE_ENV_NAME" | ploinky shell demo | grep -q "$SMOKE_ENV_VALUE"; then
    smoke_fail "Exposed ${SMOKE_ENV_NAME} not visible in container"
    return 1
  fi
  return 0
}

test_container_mounts_pre_restart() {
  local host_workspace="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_container_path_readonly "/code" || return 1
  smoke_assert_container_path_readonly "/node_modules" || return 1
  smoke_assert_container_path_readonly "/Agent" || return 1
  smoke_assert_container_path_writable "$host_workspace" || return 1
  return 0
}

test_client_status_after_restart() {
  if ! ploinky client status demo | grep -q "ok=true"; then
    smoke_fail "Client status did not report ok=true after restart"
    return 1
  fi
}

test_logs_after_restart() {
  local log_output
  log_output=$(ploinky logs last 5) || {
    smoke_fail "'ploinky logs last 5' failed"
    return 1
  }
  smoke_assert_contains "$log_output" "\"type\":\"http_request\"" "Router log missing http_request entry after restart"
}

test_cli_workspace_after_restart() {
  local expected_path="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_cli_pwd_contains "$expected_path" || return 1
}

test_variables_after_restart() {
  local var_ref="\$${SMOKE_VAR_NAME}"
  if ! ploinky echo "$var_ref" | tail -n 1 | grep -q "$SMOKE_VAR_VALUE"; then
    smoke_fail "Variable ${SMOKE_VAR_NAME} not available via 'ploinky echo' after restart"
    return 1
  fi
  if ! printf 'printenv %s\nexit\n' "$SMOKE_ENV_NAME" | ploinky shell demo | grep -q "$SMOKE_ENV_VALUE"; then
    smoke_fail "Exposed ${SMOKE_ENV_NAME} not visible after restart"
    return 1
  fi
  return 0
}

test_container_mounts_after_restart() {
  local host_workspace="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_container_path_readonly "/code" || return 1
  smoke_assert_container_path_readonly "/node_modules" || return 1
  smoke_assert_container_path_readonly "/Agent" || return 1
  smoke_assert_container_path_writable "$host_workspace" || return 1
  return 0
}

smoke_init_suite "Start & Restart Sequence"

smoke_run_test "Enable demo repository" "Configure the demo repository once at the beginning." test_enable_demo_repository

echo ">>> Starting workspace on port ${SMOKE_PORT}"
smoke_expect_success "start workspace" ploinky start demo "$SMOKE_PORT" || exit 1
smoke_wait_for_router "$SMOKE_PORT" || exit 1
smoke_assert_container_running "ploinky_agent_demo" || exit 1
smoke_assert_container_running "ploinky_agent_simulator" || exit 1
smoke_assert_container_running "ploinky_agent_moderator" || exit 1

smoke_run_test "Repo listing before restart" "Verify repositories before restart." test_repo_listing_pre_restart
smoke_run_test "Agent listing before restart" "Confirm agents before restart." test_agent_listing_pre_restart
smoke_run_test "CLI workspace path before restart" "Ensure CLI sessions report the workspace directory." test_cli_workspace_pre_restart
smoke_run_test "Container mounts before restart" "Validate read-only code mounts and writable workspace." test_container_mounts_pre_restart
smoke_run_test "Variables & expose before restart" "Validate variables and exposed secrets prior to restart." test_variables_pre_restart

echo ">>> Restarting workspace"
smoke_expect_success "restart workspace" ploinky restart || exit 1
smoke_wait_for_router "$SMOKE_PORT" || exit 1
smoke_assert_container_running "ploinky_agent_demo" || exit 1

smoke_run_test "Client status after restart" "Confirm status API responds after restart." test_client_status_after_restart
smoke_run_test "Router logs after restart" "Ensure logs capture requests post-restart." test_logs_after_restart
smoke_run_test "CLI workspace path after restart" "Check CLI sessions after restart." test_cli_workspace_after_restart
smoke_run_test "Container mounts after restart" "Verify mount configuration persists after restart." test_container_mounts_after_restart
smoke_run_test "Variables after restart" "Verify variables and exposed secrets persist." test_variables_after_restart

echo ">>> Tearing down workspace"
smoke_expect_success "destroy workspace" ploinky destroy || exit 1
sleep 2
smoke_assert_container_stopped "ploinky_agent_demo" || exit 1
smoke_assert_router_not_running || exit 1

suite_status=0
smoke_summary || suite_status=$?
exit $suite_status
