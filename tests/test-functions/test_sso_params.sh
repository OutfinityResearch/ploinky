#!/bin/bash
set -euo pipefail

configure_webchat_cli_for_test_agent() {
  load_state
  require_var "TEST_AGENT_NAME"
  require_var "TEST_ROUTER_PORT"
  ploinky start "$TEST_AGENT_NAME" "$TEST_ROUTER_PORT" >/dev/null 2>&1 || return 1
  ploinky webchat >/dev/null 2>&1 || return 1
}

ensure_webchat_cli_session() {
  load_state
  require_var "TEST_RUN_DIR"
  require_var "TEST_ROUTER_PORT"
  require_var "TEST_AGENT_NAME"
  require_var "TEST_AGENT_WORKSPACE"

  local router_port="$TEST_ROUTER_PORT"
  local agent_name="$TEST_AGENT_NAME"
  local workspace="$TEST_AGENT_WORKSPACE"
  local log_file="$workspace/test-sso-params.log"
  local secrets_file="$TEST_RUN_DIR/.ploinky/.secrets"
  local cookie_file
  local stream_file
  local tab_id="sso-check-$(date +%s%N)"

  rm -f "$log_file"

  local token
  if [[ -f "$secrets_file" ]]; then
    token=$(awk -F'=' '$1=="WEBCHAT_TOKEN" { print $2 }' "$secrets_file" | tail -n1)
  fi

  if [[ -z "${token:-}" ]]; then
    echo "WEBCHAT_TOKEN missing from $secrets_file." >&2
    return 1
  fi

  cookie_file=$(mktemp)
  stream_file=$(mktemp)

  if ! curl -sS -c "$cookie_file" -H 'Content-Type: application/json' \
      --data "{\"token\":\"$token\"}" \
      "http://127.0.0.1:${router_port}/webchat/auth" >/dev/null; then
    rm -f "$cookie_file" "$stream_file"
    echo "WebChat auth request failed." >&2
    return 1
  fi

  local curl_status=0
  timeout 6s curl -sS -N -b "$cookie_file" \
      "http://127.0.0.1:${router_port}/webchat/stream?tabId=${tab_id}" \
      >"$stream_file" 2>/dev/null || curl_status=$?

  rm -f "$cookie_file" "$stream_file"

  if [[ $curl_status -ne 0 && $curl_status -ne 124 ]]; then
    echo "WebChat stream request failed (status $curl_status)." >&2
    return 1
  fi

  for _ in {1..15}; do
    [[ -f "$log_file" ]] && break
    sleep 0.2
  done

  if [[ ! -f "$log_file" ]]; then
    echo "Expected log file '$log_file' not produced by WebChat session." >&2
    return 1
  fi

  return 0
}

test_sso_params_disabled() {
  load_state
  require_var "TEST_AGENT_WORKSPACE"

  if ! ensure_webchat_cli_session; then
    return 1
  fi

  local log_file="$TEST_AGENT_WORKSPACE/test-sso-params.log"

  if [[ ! -f "$log_file" ]]; then
    echo "Log file '$log_file' not found." >&2
    return 1
  fi

  mapfile -t lines <"$log_file"

  local required=(
    "--sso-user=guest"
    "--sso-user-id=guest"
    "--sso-roles=guest"
  )

  local missing=0
  for needle in "${required[@]}"; do
    if ! printf '%s\n' "${lines[@]}" | grep -Fq -- "$needle"; then
      echo "Missing expected argument '$needle' in $log_file" >&2
      missing=1
    fi
  done

  if (( missing )); then
    if [[ -f "$log_file" ]]; then
      echo "--- test-sso-params.log ---" >&2
      cat "$log_file" >&2 || true
      echo "--------------------------" >&2
    else
      echo "(log file missing)" >&2
    fi
    return 1
  fi

  return 0
}

test_sso_params_enabled() {
  load_state
  require_var "TEST_AGENT_WORKSPACE"
  require_var "TEST_RUN_DIR"

  local config_file="$TEST_RUN_DIR/.ploinky/config.json"
  local sso_enabled=""
  if [[ -f "$config_file" ]] && command -v jq >/dev/null 2>&1; then
    sso_enabled=$(jq -r '(.sso.enabled // false)|tostring' "$config_file" 2>/dev/null || echo "false")
  else
    sso_enabled="false"
  fi

  if [[ "$sso_enabled" != "true" ]]; then
    test_info "SSO not enabled; skipping identity argument verification."
    return 0
  fi

  if ! ensure_webchat_cli_session; then
    return 1
  fi

  local log_file="$TEST_AGENT_WORKSPACE/test-sso-params.log"

  mapfile -t lines <"$log_file"

  local found_real=0
  local found_guest=0

  for line in "${lines[@]}"; do
    case "$line" in
      --sso-user=guest|--sso-user-id=guest|--sso-roles=guest)
        found_guest=1
        ;;
      --sso-user=*|--sso-user-id=*|--sso-email=*|--sso-roles=*)
        if [[ "$line" != *"=guest" ]]; then
          found_real=1
        fi
        ;;
    esac
  done

  if (( found_real )); then
    return 0
  fi

  echo "SSO is enabled but no non-guest identity arguments were observed in $log_file." >&2
  if [[ -f "$log_file" ]]; then
    echo "--- test-sso-params.log ---" >&2
    cat "$log_file" >&2 || true
    echo "--------------------------" >&2
  fi
  return 1
}
