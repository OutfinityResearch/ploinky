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
HEALTH_AGENT_NAME="healthProbes"
write_state_var "TEST_HEALTH_AGENT_NAME" "$HEALTH_AGENT_NAME"
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
ENABLE_ALIAS_AGENT_NAME="enableAliasAgent"
ENABLE_ALIAS_AGENT_ALIAS="aliasAgent"
write_state_var "TEST_ENABLE_ALIAS_AGENT_NAME" "$ENABLE_ALIAS_AGENT_NAME"
write_state_var "TEST_ENABLE_ALIAS_AGENT_ALIAS" "$ENABLE_ALIAS_AGENT_ALIAS"

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
write_state_var "TEST_AGENT_REPO_PATH" "$agent_root"

agent_host_port=$(allocate_port)
write_state_var "TEST_AGENT_HOST_PORT" "$agent_host_port"
test_info "Assigned host port ${agent_host_port} for ${TEST_AGENT_NAME}."

manifest_template="${TESTS_DIR}/testAgent/manifest.json"
script_template="${TESTS_DIR}/testAgent/testSSOParams.sh"

sed "s/__HOST_PORT__/${agent_host_port}/g" "$manifest_template" >"${agent_root}/manifest.json"
cp "$script_template" "${agent_root}/testSSOParams.sh"
chmod +x "${agent_root}/testSSOParams.sh"

cp "${TESTS_DIR}/testAgent/server.js" "${agent_root}/server.js"
cp "${TESTS_DIR}/testAgent/mock_shell.sh" "${agent_root}/mock_shell.sh"

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
# Agent used to verify health probe behaviour
health_agent_root="${repo_root}/${HEALTH_AGENT_NAME}"
mkdir -p "$health_agent_root"
write_state_var "TEST_HEALTH_AGENT_REPO_PATH" "$health_agent_root"

cat >"${health_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye",
  "agent": "node -e \"setInterval(()=>{}, 1_000_000)\"",
  "health": {
    "liveness": {
      "script": "liveness_probe.sh",
      "interval": 0.2,
      "timeout": 1,
      "failureThreshold": 1,
      "successThreshold": 1
    },
    "readiness": {
      "script": "readiness_probe.sh",
      "interval": 0.2,
      "timeout": 1,
      "failureThreshold": 1,
      "successThreshold": 1
    }
  }
}
EOF

cat >"${health_agent_root}/liveness_probe.sh" <<'EOF'
#!/bin/sh
echo live
EOF

cat >"${health_agent_root}/readiness_probe.sh" <<'EOF'
#!/bin/sh
echo ready
EOF

chmod +x "${health_agent_root}/liveness_probe.sh" "${health_agent_root}/readiness_probe.sh"
# Dependency agent that will be enabled in global mode via manifest
dep_agent_root="${repo_root}/${TEST_AGENT_DEP_GLOBAL_NAME}"
mkdir -p "$dep_agent_root"

cat >"${dep_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye",
  "postinstall": "echo 'postinstall_ok' > ./postinstall_marker.txt"
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

# Agent used to verify manifest-enable alias support
enable_alias_agent_root="${repo_root}/${ENABLE_ALIAS_AGENT_NAME}"
mkdir -p "$enable_alias_agent_root"

cat >"${enable_alias_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye"
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

test_info "Enabling agent ${TEST_REPO_NAME}/${HEALTH_AGENT_NAME}."
ploinky enable agent "${TEST_REPO_NAME}/${HEALTH_AGENT_NAME}"

test_info "Enabling alias test agent ${ENABLE_ALIAS_AGENT_NAME} as ${ENABLE_ALIAS_AGENT_ALIAS}."
ploinky enable agent "${ENABLE_ALIAS_AGENT_NAME}" as "$ENABLE_ALIAS_AGENT_ALIAS"
alias_agent_container=$(compute_container_name "$ENABLE_ALIAS_AGENT_ALIAS" "$TEST_REPO_NAME")
write_state_var "TEST_ENABLE_ALIAS_AGENT_CONTAINER" "$alias_agent_container"

# Create a global agent for testing global mode
test_info "Creating global-agent."
GLOBAL_AGENT_NAME="global-agent"
write_state_var "TEST_GLOBAL_AGENT_NAME" "$GLOBAL_AGENT_NAME"
global_agent_root="${repo_root}/${GLOBAL_AGENT_NAME}"
mkdir -p "$global_agent_root"

global_agent_host_port=$(allocate_port)
write_state_var "TEST_GLOBAL_AGENT_HOST_PORT" "$global_agent_host_port"
test_info "Assigned host port ${global_agent_host_port} for ${GLOBAL_AGENT_NAME}."

global_agent_internal_port=8888
write_state_var "TEST_GLOBAL_AGENT_CONTAINER_PORT" "$global_agent_internal_port"

cat >"${global_agent_root}/manifest.json" <<EOF
{
  "container": "node:18-alpine",
  "ports": [
    "127.0.0.1:${global_agent_host_port}:${global_agent_internal_port}"
  ],
  "env": {
    "PORT": "${global_agent_internal_port}"
  }
}
EOF

test_info "Enabling agent ${GLOBAL_AGENT_NAME} in global mode."
ploinky enable agent "$GLOBAL_AGENT_NAME" global
global_agent_container=$(compute_container_name "$GLOBAL_AGENT_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_GLOBAL_AGENT_CONT_NAME" "$global_agent_container"

# Agent whose alias will be enabled via manifest directives
GLOBAL_ALIAS_AGENT_NAME="globalAgentForAlias"
GLOBAL_ALIAS_AGENT_ALIAS="globalAgentAlias"
write_state_var "TEST_GLOBAL_ALIAS_AGENT_NAME" "$GLOBAL_ALIAS_AGENT_NAME"
write_state_var "TEST_GLOBAL_AGENT_ALIAS" "$GLOBAL_ALIAS_AGENT_ALIAS"
global_alias_agent_root="${repo_root}/${GLOBAL_ALIAS_AGENT_NAME}"
mkdir -p "$global_alias_agent_root"

cat >"${global_alias_agent_root}/manifest.json" <<'EOF'
{
  "container": "node:20-bullseye"
}
EOF

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

test_info "Setting var testVar"
ploinky var testVar "123"

agent_container_name=$(compute_container_name "$TEST_AGENT_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_AGENT_CONT_NAME" "$agent_container_name"
test_info "Service container will be named: $agent_container_name"

disable_agent_container_name=$(compute_container_name "$TEST_AGENT_TO_DISABLE_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_AGENT_TO_DISABLE_CONT_NAME" "$disable_agent_container_name"
test_info "Disable-target container will be named: $disable_agent_container_name"

health_agent_container_name=$(compute_container_name "$HEALTH_AGENT_NAME" "$TEST_REPO_NAME")
write_state_var "TEST_HEALTH_AGENT_CONT_NAME" "$health_agent_container_name"
test_info "Health probe container will be named: $health_agent_container_name"

workspace_project="$TEST_RUN_DIR/$TEST_AGENT_NAME"
write_state_var "TEST_AGENT_WORKSPACE" "$workspace_project"
write_state_var "TEST_PERSIST_FILE" "$workspace_project/data/fast-persist.txt"
write_state_var "TEST_AGENT_LOG" "$workspace_project/fast-start.log"
write_state_var "TEST_PERSIST_MARKER" "$workspace_project/data/manual-marker.txt"
write_state_var "TEST_AGENT_CONTAINER_PORT" "7000"

mkdir -p "$workspace_project/data"

test_info "Preparation step complete."
