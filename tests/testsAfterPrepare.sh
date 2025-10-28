#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_WORKSPACE"

cd "$TEST_RUN_DIR"

fast_check "Temporary workspace directory exists" fast_assert_dir_exists "$TEST_RUN_DIR"
fast_check "Repository directory created" fast_assert_dir_exists "$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME"
fast_check "Agent manifest present" fast_assert_file_exists "$TEST_RUN_DIR/.ploinky/repos/$TEST_REPO_NAME/$TEST_AGENT_NAME/manifest.json"
fast_check "Agent entry registered" fast_assert_agent_registered
fast_check "Repository enabled flag recorded" fast_assert_enabled_repo
fast_check "Isolated agent workspace created" fast_assert_dir_exists "$TEST_AGENT_WORKSPACE"

fast_finalize_checks
