watchdog_restart_services() {
  load_state
  require_var "TEST_AGENT_CONT_NAME" || return 1
  require_var "TEST_ROUTER_PORT" || return 1

  require_runtime || return 1

  if ! assert_container_running "$TEST_AGENT_CONT_NAME"; then
    echo "Container '${TEST_AGENT_CONT_NAME}' is not running before watchdog test." >&2
    return 1
  fi
  test_info "GETTING CONTAIENR PID"

  local original_container_pid
  original_container_pid=$(get_container_pid "$TEST_AGENT_CONT_NAME" 2>/dev/null || true)

  test_info "GETTING ROUTER PID"

  local router_pid
  router_pid=$(lsof -t -i :"$TEST_ROUTER_PORT" 2>/dev/null | head -n 1)

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

  local router_stopped=0
  local attempt
  for attempt in {1..50}; do
    if ! kill -0 "$router_pid" 2>/dev/null; then
      router_stopped=1
      break
    fi
    sleep 0.1
  done
  if [[ $router_stopped -ne 1 ]]; then
    echo "RoutingServer process still running after SIGKILL." >&2
    return 1
  fi
  test_info "RoutingServer has stopped."

  if ! wait_for_container_stop "$TEST_AGENT_CONT_NAME"; then
    echo "Container '${TEST_AGENT_CONT_NAME}' did not stop after SIGKILL." >&2
    return 1
  fi
  test_info "Agent container has stopped."

  sleep 5
  test_info "Waiting for watchdog to restore services."

  if ! wait_for_router; then
    echo "Watchdog did not restart router within expected time." >&2
    return 1
  fi

  if ! assert_router_status_ok; then
    echo "Router status check failed after watchdog restart." >&2
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

  if ! assert_port_listening "$TEST_ROUTER_PORT"; then
    echo "Router port ${TEST_ROUTER_PORT} not listening after watchdog restart." >&2
    return 1
  fi

  return 0
}
