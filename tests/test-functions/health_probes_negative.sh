TESTS_SUBDIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=tests/lib.sh
source "$TESTS_SUBDIR/../lib.sh"

health_probes_force_failure() {
  load_state
  require_var "TEST_HEALTH_AGENT_REPO_PATH"
  local probe_dir="$TEST_HEALTH_AGENT_REPO_PATH"

  if [[ ! -d "$probe_dir" ]]; then
    echo "Health probe agent directory '$probe_dir' not found." >&2
    return 1
  fi

cat >"${probe_dir}/liveness_probe.sh" <<'EOF'
#!/bin/sh
echo not live
exit 1
EOF

cat >"${probe_dir}/readiness_probe.sh" <<'EOF'
#!/bin/sh
echo not ready
exit 1
EOF

  chmod +x "${probe_dir}/liveness_probe.sh" "${probe_dir}/readiness_probe.sh"
}

health_probes_force_success() {
  load_state
  require_var "TEST_HEALTH_AGENT_REPO_PATH"
  local probe_dir="$TEST_HEALTH_AGENT_REPO_PATH"

  if [[ ! -d "$probe_dir" ]]; then
    echo "Health probe agent directory '$probe_dir' not found." >&2
    return 1
  fi

cat >"${probe_dir}/liveness_probe.sh" <<'EOF'
#!/bin/sh
echo live
exit 0
EOF

cat >"${probe_dir}/readiness_probe.sh" <<'EOF'
#!/bin/sh
echo ready
exit 0
EOF

  chmod +x "${probe_dir}/liveness_probe.sh" "${probe_dir}/readiness_probe.sh"

  require_var "TEST_HEALTH_AGENT_NAME"
  require_var "TEST_REPO_NAME"
  require_var "TEST_HEALTH_AGENT_CONT_NAME"
  local qualified="${TEST_REPO_NAME}/${TEST_HEALTH_AGENT_NAME}"
  ploinky refresh agent "$qualified"
  wait_for_container "$TEST_HEALTH_AGENT_CONT_NAME" 20
}

health_probes_wait_for_failure_logs() {
  load_state
  require_var "TEST_AGENT_START_LOG"

  local log_file="$TEST_AGENT_START_LOG"
  if [[ ! -f "$log_file" ]]; then
    echo "Log file '$log_file' not found." >&2
    return 1
  fi


  local failure_pattern='liveness probe failed'
  local restart_pattern='restarting container'

  if ! grep -q "$failure_pattern" "$log_file" 2>/dev/null; then
    echo "Did not find liveness failure log in '$log_file'." >&2
    tail -n 40 "$log_file" >&2
    return 1
  fi

  if ! grep -q "$restart_pattern" "$log_file" 2>/dev/null; then
    echo "Did not find restart log in '$log_file'." >&2
    tail -n 40 "$log_file" >&2
    return 1
  fi

  return 0
}
