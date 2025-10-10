#!/bin/bash
set -uo pipefail

SMOKE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SMOKE_DIR/../.." && pwd)
source "$SMOKE_DIR/harness.sh"
source "$SMOKE_DIR/common.sh"
source "$ROOT_DIR/tests/cli/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-start-stop-start-XXXXXX)
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

SMOKE_PORT=8081

test_enable_demo_repository() {
  smoke_expect_success "enable repo demo" ploinky enable repo demo || return 1
}

test_client_status_pre_stop() {
  if ! ploinky client status demo | grep -q "ok=true"; then
    smoke_fail "Client status did not report ok=true before stop"
    return 1
  fi
}

test_shell_pre_stop() {
  local shell_out
  shell_out=$(ploinky shell demo <<'EOF'
whoami
exit
EOF
  ) || {
    smoke_fail "'ploinky shell demo' failed before stop"
    return 1
  }
  smoke_assert_contains "$shell_out" "root" "Shell session did not report 'root' before stop"
}

test_cli_pre_stop() {
  local expected_path="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_cli_pwd_contains "$expected_path" || return 1
}

test_workspace_down_after_stop() {
  smoke_assert_container_stopped "ploinky_agent_demo" || return 1
  smoke_assert_router_not_running || return 1
  if curl -fsS "http://127.0.0.1:${SMOKE_PORT}/status" >/dev/null 2>&1; then
    smoke_fail "Router status endpoint still reachable after stop"
    return 1
  fi
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

test_cli_after_restart() {
  local expected_path="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_cli_pwd_contains "$expected_path" || return 1
}

test_container_mounts_pre_stop() {
  local host_workspace="${TEST_WORKSPACE_DIR}/demo"
  smoke_assert_container_path_readonly "/code" || return 1
  smoke_assert_container_path_readonly "/node_modules" || return 1
  smoke_assert_container_path_readonly "/Agent" || return 1
  smoke_assert_container_path_writable "$host_workspace" || return 1
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

smoke_init_suite "Start → Stop → Start Sequence"

smoke_run_test "Repository setup" "Enable the demo repository once at the beginning." test_enable_demo_repository

echo ">>> Starting workspace on port ${SMOKE_PORT}"
smoke_expect_success "start workspace" ploinky start demo "$SMOKE_PORT" || exit 1
smoke_wait_for_router "$SMOKE_PORT" || exit 1
smoke_assert_container_running "ploinky_agent_demo" || exit 1

smoke_run_test "Client status before stop" "Verify status endpoint before stopping." test_client_status_pre_stop
smoke_run_test "Shell access before stop" "Ensure shell access works before stop." test_shell_pre_stop
smoke_run_test "CLI workspace before stop" "Check CLI working directory before stop." test_cli_pre_stop
smoke_run_test "Container mounts before stop" "Validate read-only code mounts and writable workspace." test_container_mounts_pre_stop

echo ">>> Stopping workspace"
smoke_expect_success "ploinky stop" ploinky stop || exit 1
sleep 2
smoke_run_test "Workspace down" "Confirm containers and router are stopped." test_workspace_down_after_stop

echo ">>> Restarting workspace using saved configuration"
smoke_expect_success "restart workspace" ploinky start || exit 1
smoke_wait_for_router "$SMOKE_PORT" || exit 1
smoke_assert_container_running "ploinky_agent_demo" || exit 1

smoke_run_test "Client status after restart" "Verify status endpoint after restart." test_client_status_after_restart
smoke_run_test "Router logs after restart" "Ensure logs capture requests after restart." test_logs_after_restart
smoke_run_test "CLI workspace after restart" "Check CLI working directory after restart." test_cli_after_restart
smoke_run_test "Container mounts after restart" "Verify mount configuration persists after restart." test_container_mounts_after_restart

echo ">>> Final teardown"
smoke_expect_success "ploinky destroy" ploinky destroy || exit 1
sleep 2
smoke_assert_container_stopped "ploinky_agent_demo" || exit 1
smoke_assert_router_not_running || exit 1

suite_status=0
smoke_summary || suite_status=$?
exit $suite_status
