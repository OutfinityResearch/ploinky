#!/bin/bash

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

load_state
require_var "TEST_RUN_DIR"
require_var "TEST_AGENT_WORKSPACE"

cd "$TEST_RUN_DIR"

test_check "Temporary workspace directory exists" assert_dir_exists "$TEST_RUN_DIR"
test_check "Repository directory created" assert_dir_exists "$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME"
test_check "Agent manifest present" assert_file_exists "$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME/$TEST_AGENT_NAME/manifest.json"
test_check "Agent entry registered" assert_agent_registered
test_check "Repository enabled flag recorded" assert_enabled_repo
test_check "Isolated agent workspace created" assert_dir_exists "$TEST_AGENT_WORKSPACE"

finalize_checks
