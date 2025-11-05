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

health_probes_wait_for_failure_logs() {
  load_state
  require_var "TEST_AGENT_START_LOG"
  require_var "TEST_HEALTH_AGENT_CONT_NAME"

  local log_file="$TEST_AGENT_START_LOG"
  if [[ ! -f "$log_file" ]]; then
    echo "Log file '$log_file' not found." >&2
    return 1
  fi

  local container_attempt=0
  while (( container_attempt < 10 )); do
    if ! assert_container_running "$TEST_HEALTH_AGENT_CONT_NAME" >/dev/null 2>&1; then
      break
    fi
    sleep 1
    container_attempt=$((container_attempt + 1))
  done

  if assert_container_running "$TEST_HEALTH_AGENT_CONT_NAME" >/dev/null 2>&1; then
    echo "Health probe container '${TEST_HEALTH_AGENT_CONT_NAME}' is still running." >&2
    tail -n 40 "$log_file" >&2
    return 1
  fi
}
