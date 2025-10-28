fast_assert_global_agent_workdir() {
  local agent_var="$1"
  fast_require_var "TEST_RUN_DIR"
  fast_require_var "$agent_var"

  local agent_name="${!agent_var}"

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
