#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"
source "$FAST_DIR/test-functions/dynamic_configuration_tests.sh"

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

fast_check "Dynamic APP_NAME update without restart" fast_test_dynamic_app_name
fast_check "Dynamic WEBTTY_SHELL update without restart" fast_test_dynamic_webtty_shell
fast_check "Dynamic SSO_CLIENT_SECRET update without restart" fast_test_sso_client_secret_propagation

fast_stage_header "Manifest Environment"
fast_check "Variable MY_TEST_VAR from manifest is present after start again" fast_assert_container_env "$TEST_AGENT_CONT_NAME" "MY_TEST_VAR" "hello-manifest"

fast_finalize_checks
