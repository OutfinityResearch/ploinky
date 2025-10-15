#!/bin/bash
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

: "${FAST_STATE_FILE:?FAST_STATE_FILE is not set. Export it before sourcing lib.sh.}"
touch "$FAST_STATE_FILE"

if [[ -t 1 ]]; then
  FAST_COLOR_STAGE=$'\033[92m'
  FAST_COLOR_CHECK=$'\033[96m'
  FAST_COLOR_PASS=$'\033[32m'
  FAST_COLOR_FAIL=$'\033[31m'
  FAST_COLOR_INFO=$'\033[94m'
  FAST_COLOR_RESET=$'\033[0m'
else
  FAST_COLOR_STAGE=""
  FAST_COLOR_CHECK=""
  FAST_COLOR_PASS=""
  FAST_COLOR_FAIL=""
  FAST_COLOR_INFO=""
  FAST_COLOR_RESET=""
fi

FAST_CHECK_ERRORS=0

fast_init_results() {
  if [[ -n "${FAST_RESULTS_FILE:-}" ]]; then
    echo -n "" > "$FAST_RESULTS_FILE"
  fi
}

fast_log_result() {
  if [[ -n "${FAST_RESULTS_FILE:-}" ]]; then
    echo "$1" >> "$FAST_RESULTS_FILE"
  else
    echo "[DEBUG] FAST_RESULTS_FILE is not set. Cannot log result: $1" >&2
  fi
}

fast_stage_header() {
  local label="$1"
  printf "%s===== %s =====%s\n" "$FAST_COLOR_STAGE" "$label" "$FAST_COLOR_RESET"
  fast_log_result ""
  fast_log_result "===== $label ====="
}

fast_info() {
  local message="$1"
  printf "%s[INFO]%s %s\n" "$FAST_COLOR_INFO" "$FAST_COLOR_RESET" "$message"
}

fast_fail_message() {
  local message="$1"
  local label="[FAIL]"
  if [[ -n "$FAST_COLOR_FAIL" ]]; then
    printf "%s%s%s %s\n" "$FAST_COLOR_FAIL" "$label" "$FAST_COLOR_RESET" "$message"
  else
    printf "%s %s\n" "$label" "$message"
  fi
}

fast_pass_message() {
  local message="$1"
  local label="[PASS]"
  if [[ -n "$FAST_COLOR_PASS" ]]; then
    printf "%s%s%s %s\n" "$FAST_COLOR_PASS" "$label" "$FAST_COLOR_RESET" "$message"
  else
    printf "%s %s\n" "$label" "$message"
  fi
}

fast_check() {
  local description="$1"
  local callback="$2"
  shift 2

  local output
  if output=$("$callback" "$@" 2>&1); then
    fast_pass_message "$description"
    fast_log_result "[PASS] $description"
  else
    FAST_CHECK_ERRORS=$((FAST_CHECK_ERRORS + 1))
    fast_fail_message "$description"
    fast_log_result "[FAIL] $description"
    if [[ -n "$output" ]]; then
      printf '%s' "$output" | sed 's/^/        /'
      echo
      echo "        Error: $output" >> "$FAST_RESULTS_FILE"
    fi
  fi
}

fast_action() {
  local description="$1"
  local callback="$2"
  shift 2

  fast_info "$description"
  if ! "$callback" "$@" >/dev/null 2>&1; then
    fast_fail_message "Action '$description' failed."
    # Actions are critical, exit the stage if one fails.
    exit 1
  fi
}

fast_finalize_checks() {
  if (( FAST_CHECK_ERRORS > 0 )); then
    return "$FAST_CHECK_ERRORS"
  fi
  return 0
}

