check_preinstall_run() {
  load_state
  require_var "TEST_START_LOG"

  local log_path="$TEST_START_LOG"
  if [[ ! -f "$log_path" ]]; then
    echo "Start log '$log_path' not found." >&2
    return 1
  fi

  if ! grep -Fq "Running preinstall for 'explorer'" "$log_path"; then
    echo "Preinstall entry for explorer not found in '$log_path'." >&2
    echo "--- start log tail ---" >&2
    tail -n 40 "$log_path" >&2
    echo "----------------------" >&2
    return 1
  fi
}
