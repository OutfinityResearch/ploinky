FAST_STATUS_OUTPUT=""

fast_collect_status_output() {
  if [[ -z "$FAST_STATUS_OUTPUT" ]]; then
    FAST_STATUS_OUTPUT=$(ploinky status 2>&1)
    test_info "--- ploinky status output ---"
    test_info "$FAST_STATUS_OUTPUT"
    test_info "--------------------------------"
  fi
}

fast_assert_status_contains() {
  local needle="$1"
  fast_collect_status_output
  if ! grep -Fq -- "$needle" <<<"$FAST_STATUS_OUTPUT"; then
    echo "Status output missing expected text: $needle" >&2
    return 1
  fi
}
