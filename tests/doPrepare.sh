#!/bin/bash
set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$TESTS_DIR/lib.sh"

test_info "Preparing isolated workspace for fast suite."

TEST_REPO_NAME="testRepo"
TEST_AGENT_NAME="testAgent"
TEST_AGENT_QUALIFIED="${TEST_REPO_NAME}/${TEST_AGENT_NAME}"
write_state_var "TEST_REPO_NAME" "$TEST_REPO_NAME"
write_state_var "TEST_AGENT_NAME" "$TEST_AGENT_NAME"
write_state_var "TEST_AGENT_QUALIFIED" "$TEST_AGENT_QUALIFIED"
TEST_AGENT_TO_DISABLE_NAME="agentToBeDisabled"
TEST_AGENT_TO_DISABLE_QUALIFIED="${TEST_REPO_NAME}/${TEST_AGENT_TO_DISABLE_NAME}"
write_state_var "TEST_AGENT_TO_DISABLE_NAME" "$TEST_AGENT_TO_DISABLE_NAME"
write_state_var "TEST_AGENT_TO_DISABLE_QUALIFIED" "$TEST_AGENT_TO_DISABLE_QUALIFIED"
write_state_var "TEST_AGENT_TO_DISABLE_SHOULD_START" "1"
write_state_var "TEST_AGENT_TO_DISABLE_EXPECT_RUNNING" "1"
TEST_AGENT_DEP_GLOBAL_NAME="testAgentDepGlobal"
write_state_var "TEST_AGENT_DEP_GLOBAL_NAME" "$TEST_AGENT_DEP_GLOBAL_NAME"
TEST_AGENT_DEP_DEVEL_NAME="testAgentDepDevel"
write_state_var "TEST_AGENT_DEP_DEVEL_NAME" "$TEST_AGENT_DEP_DEVEL_NAME"

if [[ -z "${TEST_RUN_DIR:-}" ]]; then
  TEST_RUN_DIR=$(mktemp -d -t ploinky-fast-XXXXXX)
  write_state_var "TEST_RUN_DIR" "$TEST_RUN_DIR"
fi

test_info "Workspace root: $TEST_RUN_DIR"

cd "$TEST_RUN_DIR"

if [[ -z "${FAST_CONTAINER_RUNTIME:-}" ]]; then
  runtime=$(detect_container_runtime)
  write_state_var "FAST_CONTAINER_RUNTIME" "$runtime"
  test_info "Detected container runtime: $runtime"
fi

router_port=$(allocate_port)
write_state_var "TEST_ROUTER_PORT" "$router_port"
test_info "Allocated router port: $router_port"

repo_root=".ploinky/repos/${TEST_REPO_NAME}"
agent_root="${repo_root}/${TEST_AGENT_NAME}"
mkdir -p "$agent_root"
test_info "Bootstrapped repository skeleton at ${agent_root}."

agent_host_port=$(allocate_port)
write_state_var "TEST_AGENT_HOST_PORT" "$agent_host_port"
test_info "Assigned host port ${agent_host_port} for ${TEST_AGENT_NAME}."

cat >"${agent_root}/manifest.json" <<EOF
{
  "container": "node:20-bullseye",
  "install": "echo 'install_ok' > ./install_marker.txt",
  "agent": "node /code/server.js",
  "enable": [
    "testAgentDepGlobal global",
    "testAgentDepDevel devel testRepo"
  ],
  "webchat" : "echo Hello",
  "env": {
    "FAST_TEST_MARKER": "fast-suite",
    "MY_TEST_VAR": "hello-manifest"
  },
  "ports": [
    "${agent_host_port}:7000"
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

# Provide a predictable static asset for router tests (served via /${TEST_AGENT_NAME}/...).
printf 'fast-static-ok' >"${agent_root}/fast-static.txt"
write_state_var "TEST_STATIC_ASSET_PATH" "/${TEST_AGENT_NAME}/fast-static.txt"
write_state_var "TEST_STATIC_ASSET_EXPECTED" "fast-static-ok"

# Agent used to exercise disable flows later in the suite
disable_agent_root="${repo_root}/${TEST_AGENT_TO_DISABLE_NAME}"
mkdir -p "$disable_agent_root"

cat >"${disable_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye",
  "agent": "node -e \"setInterval(()=>{}, 1_000_000)\""
}
EOF
# Dependency agent that will be enabled in global mode via manifest
dep_agent_root="${repo_root}/${TEST_AGENT_DEP_GLOBAL_NAME}"
mkdir -p "$dep_agent_root"

cat >"${dep_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye"
}
EOF

