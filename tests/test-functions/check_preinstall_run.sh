check_preinstall_run() {
  load_state
  require_var "TEST_START_LOG"

  local log_path="$TEST_START_LOG"
  if [[ ! -f "$log_path" ]]; then
    echo "Start log '$log_path' not found." >&2
    return 1
  fi

  # Check for lifecycle hooks running in main container entrypoint:
  # - [preinstall] explorer: (setup/config commands)
  # - [install] explorer: (dependency installation like npm install)
  # Both hooks run inside the main container entrypoint, chained before the agent command.
  if grep -Eq "\[(preinstall|install)\] explorer:" "$log_path"; then
    return 0
  fi

  echo "No preinstall/install entry for explorer found in '$log_path'." >&2
  echo "Expected either '[preinstall] explorer:' or '[install] explorer:'" >&2
  echo "--- start log tail ---" >&2
  tail -n 40 "$log_path" >&2
  echo "----------------------" >&2
  return 1
}