fast_write_state_var() {
  local key="$1"
  local value="$2"
  [[ -n "$key" ]] || { echo "State key missing" >&2; return 1; }
  local escaped
  printf -v escaped %q "$value"
  local tmp
  if [[ -f "$FAST_STATE_FILE" ]]; then
    tmp=$(mktemp)
    awk -v k="$key" -v v="$escaped" ' \
      BEGIN { updated = 0 } \
      $0 ~ ("^" k "=") { print k "=" v; updated = 1; next } \
      { print } \
      END { if (!updated) print k "=" v } \
    ' "$FAST_STATE_FILE" >"$tmp"
    mv "$tmp" "$FAST_STATE_FILE"
  else
    echo "${key}=${escaped}" >"$FAST_STATE_FILE"
  fi
}

fast_load_state() {
  set -a
  # shellcheck disable=SC1090
  source "$FAST_STATE_FILE"
  set +a
}

fast_require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Required state variable '${key}' is missing." >&2
    return 1
  fi
}

fast_detect_container_runtime() {
  local runtime
  for runtime in docker podman; do
    if command -v "$runtime" >/dev/null 2>&1; then
      if $runtime ps >/dev/null 2>&1; then
        echo "$runtime"
        return 0
      fi
    fi
  done
  echo "No usable container runtime (docker/podman) available." >&2
  return 1
}

fast_require_runtime() {
  fast_load_state
  if [[ -z "${FAST_CONTAINER_RUNTIME:-}" ]]; then
    local runtime
    if runtime=$(fast_detect_container_runtime); then
      FAST_CONTAINER_RUNTIME="$runtime"
      fast_write_state_var "FAST_CONTAINER_RUNTIME" "$FAST_CONTAINER_RUNTIME"
    else
      return 1
    fi
  fi
}

compute_container_name() {
  local agent_name="$1"
  if [[ -z "$agent_name" ]]; then
    echo "Agent name is required for computing container name." >&2
    return 1
  fi
  fast_load_state
  fast_require_var "TEST_RUN_DIR" || return 1
  local cwd="$TEST_RUN_DIR"
  FAST_TMP_CWD="$cwd" FAST_TMP_AGENT="$agent_name" node <<'NODE'
const crypto = require('crypto');
const path = require('path');

const cwd = process.env.FAST_TMP_CWD;
const agent = process.env.FAST_TMP_AGENT;

function sanitize(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

const safeAgent = sanitize(agent);
const projectDir = sanitize(path.basename(cwd));
const hash = crypto.createHash('sha256').update(cwd).digest('hex').substring(0, 6);
console.log(`ploinky_agent_${safeAgent}_${projectDir}_${hash}`);
NODE
}

fast_assert_dir_exists() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "Expected directory '${path}' to exist." >&2
    return 1
  fi
}

fast_assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Expected file '${path}' to exist." >&2
    return 1
  fi
}

fast_assert_file_contains() {
  local path="$1"
  local pattern="$2"
  if [[ ! -f "$path" ]]; then
    echo "File '${path}' missing." >&2
    return 1
  fi
  if ! grep -Eq "$pattern" "$path"; then
    echo "File '${path}' does not contain pattern '${pattern}'." >&2
    return 1
  fi
}

fast_assert_container_running() {
  fast_require_runtime || return 1
  local container="$1"
  if ! $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' is not running." >&2
    return 1
  fi
}

fast_assert_container_stopped() {
  fast_require_runtime || return 1
  local container="$1"
  if $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' is still running." >&2
    return 1
  fi
}

fast_assert_container_exists() {
  fast_require_runtime || return 1
  local container="$1"
  if ! $FAST_CONTAINER_RUNTIME ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' does not exist." >&2
    return 1
  fi
}

fast_assert_container_absent() {
  fast_require_runtime || return 1
  local container="$1"
  if $FAST_CONTAINER_RUNTIME ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' still exists." >&2
    return 1
  fi
}

fast_get_container_pid() {
  fast_require_runtime || return 1
  local container="$1"
  $FAST_CONTAINER_RUNTIME inspect --format '{{.State.Pid}}' "$container"
}

