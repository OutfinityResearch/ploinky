fast_assert_router_static_asset() {
  require_var "TEST_ROUTER_PORT"
  require_var "TEST_STATIC_ASSET_PATH"
  require_var "TEST_STATIC_ASSET_EXPECTED"
  local url="http://127.0.0.1:${TEST_ROUTER_PORT}${TEST_STATIC_ASSET_PATH}"
  local body
  if ! body=$(curl -fsS "$url" 2>/dev/null); then
    echo "Failed to fetch static asset at ${url}." >&2
    return 1
  fi
  if [[ "${body}" != "${TEST_STATIC_ASSET_EXPECTED}" ]]; then
    echo "Static asset content mismatch for ${url}." >&2
    echo "Expected: '${TEST_STATIC_ASSET_EXPECTED}'" >&2
    echo "Got: '${body}'" >&2
    return 1
  fi
}
