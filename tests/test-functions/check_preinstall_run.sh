check_preinstall_run() {
  load_state
  require_var "TEST_START_LOG"
  require_runtime

  local log_path="$TEST_START_LOG"

  # Primary check: look for lifecycle hook log entries in the start log.
  # The [install] explorer: entry appears when the container is first created
  # during `ploinky start`. However, the watchdog may create the container
  # before the demo start runs, so the entry may appear in a different log.
  if [[ -f "$log_path" ]] && grep -Eq "\[(preinstall|install)\] explorer:" "$log_path"; then
    return 0
  fi

  # Also check the testAgent start log — the watchdog launched during the
  # first start may have created the explorer container there.
  local agent_log="${TEST_AGENT_START_LOG:-}"
  if [[ -n "$agent_log" && -f "$agent_log" ]] && grep -Eq "\[(preinstall|install)\] explorer:" "$agent_log"; then
    return 0
  fi

  # Fallback: verify the install hook actually ran inside the container by
  # checking the container logs for output from the explorer's install.sh
  # (which prints "Installing explorer dependencies...").
  local explorer_container
  explorer_container=$(compute_container_name "explorer" "fileExplorer") || true
  if [[ -n "$explorer_container" ]]; then
    local container_logs
    container_logs=$($FAST_CONTAINER_RUNTIME logs "$explorer_container" 2>&1) || true
    if echo "$container_logs" | grep -q "Installing explorer dependencies"; then
      return 0
    fi
  fi

  echo "No preinstall/install evidence for explorer found." >&2
  echo "Checked: start-demo.log, testAgent_start_log, and container logs." >&2
  if [[ -f "$log_path" ]]; then
    echo "--- start log tail ---" >&2
    tail -n 40 "$log_path" >&2
    echo "----------------------" >&2
  fi
  return 1
}