fast_assert_container_env() {
  fast_require_runtime || return 1
  local container="$1"
  local key="$2"
  local expected="$3"
  local value
  if ! value=$($FAST_CONTAINER_RUNTIME exec "$container" printenv "$key" 2>/dev/null); then
    echo "Unable to read env '${key}' from container '${container}'." >&2
    return 1
  fi
  if [[ "$value" != "$expected" ]]; then
    echo "Container '${container}': expected ${key}='${expected}', got '${value}'." >&2
    return 1
  fi
}

fast_assert_port_listening() {
  local port="$1"
  node - "$port" <<'NODE'
const net = require('net');
const port = parseInt(process.argv[2], 10);
if (isNaN(port)) {
  process.exit(1);
}
const s = new net.Socket();
s.setTimeout(500);
s.on('connect', () => {
  s.destroy();
  process.exit(0);
});
const fail = () => {
  s.destroy();
  process.exit(1);
};
s.on('error', fail);
s.on('timeout', fail);
s.connect(port, '127.0.0.1');
NODE
}

fast_assert_port_not_listening() {
  local port="$1"
  node - "$port" <<'NODE'
const net = require('net');
const port = parseInt(process.argv[2], 10);
if (isNaN(port)) {
  process.exit(0);
}
const s = new net.Socket();
s.setTimeout(500);
s.on('connect', () => {
  s.destroy();
  process.exit(1);
});
const succeed = () => {
  s.destroy();
  process.exit(0);
};
s.on('error', succeed);
s.on('timeout', succeed);
s.connect(port, '127.0.0.1');
NODE
}

fast_wait_for_container() {
  fast_require_runtime || return 1
  local container="$1"
  local attempts=120
  local delay=0.5
  local i
  for (( i=0; i<attempts; i++ )); do
    if $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
      return 0
    fi
    sleep "$delay"
  done
  echo "Container '${container}' did not reach running state." >&2
  return 1
}

fast_wait_for_agent_log_message() {
  local log_file="$1"
  local pattern="$2"
  local attempts=120 # 60 seconds
  local delay=0.5

  fast_info "Waiting for message '${pattern}' in file '${log_file}'"
  
  for (( i=0; i<attempts; i++ )); do
    if [[ -f "$log_file" ]] && grep -q "$pattern" "$log_file"; then
      fast_info "Message found in log file."
      return 0
    fi
    sleep "$delay"
  done

  echo "Timed out waiting for message '${pattern}' in '${log_file}'." >&2
  if [[ -f "$log_file" ]]; then
    echo "--- Log file content ---" >&2
    cat "$log_file" >&2
    echo "--- End of log file ---" >&2
  else
    echo "Log file '${log_file}' was not created." >&2
  fi
  return 1
}

fast_wait_for_container_stop() {
  fast_require_runtime || return 1
  local container="$1"
  local attempts=120
  local delay=0.5
  local i
  for (( i=0; i<attempts; i++ )); do
    if ! $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
      return 0
    fi
    sleep "$delay"
  done
  echo "Container '${container}' did not stop in time." >&2
  return 1
}

fast_wait_for_router() {
  fast_load_state
  fast_require_var "TEST_ROUTER_PORT" || return 1
  local port="$TEST_ROUTER_PORT"
  local attempts=120
  local delay=0.5
  local i
  for (( i=0; i<attempts; i++ )); do
    if curl -fsS "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  echo "Router is not responding on port ${port} after ${attempts} attempts." >&2
  return 1
}

fast_assert_router_status_ok() {
  fast_load_state
  fast_require_var "TEST_ROUTER_PORT" || return 1
  local port="$TEST_ROUTER_PORT"
  local response
  if ! response=$(curl -fsS "http://127.0.0.1:${port}/status/data" 2>/dev/null); then
    echo "Failed to fetch router status on port ${port}." >&2
    return 1
  fi
  if ! grep -q '"ok":true' <<<"$response"; then
    echo "Router status missing ok=true flag: ${response}" >&2
    return 1
  fi
}

