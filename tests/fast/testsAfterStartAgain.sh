#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

# Reuse the primary start verification suite.
bash "$FAST_DIR/testsAfterStart.sh"

fast_load_state
fast_require_var "TEST_PERSIST_MARKER"
fast_require_var "TEST_PERSIST_FILE"

# Reset counter for additional persistence checks.
FAST_CHECK_ERRORS=0

fast_check "Persistence marker survived restart" fast_assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"
fast_check "Agent data file still present after restart" fast_assert_file_exists "$TEST_PERSIST_FILE"
fast_check "Agent data file retains initialization signature" fast_assert_file_contains "$TEST_PERSIST_FILE" "initialized"

# Dynamic configuration tests (no restart needed)
fast_info "Testing dynamic env variable propagation (no restart)"

fast_test_dynamic_app_name() {
  fast_load_state
  fast_require_var "TEST_RUN_DIR" || return 1
  fast_require_var "TEST_ROUTER_PORT" || return 1
  
  local secrets_file="$TEST_RUN_DIR/.ploinky/.secrets"
  local router_port="$TEST_ROUTER_PORT"
  
  # Save original APP_NAME if exists
  local original_app_name=""
  if grep -q "^APP_NAME=" "$secrets_file" 2>/dev/null; then
    original_app_name=$(grep "^APP_NAME=" "$secrets_file" | head -1 | cut -d= -f2-)
  fi
  
  # Test 1: Server responds before config change
  if ! curl -fsS "http://127.0.0.1:${router_port}/status/data" >/dev/null 2>&1; then
    echo "Server not responding before config change" >&2
    return 1
  fi
  
  # Test 2: Change APP_NAME
  local test_app_name="DynamicTestApp_$$"
  echo "APP_NAME=${test_app_name}" >> "$secrets_file"
  
  # Give it a moment to be picked up (TTL=0 means instant, but allow for request processing)
  sleep 0.5
  
  # Test 3: Server still responds after config change (proves no crash)
  local response
  if ! response=$(curl -fsS "http://127.0.0.1:${router_port}/status/data" 2>&1); then
    echo "Server not responding after APP_NAME change: ${response}" >&2
    # Restore original
    sed -i "/^APP_NAME=/d" "$secrets_file"
    if [[ -n "$original_app_name" ]]; then
      echo "APP_NAME=${original_app_name}" >> "$secrets_file"
    fi
    return 1
  fi
  
  # Test 4: Change APP_NAME again to different value
  local test_app_name2="DynamicTestApp2_$$"
  sed -i "/^APP_NAME=/d" "$secrets_file"
  echo "APP_NAME=${test_app_name2}" >> "$secrets_file"
  
  sleep 0.5
  
  # Test 5: Server still responds after second change
  if ! curl -fsS "http://127.0.0.1:${router_port}/status/data" >/dev/null 2>&1; then
    echo "Server not responding after second APP_NAME change" >&2
    # Restore original
    sed -i "/^APP_NAME=/d" "$secrets_file"
    if [[ -n "$original_app_name" ]]; then
      echo "APP_NAME=${original_app_name}" >> "$secrets_file"
    fi
    return 1
  fi
  
  # Restore original APP_NAME
  sed -i "/^APP_NAME=/d" "$secrets_file"
  if [[ -n "$original_app_name" ]]; then
    echo "APP_NAME=${original_app_name}" >> "$secrets_file"
  fi
  
  return 0
}

fast_test_dynamic_webtty_shell() {
  fast_load_state
  fast_require_var "TEST_RUN_DIR" || return 1
  fast_require_var "TEST_ROUTER_PORT" || return 1
  
  local secrets_file="$TEST_RUN_DIR/.ploinky/.secrets"
  local router_port="$TEST_ROUTER_PORT"
  
  # Save original WEBTTY_SHELL if exists
  local original_shell=""
  if grep -q "^WEBTTY_SHELL=" "$secrets_file" 2>/dev/null; then
    original_shell=$(grep "^WEBTTY_SHELL=" "$secrets_file" | head -1 | cut -d= -f2-)
  fi
  
  # Test 1: Server responds before config change
  if ! curl -fsS "http://127.0.0.1:${router_port}/webtty/" >/dev/null 2>&1; then
    echo "Server not responding before WEBTTY_SHELL change" >&2
    return 1
  fi
  
  # Test 2: Change WEBTTY_SHELL
  echo "WEBTTY_SHELL=/bin/sh" >> "$secrets_file"
  
  sleep 0.5
  
  # Test 3: Server still responds after config change
  if ! curl -fsS "http://127.0.0.1:${router_port}/webtty/" >/dev/null 2>&1; then
    echo "Server not responding after WEBTTY_SHELL change" >&2
    # Restore original
    sed -i "/^WEBTTY_SHELL=/d" "$secrets_file"
    if [[ -n "$original_shell" ]]; then
      echo "WEBTTY_SHELL=${original_shell}" >> "$secrets_file"
    fi
    return 1
  fi
  
  # Test 4: Change to different shell
  sed -i "/^WEBTTY_SHELL=/d" "$secrets_file"
  echo "WEBTTY_SHELL=/bin/bash" >> "$secrets_file"
  
  sleep 0.5
  
  # Test 5: Server still responds after second change
  if ! curl -fsS "http://127.0.0.1:${router_port}/webtty/" >/dev/null 2>&1; then
    echo "Server not responding after second WEBTTY_SHELL change" >&2
    # Restore original
    sed -i "/^WEBTTY_SHELL=/d" "$secrets_file"
    if [[ -n "$original_shell" ]]; then
      echo "WEBTTY_SHELL=${original_shell}" >> "$secrets_file"
    fi
    return 1
  fi
  
  # Restore original WEBTTY_SHELL
  sed -i "/^WEBTTY_SHELL=/d" "$secrets_file"
  if [[ -n "$original_shell" ]]; then
    echo "WEBTTY_SHELL=${original_shell}" >> "$secrets_file"
  fi
  
  return 0
}

fast_check "Dynamic APP_NAME update without restart" fast_test_dynamic_app_name
fast_check "Dynamic WEBTTY_SHELL update without restart" fast_test_dynamic_webtty_shell

fast_stage_header "Manifest Environment"
fast_check "Variable MY_TEST_VAR from manifest is present after start again" fast_assert_container_env "$TEST_SERVICE_CONTAINER" "MY_TEST_VAR" "hello-manifest"

fast_finalize_checks
