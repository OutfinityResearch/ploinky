#!/bin/bash

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_CONT_NAME"
fast_require_var "TEST_AGENT_LOG"
fast_require_var "TEST_PERSIST_MARKER"
fast_require_var "TEST_ROUTER_LOG_SNAPSHOT"
fast_require_var "TEST_ROUTER_PORT"
fast_require_var "TEST_AGENT_TO_DISABLE_NAME"
fast_require_var "TEST_AGENT_TO_DISABLE_CONT_NAME"
fast_require_var "TEST_REPO_NAME"

fast_require_runtime

disable_agent() {
    ( cd "$TEST_RUN_DIR" && ploinky disable agent "$TEST_AGENT_TO_DISABLE_NAME" )
  }

fast_action "Action: Disabling agent ${TEST_AGENT_TO_DISABLE_NAME}" disable_agent

assert_agent_removed_from_registry() {
  local agent_name="$1"
  local repo_name="$2"
  local container_name
  if ! container_name=$(compute_container_name "$agent_name" "$repo_name"); then
    echo "Failed to compute container name for '${repo_name}/${agent_name}'." >&2
    return 1
  fi
  if grep -Fq "$container_name" "$TEST_RUN_DIR/.ploinky/agents"; then
    echo "Registry still contains container '${container_name}'." >&2
    return 1
  fi
}

fast_check "${TEST_AGENT_TO_DISABLE_NAME} no longer in agents registry" assert_agent_removed_from_registry "$TEST_AGENT_TO_DISABLE_NAME" "$TEST_REPO_NAME"
fast_check "Router log snapshot records shutdown" fast_check_router_stop_entry "$TEST_ROUTER_LOG_SNAPSHOT" "$TEST_ROUTER_PORT" "TEST_ROUTER_DESTROY_LAST_ENTRY" "${TEST_ROUTER_STOP_LAST_ENTRY:-}"
fast_check "RoutingServer process stopped" fast_assert_routing_server_stopped
fast_check "Test agent container removed" fast_assert_container_absent "$TEST_AGENT_CONT_NAME"

# Move out of the workspace before deleting the directory.
cd "$FAST_DIR"
rm -rf "$TEST_RUN_DIR"
fast_info "Destroy procedure completed."

fast_check "Temporary workspace directory deleted" fast_assert_file_not_exists "$TEST_RUN_DIR"
fast_check "Agent log removed with workspace" fast_assert_file_not_exists "$TEST_AGENT_LOG"
fast_check "Persistence marker removed with workspace" fast_assert_file_not_exists "$TEST_PERSIST_MARKER"

fast_finalize_checks