fast_assert_agent_registered() {
  fast_load_state
  fast_require_var "TEST_RUN_DIR" || return 1
  fast_require_var "TEST_AGENT_NAME" || return 1
  fast_require_var "TEST_REPO_NAME" || return 1
  local registry="$TEST_RUN_DIR/.ploinky/agents"
  if [[ ! -f "$registry" ]]; then
    echo "Agents registry '${registry}' missing." >&2
    return 1
  fi
  FAST_TMP_REGISTRY="$registry" FAST_TMP_AGENT="$TEST_AGENT_NAME" FAST_TMP_REPO="$TEST_REPO_NAME" node <<'NODE'
const fs = require('fs');

const registryPath = process.env.FAST_TMP_REGISTRY;
const agentName = process.env.FAST_TMP_AGENT;
const repoName = process.env.FAST_TMP_REPO;

const raw = fs.readFileSync(registryPath, 'utf8');
const data = JSON.parse(raw || '{}');
const entries = Object.values(data || {});
const found = entries.find(entry => entry && entry.agentName === agentName && entry.repoName === repoName);
if (!found) {
  console.error(`Agent '${repoName}/${agentName}' not registered.`);
  process.exit(1);
}
NODE
}

fast_assert_enabled_repo() {
  fast_load_state
  fast_require_var "TEST_RUN_DIR" || return 1
  fast_require_var "TEST_REPO_NAME" || return 1
  local enabled_file="$TEST_RUN_DIR/.ploinky/enabled_repos.json"
  if [[ ! -f "$enabled_file" ]]; then
    echo "Enabled repos file '${enabled_file}' missing." >&2
    return 1
  fi
  if ! grep -Fq "\"$TEST_REPO_NAME\"" "$enabled_file"; then
    echo "Repository '${TEST_REPO_NAME}' not marked as enabled." >&2
    return 1
  fi
}

fast_assert_file_content_equals() {
  local path="$1"
  local expected="$2"
  if [[ ! -f "$path" ]]; then
    echo "File '${path}' missing." >&2
    return 1
  fi
  local actual
  actual=$(cat "$path")
  if [[ "$actual" != "$expected" ]]; then
    echo "File '${path}' content mismatch. Expected '${expected}', got '${actual}'." >&2
    return 1
  fi
}

fast_assert_http_response_contains() {
  local url="$1"
  local pattern="$2"
  local body
  if ! body=$(curl -fsS "$url" 2>/dev/null); then
    echo "HTTP request to '${url}' failed." >&2
    return 1
  fi
  if ! grep -Fq "$pattern" <<<"$body"; then
    echo "Response from '${url}' missing '${pattern}'." >&2
    return 1
  fi
}

fast_allocate_port() {
  local attempts=50
  local port
  for ((i=0; i<attempts; i++)); do
    port=$(( (RANDOM % 20000) + 20000 ))
    if ! ss -tulwn | awk '{print $5}' | grep -Eq "(:|^).*:${port}$"; then
      echo "$port"
      return 0
    fi
  done
  echo "Unable to locate a free TCP port after ${attempts} attempts." >&2
  return 1
}

fast_assert_file_not_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "Unexpected path exists: '${path}'." >&2
    return 1
  fi
}

fast_assert_not_equal() {
  local left="$1"
  local right="$2"
  local message="${3:-Values should differ.}"
  if [[ "$left" == "$right" ]]; then
    echo "$message" >&2
    return 1
  fi
}

fast_wait_for_file() {
  local path="$1"
  local attempts="${2:-40}"
  local delay="${3:-0.25}"
  local i
  for (( i=0; i<attempts; i++ )); do
    if [[ -f "$path" ]]; then
      return 0
    fi
    sleep "$delay"
  done
  echo "File '${path}' did not appear in time." >&2
  return 1
}

fast_run_with_timeout() {
  local timeout_seconds="$1"
  local description="$2"
  shift 2
  local command_to_run=($@)

  fast_info "$description"
  
  timeout "$timeout_seconds" "${command_to_run[@]}"
  local exit_code=$?

  if [[ $exit_code -eq 124 ]]; then
    fast_fail_message "Timeout: '${description}' exceeded ${timeout_seconds} seconds."
    return 124
  fi

  return $exit_code
}
