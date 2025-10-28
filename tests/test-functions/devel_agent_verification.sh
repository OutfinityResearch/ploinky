fast_assert_devel_agent_workdir() {
  local agent_var="$1"
  fast_require_var "TEST_RUN_DIR"
  fast_require_var "TEST_REPO_NAME"
  fast_require_var "$agent_var"

  local agent_name="${!agent_var}"

  local expected_dir="$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME"

  local raw_output
  if ! raw_output=$( {
    echo "pwd"
    echo "if [ -r . ] && [ -w . ]; then echo PERM_OK; else echo PERM_FAIL; fi"
    echo "exit"
  } | ploinky shell "$agent_name" ); then
    echo "Failed to execute 'pwd' in ${agent_name} shell." >&2
    return 1
  fi

  local actual_dir
  actual_dir=$(echo "$raw_output" | sed -n 's/^# \(\/.*\)/\1/p' | tr -d '\r')
  if [[ "$actual_dir" != "$expected_dir" ]]; then
    echo "Devel agent working directory mismatch for ${agent_name}." >&2
    echo "Expected: '$expected_dir'" >&2
    echo "Got: '$actual_dir'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi

  local perm_status
  perm_status=$(echo "$raw_output" | tr -d '\r' | sed -n 's/^# \(PERM_[A-Z0-9]\+\)$/\1/p' | tail -n 1)
  if [[ "$perm_status" != "PERM_OK" ]]; then
    echo "Devel agent workspace lacks read/write permissions for ${agent_name}." >&2
    echo "Expected PERM_OK marker but saw: '${perm_status}'" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi
}
