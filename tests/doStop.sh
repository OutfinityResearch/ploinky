#!/bin/bash
set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

load_state
require_var "TEST_RUN_DIR"
require_var "TEST_AGENT_CONT_NAME"
require_var "TEST_AGENT_NAME"

cd "$TEST_RUN_DIR"

test_info "Stopping workspace for ${TEST_AGENT_NAME}."
ploinky stop

wait_for_container_stop "$TEST_AGENT_CONT_NAME"

test_info "Stop procedure completed."
