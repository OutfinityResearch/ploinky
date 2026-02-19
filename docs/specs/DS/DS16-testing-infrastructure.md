# DS16 - Testing Infrastructure

## Summary

Ploinky uses a multi-stage end-to-end (E2E) test suite implemented in Bash, combined with Node.js unit tests. The E2E suite orchestrates full workspace lifecycle operations (prepare → start → stop → restart → destroy) and verifies system state at each stage. CI/CD pipelines run the suite daily against both Docker and Podman runtimes.

## Background / Problem Statement

A container orchestration platform requires:
- Full lifecycle testing (create, start, stop, restart, destroy)
- Container runtime verification (Docker and Podman)
- Network, port, and authentication testing
- State persistence verification across restarts
- Regression testing for CLI commands, web interfaces, and MCP protocol

## Goals

1. **Lifecycle Coverage**: Test complete workspace lifecycle through all stages
2. **Runtime Parity**: Verify identical behavior on Docker and Podman
3. **Modular Test Functions**: Reusable test modules sourced by stage scripts
4. **CI/CD Integration**: Automated daily runs with artifact collection

## Non-Goals

- Performance benchmarking
- Load testing or stress testing
- Browser-level UI testing (Selenium, Playwright)
- Code coverage reporting

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                      TEST ORCHESTRATOR                          │
│                     tests/test_all.sh                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Stage 1: PREPARE  →  Stage 2: START  →  Stage 3: STOP  │  │
│  │  Stage 4: START AGAIN  →  Stage 5: RESTART  →           │  │
│  │  Stage 6: DESTROY  →  Stage 7: NODE UNIT TESTS          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                    │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    tests/lib.sh                           │  │
│  │  - State management (write_state_var, load_state)         │  │
│  │  - Assertions (test_check, assert_*)                      │  │
│  │  - Container operations                                    │  │
│  │  - Network testing                                         │  │
│  │  - HTTP operations                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                    │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              tests/test-functions/ (32 modules)            │  │
│  │  agent_blob_upload, cli_variable_commands, mcp_tests,     │  │
│  │  webchat_tests, sso_test_suite, health_probes, ...        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Data Models

### Test State

State is persisted between stages via a temporary env file:

```bash
# /tmp/fast-suite-state-XXXXXX.env
TEST_RUN_DIR="/tmp/ploinky-test-abc123"
TEST_AGENT_CONT_NAME="ploinky_basic_testAgent_a1b2c3"
TEST_ROUTER_PORT="12345"
TEST_AGENT_HOST_PORT="12346"
TEST_PERSIST_MARKER="/tmp/ploinky-test-abc123/agents/testAgent/persist-marker"
TEST_PERSIST_FILE="/tmp/ploinky-test-abc123/agents/testAgent/data.json"
TEST_ROUTER_LOG="/tmp/ploinky-test-abc123/logs/router.log"
TEST_REPO_NAME="basic"
```

### Test Results

```bash
# tests/lastRun.results
[PASS] Container exists after stop
[PASS] Container is no longer running
[FAIL] Router port 12345 closed
[PASS] Agent data file retained
```

### Test Agent (tests/testAgent/)

```json
// manifest.json
{
  "name": "testAgent",
  "image": "node:22-alpine",
  "run": "node server.js",
  "expose": ["7000"],
  "health": {
    "readiness": {
      "script": "healthcheck.sh",
      "interval": 1,
      "timeout": 5
    }
  },
  "profiles": {
    "dev": { "mounts": { "code": "rw" } },
    "prod": { "mounts": { "code": "ro" } }
  }
}
```

## Behavioral Specification

### Test Lifecycle Stages

#### Stage 1: PREPARE

- **Script**: `doPrepare.sh`
- **Verification**: `testsAfterPrepare.sh`
- **Actions**:
  - Create temporary workspace directory
  - Initialize `.ploinky/` structure
  - Clone test repositories (with optional branch override)
  - Create test agent manifests
  - Set up routing configuration
  - Prepare persistence markers

#### Stage 2: START

- **Script**: `doStart.sh`
- **Verification**: `testsAfterStart.sh` (sources 24 test function modules)
- **Timeout**: 420 seconds (extended for in-container dependency installation)
- **Actions**:
  - Start workspace (`ploinky start`)
  - Wait for containers to be running
  - Wait for router to be serving
  - Run all post-start verification tests
- **Verifies**: Container status, port bindings, health endpoints, MCP protocol, web interfaces, routing, dependencies, symlinks, environment variables

#### Stage 3: STOP

