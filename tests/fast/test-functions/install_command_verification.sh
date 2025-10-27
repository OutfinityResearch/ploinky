fast_check_install_marker_via_shell() {
  local filename="install_marker.txt"
  # ploinky shell opens in the workspace, so no path is needed for ls.
  if ! { echo "ls -A"; echo "exit"; } | ploinky shell "$TEST_AGENT_NAME" | grep -qF -- "$filename"; then
    echo "File '${filename}' not found in workspace via 'ploinky shell'." >&2
    echo "--- ploinky shell ls output ---" >&2
    { echo "ls -A"; echo "exit"; } | ploinky shell "$TEST_AGENT_NAME" >&2
    echo "---------------------------" >&2
    return 1
  fi
}
