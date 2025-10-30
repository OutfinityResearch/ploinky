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
