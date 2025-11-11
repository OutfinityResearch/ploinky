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
