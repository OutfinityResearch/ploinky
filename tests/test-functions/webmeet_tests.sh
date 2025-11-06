assert_webmeet_whoami() {
  require_var "TEST_ROUTER_PORT"

  if ! ploinky webmeet >/dev/null 2>&1; then
    echo "Failed to ensure webmeet token via 'ploinky webmeet'." >&2
    return 1
  fi

  local secrets_file=".ploinky/.secrets"
  if [[ ! -f "$secrets_file" ]]; then
    echo "Secrets file ${secrets_file} is missing." >&2
    return 1
  fi

  local token
  token=$(awk -F'=' '/^WEBMEET_TOKEN=/{print $2}' "$secrets_file" | tail -n1 | tr -d '\r')
  if [[ -z "$token" ]]; then
    echo "WebMeet token not found in ${secrets_file}." >&2
    return 1
  fi

  local base_url="http://127.0.0.1:${TEST_ROUTER_PORT}/webmeet"
  local cookie_jar
  cookie_jar=$(mktemp)

  if ! curl -fsS -c "$cookie_jar" -H 'Content-Type: application/json' \
      --data "{\"token\":\"$token\"}" "${base_url}/auth" >/dev/null; then
    echo "Failed to authenticate WebMeet session." >&2
    rm -f "$cookie_jar"
    return 1
  fi

  local whoami
  if ! whoami=$(curl -fsS -b "$cookie_jar" "${base_url}/whoami"); then
    echo "WebMeet whoami endpoint request failed." >&2
    rm -f "$cookie_jar"
    return 1
  fi

  rm -f "$cookie_jar"

  if ! jq -e '.ok == true' >/dev/null 2>&1 <<<"$whoami"; then
    echo "WebMeet whoami response invalid: $whoami" >&2
    return 1
  fi
}
