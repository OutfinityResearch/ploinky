fast_check_webchat_token_rotation() {
  load_state
  require_var "TEST_RUN_DIR"

  local secrets_file="$TEST_RUN_DIR/.ploinky/.secrets"

  local before_raw=""
  if ! before_raw=$(awk -F'=' 'BEGIN{found=0} $1=="WEBCHAT_TOKEN"{print substr($0, index($0, "=")+1); found=1; exit} END{if(!found) exit 1}' "$secrets_file" 2>/dev/null); then
    before_raw=""
  fi
  local before_token="${before_raw//$'\r'/}"
  if [[ -z "${before_token:-}" ]]; then
    echo "WEBCHAT_TOKEN missing before rotation in '$secrets_file'." >&2
    return 1
  fi

  ploinky webchat --rotate >/dev/null 2>&1

  local after_raw=""
  if ! after_raw=$(awk -F'=' 'BEGIN{found=0} $1=="WEBCHAT_TOKEN"{print substr($0, index($0, "=")+1); found=1; exit} END{if(!found) exit 1}' "$secrets_file" 2>/dev/null); then
    after_raw=""
  fi
  local after_token="${after_raw//$'\r'/}"
  if [[ -z "${after_token:-}" ]]; then
    echo "WEBCHAT_TOKEN missing after rotation in '$secrets_file'." >&2
    return 1
  fi

  if [[ "$before_token" == "$after_token" ]]; then
    echo "WEBCHAT_TOKEN did not change after 'ploinky webchat --rotate'." >&2
    echo "Before: $before_token" >&2
    echo "After:  $after_token" >&2
    return 1
  fi
}

fast_check_webchat_alias_override() {
  load_state
  require_var "TEST_ROUTER_PORT"
  require_var "TEST_ENABLE_ALIAS_AGENT_ALIAS"

  local router_port="$TEST_ROUTER_PORT"
  local alias_name="$TEST_ENABLE_ALIAS_AGENT_ALIAS"
  local url="http://127.0.0.1:${router_port}/webchat?agent=${alias_name}"
  local tmp_file
  tmp_file=$(mktemp) || return 1

  local http_status
  if ! http_status=$(curl -sS -o "$tmp_file" -w '%{http_code}' "$url" 2>/dev/null); then
    echo "WebChat alias curl request failed for ${url}." >&2
    rm -f "$tmp_file"
    return 1
  fi

  if [[ "$http_status" != "200" ]]; then
    echo "WebChat alias request returned HTTP ${http_status} for ${url}." >&2
    if [[ -s "$tmp_file" ]]; then
      echo "--- response body ---" >&2
      cat "$tmp_file" >&2 || true
      echo "---------------------" >&2
    fi
    rm -f "$tmp_file"
    return 1
  fi

  if ! grep -q 'data-page="chat"\|data-page="login"' "$tmp_file"; then
    echo "Unexpected WebChat response when requesting agent '${alias_name}'." >&2
    echo "--- response body ---" >&2
    cat "$tmp_file" >&2 || true
    echo "---------------------" >&2
    rm -f "$tmp_file"
    return 1
  fi

  local expected_attr="data-agent=\"${alias_name}\""
  if ! grep -Fq "$expected_attr" "$tmp_file"; then
    echo "WebChat HTML missing ${expected_attr} marker for agent '${alias_name}'." >&2
    echo "--- response body ---" >&2
    cat "$tmp_file" >&2 || true
    echo "---------------------" >&2
    rm -f "$tmp_file"
    return 1
  fi

  rm -f "$tmp_file"
}

fast_check_webchat_logout_flow() {
  load_state
  require_var "TEST_RUN_DIR"
  require_var "TEST_ROUTER_PORT"

  local secrets_file="$TEST_RUN_DIR/.ploinky/.secrets"
  local webchat_token
  webchat_token=$(awk -F'=' 'BEGIN{found=0} $1=="WEBCHAT_TOKEN"{print substr($0, index($0, "=")+1); found=1; exit} END{if(!found) exit 1}' "$secrets_file" 2>/dev/null || true)
  webchat_token="${webchat_token//$'\r'/}"
  if [[ -z "${webchat_token:-}" ]]; then
    echo "WEBCHAT_TOKEN missing in '$secrets_file'." >&2
    return 1
  fi

  local router_url="http://127.0.0.1:${TEST_ROUTER_PORT}"
  local cookie_jar
  local body_file
  local header_file
  cookie_jar=$(mktemp) || return 1
  body_file=$(mktemp) || { rm -f "$cookie_jar"; return 1; }
  header_file=$(mktemp) || { rm -f "$cookie_jar" "$body_file"; return 1; }

  local status
  status=$(curl -sS -o "$body_file" -w '%{http_code}' -c "$cookie_jar" \
    -H 'Content-Type: application/json' \
    -X POST "${router_url}/webchat/auth" \
    -d "{\"token\":\"${webchat_token}\"}" 2>/dev/null || echo "000")
  if [[ "$status" != "200" ]]; then
    echo "WebChat auth failed with HTTP ${status}." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi

  status=$(curl -sS -o "$body_file" -w '%{http_code}' -b "$cookie_jar" \
    "${router_url}/webchat/whoami" 2>/dev/null || echo "000")
  if [[ "$status" != "200" ]] || ! grep -q '"ok":[[:space:]]*true' "$body_file"; then
    echo "WebChat whoami should be authenticated after login." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi

  status=$(curl -sS -o "$body_file" -D "$header_file" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" \
    -X POST "${router_url}/webchat/logout" 2>/dev/null || echo "000")
  if [[ "$status" != "200" ]]; then
    echo "WebChat logout failed with HTTP ${status}." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi
  if ! grep -q '"ok":[[:space:]]*true' "$body_file"; then
    echo "WebChat logout response missing ok=true." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi
  if ! grep -Eiq '^Set-Cookie: webchat_sid=.*Max-Age=0' "$header_file"; then
    echo "WebChat logout did not clear webchat_sid cookie." >&2
    cat "$header_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi
  if ! grep -Eiq '^Set-Cookie: webchat_token=.*Max-Age=0' "$header_file"; then
    echo "WebChat logout did not clear webchat_token cookie." >&2
    cat "$header_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi
  if ! grep -q '"redirect":[[:space:]]*"/webchat/' "$body_file"; then
    echo "WebChat logout response missing redirect to /webchat/." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi

  status=$(curl -sS -o "$body_file" -w '%{http_code}' -b "$cookie_jar" \
    "${router_url}/webchat/whoami" 2>/dev/null || echo "000")
  if [[ "$status" != "200" ]] || ! grep -q '"ok":[[:space:]]*false' "$body_file"; then
    echo "WebChat whoami should be unauthenticated after logout." >&2
    cat "$body_file" >&2 || true
    rm -f "$cookie_jar" "$body_file" "$header_file"
    return 1
  fi

  rm -f "$cookie_jar" "$body_file" "$header_file"
}
