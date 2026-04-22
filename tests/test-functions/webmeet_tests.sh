assert_webmeet_whoami() {
  require_var "TEST_ROUTER_PORT"
  local base_url="http://127.0.0.1:${TEST_ROUTER_PORT}/webmeet"
  local body_file
  body_file=$(mktemp) || return 1

  local status
  status=$(curl -sS -o "$body_file" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    --data '{"token":"legacy-token"}' \
    "${base_url}/auth" 2>/dev/null || echo "000")

  if [[ "$status" != "410" ]]; then
    echo "Legacy WebMeet auth endpoint should return HTTP 410, got ${status}." >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    return 1
  fi

  if ! grep -q 'surface_token_auth_removed' "$body_file"; then
    echo "Legacy WebMeet auth endpoint response missing removal marker." >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    return 1
  fi

  rm -f "$body_file"
}
