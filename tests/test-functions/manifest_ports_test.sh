fast_assert_manifest_ports() {
  require_var "TEST_GLOBAL_AGENT_NAME"
  require_var "TEST_GLOBAL_AGENT_HOST_PORT"
  require_var "TEST_GLOBAL_AGENT_CONTAINER_PORT"
  require_var "TEST_GLOBAL_AGENT_CONT_NAME"

  local host_port="$TEST_GLOBAL_AGENT_HOST_PORT"
  local container_port="$TEST_GLOBAL_AGENT_CONTAINER_PORT"
  local agent_name="$TEST_GLOBAL_AGENT_NAME"
  local container_name="$TEST_GLOBAL_AGENT_CONT_NAME"

  if ! wait_for_container "$container_name"; then
    echo "Container ${container_name} did not reach running state." >&2
    return 1
  fi

  if ! assert_port_listening "$host_port"; then
    echo "Global agent host port ${host_port} is not listening." >&2
    return 1
  fi

  if ! assert_port_bound_local "$container_name" "$container_port" "$host_port"; then
    echo "Host port ${host_port} is not mapped to container port ${container_port} for ${container_name}." >&2
    return 1
  fi

  local shell_output
  if ! shell_output=$({
    printf '%s\n' "netstat -tulpn 2>/dev/null | grep ':$container_port' | awk '{print \\\$7}' | cut -d'/' -f2 || true"
    printf '%s\n' "exit"
  } | ploinky shell "$agent_name" ); then
    echo "Failed to inspect listening ports inside ${agent_name}." >&2
    return 1
  fi

  if [[ -z "$shell_output" ]]; then
    echo "Container is not listening on expected port ${container_port}." >&2
    return 1
  fi
}
