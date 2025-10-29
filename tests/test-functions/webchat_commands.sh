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

check_webchat_command_output() {
  load_state
  require_var "TEST_AGENT_NAME"
  require_var "TEST_AGENT_START_LOG"

  local log_path="$TEST_AGENT_START_LOG"

  if [[ ! -f "$log_path" ]]; then
    echo "Start log '$log_path' for '$TEST_AGENT_NAME' not found." >&2
    return 1
  fi

  if ! grep -q "Hello" "$log_path"; then
    echo "Webchat setup output missing expected 'Hello'." >&2
    echo "--- ${TEST_AGENT_NAME} start log tail ---" >&2
    tail -n 40 "$log_path" >&2 || true
    echo "----------------------------------------" >&2
    return 1
  fi
}
