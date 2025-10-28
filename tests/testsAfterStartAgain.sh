#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"
source "$TESTS_DIR/test-functions/dynamic_configuration_tests.sh"

# Reuse the primary start verification suite.
bash "$TESTS_DIR/testsAfterStart.sh"

load_state
require_var "TEST_PERSIST_MARKER"
require_var "TEST_PERSIST_FILE"

# Reset counter for additional persistence checks.
FAST_CHECK_ERRORS=0

test_check "Persistence marker survived restart" assert_file_content_equals "$TEST_PERSIST_MARKER" "first-run"
test_check "Agent data file still present after restart" assert_file_exists "$TEST_PERSIST_FILE"
test_check "Agent data file retains initialization signature" assert_file_contains "$TEST_PERSIST_FILE" "initialized"

# Dynamic configuration tests (no restart needed)
test_info "Testing dynamic env variable propagation (no restart)"

test_check "Dynamic APP_NAME update without restart" fast_test_dynamic_app_name
test_check "Dynamic WEBTTY_SHELL update without restart" fast_test_dynamic_webtty_shell
test_check "Dynamic SSO_CLIENT_SECRET update without restart" fast_test_sso_client_secret_propagation

stage_header "Manifest Environment"
test_check "Variable MY_TEST_VAR from manifest is present after start again" assert_container_env "$TEST_AGENT_CONT_NAME" "MY_TEST_VAR" "hello-manifest"

finalize_checks