- **Script**: `doStop.sh`
- **Verification**: `testsAfterStop.sh`
- **Actions**: Stop workspace (`ploinky stop`)
- **Verifies**: Containers exist but stopped, ports closed, persistence retained, shutdown logged

#### Stage 4: START AGAIN

- **Script**: `doStart.sh` (reused)
- **Verification**: `testsAfterStartAgain.sh`
- **Verifies**: State restoration, persistent data intact, fresh boot functional

#### Stage 5: RESTART

- **Script**: `doRestart.sh`
- **Verification**: `testsAfterRestart.sh`
- **Actions**: Restart workspace (`ploinky restart`)
- **Verifies**: Service recovery, persistent data retention

#### Stage 6: DESTROY

- **Script**: `doDestroy.sh`
- **Verification**: `testsAfterDestroy.sh`
- **Actions**:
  - Disable test agent
  - Destroy workspace (`ploinky destroy`)
  - Delete temporary directory
- **Verifies**: Agent removed from registry, containers removed, workspace deleted, logs removed

#### Stage 7: NODE UNIT TESTS

- **Runner**: `run_node_unit_tests()` in `test_all.sh`
- **Engine**: Node.js native `node:test` module
- **Files**: `tests/unit/*.test.js` and `*.test.mjs`

### Test Function Modules (32 files)

Located in `tests/test-functions/`, each module defines `fast_*` functions sourced by stage scripts:

| Module | Coverage Area |
|--------|---------------|
| `agent_blob_upload_and_download.sh` | Blob API upload/download |
| `check_preinstall_run.sh` | Preinstall/install hooks |
| `cli_variable_commands.sh` | `var`, `vars`, `echo`, `expose` commands |
| `dashboard_tests.sh` | Dashboard UI serving |
| `default_cli_tests.sh` | Core CLI functionality |
| `demo_agent_dependency_tests.sh` | Agent dependencies and MCP |
| `demo_agent_dir_perm.sh` | Directory permissions (ro/rw) |
| `devel_agent_verification.sh` | Development agent workspaces |
| `disable_repo_test.sh` | Agent/repo disabling |
| `dynamic_configuration_tests.sh` | Runtime config changes |
| `enable_alias_tests.sh` | Agent aliasing |
| `global_agent_verification.sh` | Global agent installation |
| `health_probes_negative.sh` | Health probe failure scenarios |
| `install_command_verification.sh` | Install command execution |
| `llm_cli_suggestions.sh` | LLM CLI suggestion features |
| `logs_commands.sh` | `logs tail`, `logs last` |
| `manifest_ports_test.sh` | Port configuration |
| `mcp_tests.sh` | MCP protocol, tool calls, async tasks |
| `postinstall_test.sh` | Postinstall hooks |
| `router_static_assets.sh` | Static asset serving |
| `router_var_check.sh` | Dynamic variable routing |
| `routingserver_aggregation_test.sh` | Router aggregation |
| `setup_keycloak_for_testing.sh` | Keycloak SSO setup |
| `sso_test_suite.sh` | Comprehensive SSO testing |
| `test_sso_components.sh` | SSO component tests |
| `test_sso_params.sh` | SSO parameter tests |
| `volume_mount_tests.sh` | Volume mount verification |
| `watchdog_restart_services.sh` | Watchdog service restart |
| `webchat_tests.sh` | WebChat interface |
| `webmeet_tests.sh` | WebMeet interface |
| `webtty_command.sh` | WebTTY functionality |
| `workspace_status_command.sh` | Workspace status reporting |

### Unit Tests (9 files)

| File | Description |
|------|-------------|
| `profileSystem.test.mjs` | Profile system, secrets, workspace structure |
| `wildcardEnv.test.mjs` | Wildcard environment variable resolution |
| `wildcardEnvIntegration.test.mjs` | Env var expansion across services |
| `coralAgentManifest.test.mjs` | Wildcard env in coral-agent manifest |
| `taskQueue.test.mjs` | Task queue functionality |
| `healthProbes.test.js` | Health probe behavior |
| `watchdog.test.js` | Watchdog restart logic |
| `paramParser.test.mjs` | Parameter string parsing |
| `wildcardDemo.mjs` | Wildcard environment demo/test |

## API Contracts

### Test Library (tests/lib.sh)

#### State Management

| Function | Description |
|----------|-------------|
| `write_state_var(name, value)` | Persist variable to state file |
| `load_state()` | Load all variables from state file |
| `require_var(name)` | Assert variable is set; fail if not |

#### Assertions

