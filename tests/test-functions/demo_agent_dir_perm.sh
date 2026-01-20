fast_check_demo_agent_readonly_dirs() {
  local agent_name="demo"

  local raw_output
if ! raw_output=$(cat <<'EOS' | ploinky shell "$agent_name"
check_dir() {
  local path="$1" label="$2"
  local test_file="$path/.fast-readonly-test-$$"
  if [ -d "$path" ]; then
    echo "Exists $label"
  else
    echo "Missing $label"
  fi
  if touch "$test_file" 2>/dev/null; then
    rm -f "$test_file"
    echo "Writable $label"
  else
    echo "ReadOnly $label"
  fi
  rm -f "$test_file" >/dev/null 2>&1
}

# Note: /code/node_modules no longer exists with the new architecture.
# Dependencies are now in $WORKSPACE_PATH/node_modules (via NODE_PATH).
check_dir "/code" "code_dir"
check_dir "/Agent" "agent_root"
exit
EOS
  ); then
    echo "Failed to execute directory checks in ${agent_name}." >&2
    return 1
  fi

  local parsed_output
  # Strip shell prompt prefix (# or >) and carriage returns, then extract markers
  # The shell echoes heredoc continuation prompts (> >) which need to be stripped
  parsed_output=$(echo "$raw_output" | tr -d '\r' | sed 's/^[#> ]*//' | grep -E '^(Exists|Missing|ReadOnly|Writable) ')

  # New workspace structure expectations:
  # - /code: exists (rw in dev profile, ro in qa/prod)
  # - /Agent: exists and read-only (always)
  # - Runtime data and node_modules accessed via $WORKSPACE_PATH (CWD passthrough mount)
  local expected_markers=(
    "Exists code_dir"
    "Exists agent_root"
    "ReadOnly agent_root"
  )

  local marker
  local missing_markers=()
  for marker in "${expected_markers[@]}"; do
    if ! grep -Fqx -- "$marker" <<<"$parsed_output"; then
      missing_markers+=("$marker")
    fi
  done

  if (( ${#missing_markers[@]} > 0 )); then
    echo "Missing expected directory markers: ${missing_markers[*]}" >&2
    echo "--- Parsed directory markers ---" >&2
    echo "$parsed_output" >&2
    echo "--- Full shell output ---" >&2
    echo "$raw_output" >&2
    echo "-------------------------" >&2
    return 1
  fi

  # In the new structure, /Agent is always read-only
  local must_be_readonly=(
    "agent_root"
  )
  local label
  for label in "${must_be_readonly[@]}"; do
    if grep -Fqx -- "Writable $label" <<<"$parsed_output"; then
      echo "Directory write test unexpectedly succeeded: ${label}" >&2
      echo "--- Parsed directory markers ---" >&2
      echo "$parsed_output" >&2
      echo "--- Full shell output ---" >&2
      echo "$raw_output" >&2
      echo "-------------------------" >&2
      return 1
    fi
  done

}
