fast_router_verify_test_var_dynamic() {
  load_state
  require_var "TEST_ROUTER_PORT" || return 1

  local port="$TEST_ROUTER_PORT"
  local url="http://127.0.0.1:${port}/webtty/auth"
  local body_file
  body_file=$(mktemp) || return 1
  local status
  status=$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"token":"legacy-token"}' \
    "$url" 2>/dev/null || echo "000")

  if [[ "$status" != "410" ]]; then
    echo "Legacy WebTTY auth endpoint should return HTTP 410, got ${status}." >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    return 1
  fi

  if ! grep -q 'surface_token_auth_removed' "$body_file"; then
    echo "Legacy WebTTY auth endpoint response missing removal marker." >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    return 1
  fi

  rm -f "$body_file"
}
