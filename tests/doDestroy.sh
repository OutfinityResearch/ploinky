#!/bin/bash
set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_NAME"
fast_require_var "TEST_ROUTER_LOG"

cd "$TEST_RUN_DIR"

fast_info "Destroying workspace for ${TEST_AGENT_NAME}."
if ! timeout 60s ploinky destroy; then
    fast_fail "ploinky destroy command failed or timed out after 60 seconds."
fi

router_log_snapshot=""
if [[ -f "$TEST_ROUTER_LOG" ]]; then
    router_log_snapshot=$(mktemp "${TMPDIR:-/tmp}/fast-router-log-XXXXXX.log")
    if ! cp "$TEST_ROUTER_LOG" "$router_log_snapshot" 2>/dev/null; then
        router_log_snapshot=""
    fi
fi
fast_write_state_var "TEST_ROUTER_LOG_SNAPSHOT" "$router_log_snapshot"