| Function | Description |
|----------|-------------|
| `test_check(label, fn, args...)` | Run assertion, report pass/fail |
| `test_action(label, fn)` | Run action, fail test suite on error |
| `test_info(message)` | Log informational message |
| `assert_container_running(name)` | Verify container is running |
| `assert_container_stopped(name)` | Verify container is stopped |
| `assert_container_exists(name)` | Verify container exists |
| `assert_container_absent(name)` | Verify container removed |
| `assert_container_env(name, key, value)` | Verify env var in container |
| `assert_port_listening(port)` | Verify TCP port is open |
| `assert_port_not_listening(port)` | Verify TCP port is closed |
| `assert_file_exists(path)` | Verify file exists |
| `assert_file_not_exists(path)` | Verify file absent |
| `assert_file_contains(path, pattern)` | Grep file for pattern |
| `assert_file_content_equals(path, expected)` | Exact content match |
| `assert_http_response_contains(url, pattern)` | HTTP GET response check |
| `assert_router_status_ok()` | Verify router `/health` endpoint |

#### Utilities

| Function | Description |
|----------|-------------|
| `detect_container_runtime()` | Auto-detect docker or podman |
| `require_runtime()` | Ensure container runtime available |
| `compute_container_name(agent, repo)` | Generate expected container name |
| `allocate_port()` | Find available TCP port |
| `run_with_timeout(timeout, fn)` | Execute with timeout |
| `wait_for_container(name, timeout)` | Poll until container is running |
| `wait_for_router(port, timeout)` | Poll until router responds |
| `wait_for_file(path, timeout)` | Poll until file exists |
| `enable_repo_with_branch(repo, branch)` | Enable repo at specific branch |

## Configuration

### Timeout Configuration

| Timeout | Value | Purpose |
|---------|-------|---------|
| `ACTION_TIMEOUT` | 240s | Default action timeout |
| `VERIFY_TIMEOUT` | 180s | Default verification timeout |
| `START_ACTION_TIMEOUT` | 420s | Start stage (includes dependency install) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CONTAINER_RUNTIME` | Override auto-detected runtime (`docker` or `podman`) |
| `FAST_STATE_FILE` | Custom state file path |
| `FAST_RESULTS_FILE` | Custom results file path |
| `PLOINKY_BASIC_BRANCH` | Branch override for basic repo |
| `PLOINKY_CLOUD_BRANCH` | Branch override for cloud repo |
| `PLOINKY_VIBE_BRANCH` | Branch override for vibe repo |
| `PLOINKY_SECURITY_BRANCH` | Branch override for security repo |
| `PLOINKY_EXTRA_BRANCH` | Branch override for extra repo |
| `PLOINKY_DEMO_BRANCH` | Branch override for demo repo |

### CI/CD Workflows

#### tests-docker.yml

- **Trigger**: Daily at 3:00 AM UTC + manual dispatch
- **Runner**: Ubuntu 24.04
- **Runtime**: Docker
- **Node**: v22
- **Artifacts**: Test logs uploaded
- **Report**: Auto-commits results to repository

#### tests-podman.yml

- **Trigger**: Daily at 3:30 AM UTC + manual dispatch
- **Runner**: Ubuntu 24.04 (with podman)
- **Runtime**: Podman
- **Node**: v22
- **Artifacts**: Test logs uploaded
- **Report**: Auto-commits results to repository

### Pre-Built Test Agents

Located in `tests/.ploinky/repos/basic/`, providing 18 agent manifests for testing:

alpine-bash, debian-bash, fedora-bash, rocky-bash, ubuntu-bash, clamav-scanner, curl-agent, docker-agent, github-cli-agent, gitlab-cli-agent, keycloak, node-dev, postgres, postman-cli, puppeteer-agent, shell

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stage action times out | Fail with timeout message, continue to destroy |
| Container runtime not found | Skip tests, report as error |
| Port allocation fails | Retry with different random port |
| Test function fails | Record failure, continue remaining tests |
| SIGINT during test run | Graceful cleanup: stop containers, delete temp directory |
| Stage dependency fails | Skip dependent stages |

## Success Criteria

1. Full lifecycle (prepare → start → stop → start-again → restart → destroy) passes
2. Tests pass on both Docker and Podman runtimes
3. CI/CD runs daily with artifact collection
4. All 32 test function modules execute without infrastructure failures
5. Unit tests pass via `node:test` runner

## References

- [DS03 - Agent Model](./DS03-agent-model.md) - Agent lifecycle under test
- [DS05 - CLI Commands](./DS05-cli-commands.md) - CLI commands under test
- [DS11 - Container Runtime](./DS11-container-runtime.md) - Container operations under test
- [DS13 - Watchdog & Reliability](./DS13-watchdog-reliability.md) - Watchdog tests
