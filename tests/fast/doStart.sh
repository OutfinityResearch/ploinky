#!/bin/bash
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_load_state
fast_require_var "TEST_RUN_DIR"
fast_require_var "TEST_AGENT_NAME"
fast_require_var "TEST_ROUTER_PORT"
fast_require_var "TEST_SERVICE_CONTAINER"
fast_require_var "TEST_AGENT_WORKSPACE"
fast_require_var "TEST_PERSIST_MARKER"

cd "$TEST_RUN_DIR"

if [[ $# -ge 2 ]]; then
  fast_info "Starting workspace with specified agent $1 on port $2."
  ploinky start "$1" "$2"
else
  fast_info "Starting workspace with saved configuration."
  ploinky start
fi

fast_wait_for_router
fast_wait_for_agent_log_message "$TEST_AGENT_LOG" "listening"

fast_require_runtime
container_pid=$(fast_get_container_pid "$TEST_SERVICE_CONTAINER")
fast_write_state_var "TEST_LAST_KNOWN_PID" "$container_pid"
fast_info "Container ${TEST_SERVICE_CONTAINER} is running (pid ${container_pid})."

routing_file="$TEST_RUN_DIR/.ploinky/routing.json"
fast_wait_for_file "$routing_file" 40 0.25

agent_host_port="7000"
for _ in {1..10}; do
if agent_host_port=$(FAST_ROUTING_FILE="$routing_file" FAST_ROUTING_AGENT="$TEST_AGENT_NAME" node <<'NODE'
const fs = require('fs');

const routingPath = process.env.FAST_ROUTING_FILE;
const agentName = process.env.FAST_ROUTING_AGENT;

const raw = fs.readFileSync(routingPath, 'utf8');
const data = JSON.parse(raw || '{}');
const entry = (data.routes || {})[agentName] || {};
if (!entry.hostPort) {
  throw new Error('missing hostPort');
}
process.stdout.write(String(entry.hostPort));
NODE
); then
  if [[ -n "$agent_host_port" && "$agent_host_port" != "0" ]]; then
    break
  fi
fi
sleep 0.2
done

if [[ -z "$agent_host_port" || "$agent_host_port" == "0" ]]; then
  agent_host_port="7000"
fi

fast_write_state_var "TEST_AGENT_HOST_PORT" "$agent_host_port"
fast_write_state_var "TEST_AGENT_HEALTH_URL" "http://127.0.0.1:${agent_host_port}/health"
fast_write_state_var "TEST_ROUTER_LOG" "$TEST_RUN_DIR/logs/router.log"
fast_info "Agent host port resolved to ${agent_host_port}."

persist_marker="$TEST_PERSIST_MARKER"
if [[ ! -f "$persist_marker" ]]; then
  echo "first-run" >"$persist_marker"
fi

fast_mcp_start_demo() {
  ploinky start demo "$TEST_ROUTER_PORT"
  local container_name
  container_name=$(compute_container_name "demo")
  fast_wait_for_container "$container_name"
}
fast_action "Action: Starting demo agent..." fast_mcp_start_demo

fast_info "Start procedure completed."
