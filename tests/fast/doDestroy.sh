#!/bin/bash
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_NAME"

cd "$TEST_RUN_DIR"

fast_info "Destroying workspace for ${TEST_AGENT_NAME}."
if ! timeout 60s ploinky destroy; then
    fast_fail "ploinky destroy command failed or timed out after 60 seconds."
fi

# Move out of the workspace before deleting the directory.
cd "$FAST_DIR"

rm -rf "$TEST_RUN_DIR"
fast_write_state_var "TEST_RUN_DIR" "$TEST_RUN_DIR"
fast_write_state_var "TEST_RUN_DIR_REMOVED" "1"

fast_info "Destroy procedure completed."
