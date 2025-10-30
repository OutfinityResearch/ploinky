fast_router_verify_test_var_dynamic() {
  load_state
  require_var "TEST_ROUTER_PORT" || return 1

  local port="$TEST_ROUTER_PORT"
  local url="http://127.0.0.1:${port}/webtty/auth"

  local echo_output
  if ! echo_output=$(ploinky echo testVar 2>/dev/null); then
    echo "Failed to read testVar via 'ploinky echo'." >&2
    return 1
  fi

  local current_value="${echo_output#testVar=}"
  if [[ -z "$current_value" ]]; then
    echo "Current testVar value is empty." >&2
    return 1
  fi

  test_info "Aliasing WEBTTY_TOKEN to \$testVar for router verification."
  if ! ploinky var WEBTTY_TOKEN '$testVar' >/dev/null 2>&1; then
    echo "Failed to alias WEBTTY_TOKEN to \$testVar." >&2
    return 1
  fi

  local payload_initial
  payload_initial=$(printf '{"token":"%s"}' "$current_value")

  test_info "Checking router login with initial testVar value '${current_value}'."
  local initial_response
  if ! initial_response=$(curl -fsS \
      -X POST \
      -H 'Content-Type: application/json' \
      -d "$payload_initial" \
      "$url" 2>/dev/null); then
    echo "Router request with initial testVar value failed." >&2
    return 1
  fi

  if ! grep -q '"ok":true' <<<"$initial_response"; then
    echo "Router did not accept initial testVar value. Response: $initial_response" >&2
    return 1
  fi

  local new_value="changedValue"
  test_info "Updating testVar to '${new_value}'."
  if ! ploinky var testVar "$new_value" >/dev/null 2>&1; then
    echo "Failed to update testVar to '${new_value}'." >&2
    return 1
  fi

  sleep 0.2

  local payload_new
  payload_new=$(printf '{"token":"%s"}' "$new_value")

  test_info "Checking router login with updated testVar value '${new_value}'."
  local new_response
  if ! new_response=$(curl -fsS \
      -X POST \
      -H 'Content-Type: application/json' \
      -d "$payload_new" \
      "$url" 2>/dev/null); then
    echo "Router request with updated testVar value failed." >&2
    return 1
  fi

  if ! grep -q '"ok":true' <<<"$new_response"; then
    echo "Router did not accept updated testVar value. Response: $new_response" >&2
    return 1
  fi

  ploinky webtty --rotate >/dev/null 2>&1 || true
  return 0
}
