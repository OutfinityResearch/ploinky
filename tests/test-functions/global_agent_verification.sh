fast_assert_global_agent_workdir() {
  local agent_var="$1"
  require_var "TEST_RUN_DIR"
  require_var "$agent_var"

  local agent_name="${!agent_var}"
  local container_name
  container_name=$(compute_container_name "$agent_name" "$TEST_REPO_NAME")

  if ! wait_for_container "$container_name"; then
    echo "Container ${container_name} did not reach running state for ${agent_name}." >&2
    return 1
  fi

  local expected_dir="$TEST_RUN_DIR"

  local raw_output
  if ! raw_output=$( { echo "pwd"; echo "exit"; } | ploinky shell "$agent_name" ); then
    echo "Failed to execute 'pwd' in ${agent_name} shell." >&2
    return 1
  fi

  local actual_dir
  actual_dir=$(echo "$raw_output" | tr -d '\r' | sed -n 's/^# \(\/.*\)/\1/p' | head -n 1)
  if [[ -z "$actual_dir" ]]; then
    actual_dir=$(echo "$raw_output" | tr -d '\r' | sed -n '/^\//{p; q}')
  fi

  # Strip trailing prompt echoes such as " # pwd" that may be appended by the container shell.
  actual_dir=${actual_dir%% \#*}

  if [[ "$actual_dir" != "$expected_dir" ]]; then
    echo "Global agent working directory mismatch for ${agent_name}." >&2
    echo "Expected: '$expected_dir'" >&2
    echo "Got: '$actual_dir'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi
}
