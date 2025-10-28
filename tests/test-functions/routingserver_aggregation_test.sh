fast_mcp_list_tools_after_demo() {
  local output
  output=$(ploinky client list tools)
  test_info "--- ploinky client list tools output (after demo) ---"
  test_info "$output"
  test_info "-------------------------------------------------"
  if ! grep -q 'run_simulation' <<<"$output"; then
    echo "run_simulation not found after starting demo" >&2
    return 1
  fi
  if ! grep -q 'echo_script' <<<"$output"; then
    echo "echo_script not found after starting demo" >&2
    return 1
  fi
}
