#!/bin/bash
set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

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

init_results() {
  if [[ -n "${FAST_RESULTS_FILE:-}" ]]; then
    echo -n "" > "$FAST_RESULTS_FILE"
  fi
}

log_result() {
  if [[ -n "${FAST_RESULTS_FILE:-}" ]]; then
    echo "$1" >> "$FAST_RESULTS_FILE"
  else
    echo "[DEBUG] FAST_RESULTS_FILE is not set. Cannot log result: $1" >&2
  fi
}

stage_header() {
  local label="$1"
  printf "%s===== %s =====%s\n" "$FAST_COLOR_STAGE" "$label" "$FAST_COLOR_RESET"
  log_result ""
  log_result "===== $label ====="
}

test_info() {
  local message="$1"
  printf "%s[INFO]%s %s\n" "$FAST_COLOR_INFO" "$FAST_COLOR_RESET" "$message"
}

fail_message() {
  local message="$1"
  local label="[FAIL]"
  if [[ -n "$FAST_COLOR_FAIL" ]]; then
    printf "%s%s%s %s\n" "$FAST_COLOR_FAIL" "$label" "$FAST_COLOR_RESET" "$message"
  else
    printf "%s %s\n" "$label" "$message"
  fi
}

pass_message() {
  local message="$1"
  local label="[PASS]"
  if [[ -n "$FAST_COLOR_PASS" ]]; then
    printf "%s%s%s %s\n" "$FAST_COLOR_PASS" "$label" "$FAST_COLOR_RESET" "$message"
  else
    printf "%s %s\n" "$label" "$message"
  fi
}

test_check() {
  local description="$1"
  local callback="$2"
  shift 2

  local output
  if output=$("$callback" "$@" 2>&1); then
    pass_message "$description"
    log_result "[PASS] $description"
  else
    FAST_CHECK_ERRORS=$((FAST_CHECK_ERRORS + 1))
    fail_message "$description"
    log_result "[FAIL] $description"
    if [[ -n "$output" ]]; then
      printf '%s' "$output" | sed 's/^/        /'
      echo
      echo "        Error: $output" >> "$FAST_RESULTS_FILE"
    fi
  fi
}

test_action() {
  local description="$1"
  local callback="$2"
  shift 2

  test_info "$description"
  if ! "$callback" "$@" >/dev/null 2>&1; then
    fail_message "Action '$description' failed."
    # Actions are critical, exit the stage if one fails.
    exit 1
  fi
}

finalize_checks() {
  if (( FAST_CHECK_ERRORS > 0 )); then
    return "$FAST_CHECK_ERRORS"
  fi
  return 0
}

write_state_var() {
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

load_state() {
  set -a
  # shellcheck disable=SC1090
  source "$FAST_STATE_FILE"
  set +a
}

require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Required state variable '${key}' is missing." >&2
    return 1
  fi
}

