#!/bin/bash
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$FAST_DIR/lib.sh"

fast_info "Preparing isolated workspace for fast suite."

TEST_REPO_NAME="testRepo"
TEST_AGENT_NAME="testAgent"
TEST_AGENT_QUALIFIED="${TEST_REPO_NAME}/${TEST_AGENT_NAME}"
fast_write_state_var "TEST_REPO_NAME" "$TEST_REPO_NAME"
fast_write_state_var "TEST_AGENT_NAME" "$TEST_AGENT_NAME"
fast_write_state_var "TEST_AGENT_QUALIFIED" "$TEST_AGENT_QUALIFIED"

if [[ -z "${TEST_RUN_DIR:-}" ]]; then
  TEST_RUN_DIR=$(mktemp -d -t ploinky-fast-XXXXXX)
  fast_write_state_var "TEST_RUN_DIR" "$TEST_RUN_DIR"
fi

fast_info "Workspace root: $TEST_RUN_DIR"

cd "$TEST_RUN_DIR"

if [[ -z "${FAST_CONTAINER_RUNTIME:-}" ]]; then
  runtime=$(fast_detect_container_runtime)
  fast_write_state_var "FAST_CONTAINER_RUNTIME" "$runtime"
  fast_info "Detected container runtime: $runtime"
fi

router_port=$(fast_allocate_port)
fast_write_state_var "TEST_ROUTER_PORT" "$router_port"
fast_info "Allocated router port: $router_port"

repo_root=".ploinky/repos/${TEST_REPO_NAME}"
agent_root="${repo_root}/${TEST_AGENT_NAME}"
mkdir -p "$agent_root"
fast_info "Bootstrapped repository skeleton at ${agent_root}."

cat >"${agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye",
  "agent": "node /code/server.js",
  "env": {
    "FAST_TEST_MARKER": "fast-suite"
  },
  "ports": [
    "7001:7000"
  ]
}
EOF

cat >"${agent_root}/server.js" <<'EOF'
const http = require('http');
const fs = require('fs');
const path = require('path');

const agentName = process.env.AGENT_NAME || 'unknown-agent';
const port = Number(process.env.PORT || 7000);
const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
const logPath = path.join(workspacePath, 'fast-start.log');
const dataDir = path.join(workspacePath, 'data');
const dataFile = path.join(dataDir, 'fast-persist.txt');

try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] boot ${agentName}\n`); } catch (_) {}
try { fs.writeFileSync(dataFile, `initialized:${agentName}`); } catch (_) {}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: agentName }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('fast-suite');
});

server.listen(port, '0.0.0.0', () => {
  try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] listening:${port}\n`); } catch (_) {}
});
EOF

fast_info "Enabling repository ${TEST_REPO_NAME}."
ploinky enable repo "$TEST_REPO_NAME"

fast_info "Enabling repository demo."
ploinky enable repo demo

fast_info "Enabling agent ${TEST_AGENT_QUALIFIED}."
ploinky enable agent "$TEST_AGENT_QUALIFIED"

service_container=$(compute_container_name "$TEST_AGENT_NAME")
fast_write_state_var "TEST_SERVICE_CONTAINER" "$service_container"
fast_info "Service container will be named: $service_container"

workspace_project="$TEST_RUN_DIR/$TEST_AGENT_NAME"
fast_write_state_var "TEST_AGENT_WORKSPACE" "$workspace_project"
fast_write_state_var "TEST_PERSIST_FILE" "$workspace_project/data/fast-persist.txt"
fast_write_state_var "TEST_AGENT_LOG" "$workspace_project/fast-start.log"
fast_write_state_var "TEST_PERSIST_MARKER" "$workspace_project/data/manual-marker.txt"

mkdir -p "$workspace_project/data"

fast_info "Preparation step complete."
