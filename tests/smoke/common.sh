#!/bin/bash

smoke_require_runtime() {
  if [[ -z "${SMOKE_CONTAINER_RUNTIME:-}" ]]; then
    echo "SMOKE_CONTAINER_RUNTIME is not set" >&2
    return 1
  fi
  return 0
}

smoke_wait_for_router() {
  local port="$1"
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  smoke_fail "Router did not become ready on port ${port}"
  return 1
}

smoke_assert_container_running() {
  smoke_require_runtime || return 1
  local name="$1"
  if ! $SMOKE_CONTAINER_RUNTIME ps --filter "name=${name}" --format '{{.Names}}' | grep -q .; then
    smoke_fail "Expected container '${name}' to be running"
    return 1
  fi
  return 0
}

smoke_assert_container_stopped() {
  smoke_require_runtime || return 1
  local name="$1"
  if $SMOKE_CONTAINER_RUNTIME ps --filter "name=${name}" --format '{{.Names}}' | grep -q .; then
    smoke_fail "Expected container '${name}' to be stopped"
    return 1
  fi
  return 0
}

smoke_assert_router_not_running() {
  if pgrep -f "RoutingServer.js" >/dev/null 2>&1; then
    smoke_fail "RoutingServer process still running"
    return 1
  fi
  return 0
}

smoke_capture_cli_pwd() {
  local agent="${1:-demo}"
  ploinky cli "$agent" <<'EOF'
pwd
exit
EOF
}

smoke_assert_cli_pwd_contains() {
  local patterns="$1"
  local agent="${2:-demo}"
  local output
  if ! output=$(smoke_capture_cli_pwd "$agent"); then
    smoke_fail "'ploinky cli ${agent}' failed"
    return 1
  fi

  IFS='|' read -ra opts <<<"$patterns"
  local matched=1
  for pat in "${opts[@]}"; do
    if [[ -z "$pat" ]]; then
      if [[ "$output" == /* ]]; then
        matched=0
        break
      fi
    elif grep -q "$pat" <<<"$output"; then
      matched=0
      break
    fi
  done

  if (( matched )); then
    smoke_fail "CLI session did not match expected patterns ($patterns)"
    echo "$output"
    return 1
  fi
  return 0
}
