fast_mcp_client_status() {
  local output
  output=$(ploinky client status simulator 2>&1)
  if ! echo "$output" | grep -q 'ok=true'; then
    echo "Output from 'ploinky client status simulator' did not include 'ok=true'." >&2
    echo "Output:" >&2
    echo "$output" >&2
    return 1
  fi
}

fast_mcp_list_tools() {
  local output
  output=$(ploinky client list tools)
  if ! grep -q 'run_simulation' <<<"$output"; then
    echo "run_simulation not found in client list tools" >&2
    return 1
  fi
}

fast_mcp_run_simulation() {
  local output
  output=$(ploinky client tool run_simulation -iterations 10)
   if ! echo "$output" | jq -e '.content[0].text | fromjson | .ok == true' >/dev/null; then
     echo "run_simulation did not return ok:true. Output: $output" >&2
     return 1
   fi
}

fast_mcp_demo_async_task() {
  local output
  output=$(ploinky client tool demo_async_task 2>&1)
  if ! echo "$output" | jq -e '.metadata.taskId' >/dev/null; then
    echo "demo_async_task did not return task metadata. Output: $output" >&2
    return 1
  fi
  if ! echo "$output" | jq -e '.content[0].text | contains("Task completed")' >/dev/null; then
    echo "demo_async_task result is missing completion text. Output: $output" >&2
    return 1
  fi
}