# Dependency agent that will be enabled in devel mode via manifest
dep_devel_root="${repo_root}/${TEST_AGENT_DEP_DEVEL_NAME}"
mkdir -p "$dep_devel_root"

cat >"${dep_devel_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye",
  "agent": "node -e \"setInterval(()=>{}, 1_000_000)\""
}
EOF

test_info "Enabling repository ${TEST_REPO_NAME}."
ploinky enable repo "$TEST_REPO_NAME"

test_info "Enabling repository demo."
ploinky enable repo demo

test_info "Enabling agent ${TEST_AGENT_QUALIFIED}."
ploinky enable agent "$TEST_AGENT_QUALIFIED"

test_info "Enabling agent ${TEST_AGENT_TO_DISABLE_QUALIFIED}."
ploinky enable agent "$TEST_AGENT_TO_DISABLE_QUALIFIED"

# Create a global agent for testing global mode
test_info "Creating global-agent."
GLOBAL_AGENT_NAME="global-agent"
write_state_var "TEST_GLOBAL_AGENT_NAME" "$GLOBAL_AGENT_NAME"
global_agent_root="${repo_root}/${GLOBAL_AGENT_NAME}"
mkdir -p "$global_agent_root"

global_agent_host_port=$(allocate_port)
write_state_var "TEST_GLOBAL_AGENT_HOST_PORT" "$global_agent_host_port"
test_info "Assigned host port ${global_agent_host_port} for ${GLOBAL_AGENT_NAME}."

cat >"${global_agent_root}/manifest.json" <<EOF
{
  "container": "node:20-bullseye",
  "ports": [
    "${global_agent_host_port}:7000"
  ]
}
EOF

test_info "Enabling agent ${GLOBAL_AGENT_NAME} in global mode."
ploinky enable agent "$GLOBAL_AGENT_NAME" global

# Create a devel agent for testing devel mode
test_info "Creating devel-agent."
DEVEL_AGENT_NAME="devel-agent"
write_state_var "TEST_DEVEL_AGENT_NAME" "$DEVEL_AGENT_NAME"
devel_agent_root="${repo_root}/${DEVEL_AGENT_NAME}"
mkdir -p "$devel_agent_root"

cat >"${devel_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye"
}
EOF

test_info "Enabling agent ${DEVEL_AGENT_NAME} in devel mode."
ploinky enable agent "${DEVEL_AGENT_NAME}" devel "${TEST_REPO_NAME}"

test_info "Setting workspace-only env var FAST_PLOINKY_ONLY"
ploinky var FAST_PLOINKY_ONLY host-secret-value

agent_container_name=$(compute_container_name "$TEST_AGENT_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_AGENT_CONT_NAME" "$agent_container_name"
test_info "Service container will be named: $agent_container_name"

disable_agent_container_name=$(compute_container_name "$TEST_AGENT_TO_DISABLE_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_AGENT_TO_DISABLE_CONT_NAME" "$disable_agent_container_name"
test_info "Disable-target container will be named: $disable_agent_container_name"

workspace_project="$TEST_RUN_DIR/$TEST_AGENT_NAME"
write_state_var "TEST_AGENT_WORKSPACE" "$workspace_project"
write_state_var "TEST_PERSIST_FILE" "$workspace_project/data/fast-persist.txt"
write_state_var "TEST_AGENT_LOG" "$workspace_project/fast-start.log"
write_state_var "TEST_PERSIST_MARKER" "$workspace_project/data/manual-marker.txt"
write_state_var "TEST_AGENT_CONTAINER_PORT" "7000"

mkdir -p "$workspace_project/data"

test_info "Preparation step complete."