detect_container_runtime() {
  # Respect CONTAINER_RUNTIME env var if set (used by CI workflows)
  if [[ -n "${CONTAINER_RUNTIME:-}" ]]; then
    if command -v "$CONTAINER_RUNTIME" >/dev/null 2>&1; then
      if $CONTAINER_RUNTIME ps >/dev/null 2>&1; then
        echo "$CONTAINER_RUNTIME"
        return 0
      fi
    fi
    echo "Specified CONTAINER_RUNTIME='${CONTAINER_RUNTIME}' is not available or not working." >&2
    return 1
  fi

  # Auto-detect if not specified
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

require_runtime() {
  load_state
  if [[ -z "${FAST_CONTAINER_RUNTIME:-}" ]]; then
    local runtime
    if runtime=$(detect_container_runtime); then
      FAST_CONTAINER_RUNTIME="$runtime"
      write_state_var "FAST_CONTAINER_RUNTIME" "$FAST_CONTAINER_RUNTIME"
    else
      return 1
    fi
  fi
}

compute_container_name() {
  local agent_name="$1"
  local repo_name="$2"
  if [[ -z "$agent_name" ]]; then
    echo "Agent name is required for computing container name." >&2
    return 1
  fi
  load_state
  require_var "TEST_RUN_DIR" || return 1
  local cwd="$TEST_RUN_DIR"
  if [[ -z "$repo_name" && -n "${TEST_REPO_NAME:-}" ]]; then
    repo_name="$TEST_REPO_NAME"
  fi
  FAST_TMP_CWD="$cwd" FAST_TMP_AGENT="$agent_name" FAST_TMP_REPO="$repo_name" node <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const cwd = process.env.FAST_TMP_CWD;
const agent = process.env.FAST_TMP_AGENT;
let repo = process.env.FAST_TMP_REPO || '';

function sanitize(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

try {
  if (!repo) {
    const mapPath = path.join(cwd, '.ploinky', 'agents');
    const raw = fs.readFileSync(mapPath, 'utf8');
    const data = JSON.parse(raw || '{}');
    if (data && typeof data === 'object') {
      for (const value of Object.values(data)) {
        if (value && typeof value === 'object' && value.agentName === agent && value.repoName) {
          repo = value.repoName;
          break;
        }
      }
    }
  }
} catch (_) {
  // ignore lookup failures; fallback to provided repo if any
}

const safeAgent = sanitize(agent);
const safeRepo = sanitize(repo);
const projectDir = sanitize(path.basename(cwd));
const hash = crypto.createHash('sha256').update(cwd).digest('hex').substring(0, 8);
console.log(`ploinky_${safeRepo}_${safeAgent}_${projectDir}_${hash}`);
NODE
}

assert_dir_exists() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "Expected directory '${path}' to exist." >&2
    return 1
  fi
}

assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Expected file '${path}' to exist." >&2
    return 1
  fi
}

