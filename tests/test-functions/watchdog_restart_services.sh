watchdog_restart_services() {
  load_state
  require_var "TEST_AGENT_CONT_NAME" || return 1
  require_var "TEST_ROUTER_PORT" || return 1

  require_runtime || return 1

  if ! assert_container_running "$TEST_AGENT_CONT_NAME"; then
    echo "Container '${TEST_AGENT_CONT_NAME}' is not running before watchdog test." >&2
    return 1
  fi

  local original_container_pid
  original_container_pid=$(get_container_pid "$TEST_AGENT_CONT_NAME" 2>/dev/null || true)

  local router_pid
  router_pid=$(lsof -nP -t -iTCP:"$TEST_ROUTER_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1)

  if [[ -z "$router_pid" ]]; then
    echo "Unable to determine RoutingServer PID for port ${TEST_ROUTER_PORT}." >&2
    return 1
  fi

  test_info "Sending SIGKILL to RoutingServer (PID: ${router_pid})."

  if ! kill -9 "$router_pid" 2>/dev/null; then
    echo "Failed to send SIGKILL to RoutingServer PID ${router_pid}." >&2
    return 1
  fi

  test_info "Sending SIGKILL to agent container ${TEST_AGENT_CONT_NAME}."
  if ! $FAST_CONTAINER_RUNTIME kill --signal SIGKILL "$TEST_AGENT_CONT_NAME" >/dev/null 2>&1; then
    echo "Failed to send SIGKILL to container '${TEST_AGENT_CONT_NAME}'." >&2
    return 1
  fi

  sleep 3
  test_info "Waiting for watchdog to restore services."

  local new_router_pid
  new_router_pid=$(lsof -nP -t -iTCP:"$TEST_ROUTER_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1)
  if [[ -z "$new_router_pid" ]]; then
    echo "Unable to determine RoutingServer PID after watchdog restart." >&2
    return 1
  fi

  if [[ "$new_router_pid" == "$router_pid" ]]; then
    echo "RoutingServer PID did not change after watchdog restart." >&2
    return 1
  fi

  if ! wait_for_container "$TEST_AGENT_CONT_NAME"; then
    echo "Watchdog did not restart container '${TEST_AGENT_CONT_NAME}' within expected time." >&2
    return 1
  fi

  if ! assert_container_running "$TEST_AGENT_CONT_NAME"; then
    echo "Container '${TEST_AGENT_CONT_NAME}' not running after watchdog restart." >&2
    return 1
  fi

  local restarted_pid
  restarted_pid=$(get_container_pid "$TEST_AGENT_CONT_NAME" 2>/dev/null || true)

  if [[ -z "$restarted_pid" || "$restarted_pid" == "0" ]]; then
    echo "Container PID not reported after watchdog restart." >&2
    return 1
  fi

  if [[ -n "$original_container_pid" && "$original_container_pid" != "0" && "$original_container_pid" == "$restarted_pid" ]]; then
    echo "Container PID did not change after watchdog restart." >&2
    return 1
  fi

  if ! assert_router_status_ok; then
    echo "Router status check failed after watchdog restart." >&2
    return 1
  fi

  return 0
}
