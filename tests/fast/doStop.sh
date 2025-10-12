#!/bin/bash
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_SERVICE_CONTAINER"
fast_require_var "TEST_AGENT_NAME"

cd "$TEST_RUN_DIR"

fast_info "Stopping workspace for ${TEST_AGENT_NAME}."
ploinky stop

fast_wait_for_container_stop "$TEST_SERVICE_CONTAINER"

fast_info "Stop procedure completed."