assert_file_contains() {
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

check_router_stop_entry() {
  local log_file="$1"
  local expected_port="$2"
  local state_var="${3:-}"
  local previous_entry="${4:-}"

  if [[ -z "$log_file" ]]; then
    echo "Router log path not provided." >&2
    return 1
  fi
  if [[ ! -f "$log_file" ]]; then
    echo "Router log '${log_file}' missing." >&2
    return 1
  fi

  local last_entry
  last_entry=$(tail -n 1 "$log_file" 2>/dev/null || true)
  if [[ -z "$last_entry" ]]; then
    echo "Router log '${log_file}' is empty." >&2
    return 1
  fi

  if [[ "$last_entry" != *'"type":"server_stop"'* ]]; then
    echo "Router log last entry does not record server_stop: ${last_entry}" >&2
    return 1
  fi

  if [[ -n "$expected_port" ]] && ! grep -q "\"port\":${expected_port}" <<<"$last_entry"; then
    echo "Router stop entry missing expected port ${expected_port}: ${last_entry}" >&2
    return 1
  fi

  if [[ -n "$previous_entry" && "$last_entry" == "$previous_entry" ]]; then
    echo "Router stop entry matches previous record." >&2
    return 1
  fi

  if [[ -n "$state_var" ]]; then
    write_state_var "$state_var" "$last_entry"
  fi

  return 0
}

assert_container_running() {
  require_runtime || return 1
  local container="$1"
  if ! $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' is not running." >&2
    return 1
  fi
}

assert_container_stopped() {
  require_runtime || return 1
  local container="$1"
  if $FAST_CONTAINER_RUNTIME ps --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' is still running." >&2
    return 1
  fi
}

assert_container_exists() {
  require_runtime || return 1
  local container="$1"
  if ! $FAST_CONTAINER_RUNTIME ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' does not exist." >&2
    return 1
  fi
}

assert_container_absent() {
  require_runtime || return 1
  local container="$1"
  if $FAST_CONTAINER_RUNTIME ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    echo "Container '${container}' still exists." >&2
    return 1
  fi
}

get_container_pid() {
  require_runtime || return 1
  local container="$1"
  $FAST_CONTAINER_RUNTIME inspect --format '{{.State.Pid}}' "$container"
}

assert_container_env() {
  require_runtime || return 1
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

assert_container_env_absent() {
  require_runtime || return 1
  local container="$1"
  local key="$2"
  local value
  if value=$($FAST_CONTAINER_RUNTIME exec "$container" printenv "$key" 2>/dev/null); then
    echo "Container '${container}' unexpectedly exposes ${key}='${value}'." >&2
    return 1
  fi
  return 0
}

assert_port_listening() {
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

assert_port_bound_local() {
  require_runtime || return 1
  local container="$1"
  local container_port="$2"
  local expected_host_port="${3:-}"
  local expected_ip="${4:-127.0.0.1}"

  if [[ -z "$container" || -z "$container_port" ]]; then
    echo "Container and container port are required." >&2
    return 1
  fi

  local output
  if ! output=$($FAST_CONTAINER_RUNTIME port "$container" "${container_port}/tcp" 2>/dev/null); then
    echo "Unable to resolve port mapping for ${container}:${container_port}/tcp." >&2
    return 1
  fi

  local found_expected=0
  local line
  while IFS= read -r line; do
    line="${line//[$'\r\n']/}"
    line=${line# } ; line=${line% }
    [[ -z "$line" ]] && continue

    local host_part=${line%:*}
    local host_port=${line##*:}
    host_part=${host_part#[}
    host_part=${host_part%]}

    if [[ -n "$expected_host_port" && "$host_port" != "$expected_host_port" ]]; then
      continue
    fi

    if [[ "$host_part" == "0.0.0.0" || "$host_part" == "::" ]]; then
      echo "Port ${container}:${container_port}/tcp is bound to '${host_part}:${host_port}', expected ${expected_ip}." >&2
      return 1
    fi

    if [[ "$host_part" == "$expected_ip" ]]; then
      found_expected=1
    elif [[ "$host_part" == "::1" && "$expected_ip" == "127.0.0.1" ]]; then
      found_expected=1
    fi
  done <<< "$output"

  if [[ $found_expected -eq 0 ]]; then
    echo "No binding found on ${expected_ip} for ${container}:${container_port}/tcp (docker port output: ${output})." >&2
    return 1
  fi
}

assert_port_not_listening() {
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

assert_routing_server_stopped() {
  load_state
  require_var "TEST_ROUTER_PORT" || return 1

  local port="$TEST_ROUTER_PORT"

  if ! command -v lsof >/dev/null 2>&1; then
    echo "lsof is required to inspect router PID for port ${port}." >&2
    return 1
  fi

  local pid
  pid=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1)

  if [[ -n "$pid" ]]; then
    echo "RoutingServer process still running on port ${port} (PID: ${pid})." >&2
    return 1
  fi

  return 0
}

wait_for_container() {
  require_runtime || return 1
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

wait_for_agent_log_message() {
  local log_file="$1"
  local pattern="$2"
  local attempts=120 # 60 seconds
  local delay=0.5

  test_info "Waiting for message '${pattern}' in file '${log_file}'"
  
  for (( i=0; i<attempts; i++ )); do
    if [[ -f "$log_file" ]] && grep -q "$pattern" "$log_file"; then
      test_info "Message found in log file."
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

wait_for_container_stop() {
  require_runtime || return 1
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

wait_for_router() {
  load_state
  require_var "TEST_ROUTER_PORT" || return 1
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

assert_router_status_ok() {
  load_state
  require_var "TEST_ROUTER_PORT" || return 1
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

assert_agent_registered() {
  load_state
  require_var "TEST_RUN_DIR" || return 1
  require_var "TEST_AGENT_NAME" || return 1
  require_var "TEST_REPO_NAME" || return 1
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

assert_enabled_repo() {
  load_state
  require_var "TEST_RUN_DIR" || return 1
  require_var "TEST_REPO_NAME" || return 1
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

assert_file_content_equals() {
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

assert_http_response_contains() {
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

allocate_port() {
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

assert_file_not_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "Unexpected path exists: '${path}'." >&2
    return 1
  fi
}

assert_not_equal() {
  local left="$1"
  local right="$2"
  local message="${3:-Values should differ.}"
  if [[ "$left" == "$right" ]]; then
    echo "$message" >&2
    return 1
  fi
}

wait_for_file() {
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

run_with_timeout() {
  local timeout_seconds="$1"
  local description="$2"
  shift 2
  local command_to_run=($@)

  test_info "$description"
  
  timeout "$timeout_seconds" "${command_to_run[@]}"
  local exit_code=$?

  if [[ $exit_code -eq 124 ]]; then
    fail_message "Timeout: '${description}' exceeded ${timeout_seconds} seconds."
    return 124
  fi

  return $exit_code
}
