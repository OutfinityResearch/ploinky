# Fast CLI Integration Suite

## Overview

Documents the fast CLI integration suite driven by `tests/test_all.sh` and `tests/run-all.sh`. The suite boots an isolated workspace, enables demo repos, starts core agents, and validates runtime behavior across start/stop/restart flows.

## Scope

- Workspace setup: `tests/doPrepare.sh`
- Start/stop lifecycle: `tests/doStart.sh`, `tests/doStop.sh`, `tests/doRestart.sh`
- Post-start validations: `tests/testsAfterStart.sh`

## Demo Agent Dependency Checks

**Purpose**: Ensure the demo explorer agent installs runtime dependencies into the agent work directory before the agent process runs.

**Test Hook**: `fast_check_explorer_dependencies`

**Locations**:
- `tests/test-functions/demo_agent_dependency_tests.sh`
- `tests/testsAfterStart.sh`

**Assertions**:
- Explorer container is running.
- `mcp-sdk` exists at `/code/node_modules/mcp-sdk` inside the explorer container (mounted from `$CWD/agents/<agent>/node_modules`).

**Failure Signals**:
- Missing `mcp-sdk` indicates dependency installation did not occur before the agent start command, which will surface as module resolution errors.

## Timeouts

The start stage allows a longer action timeout (240s) to accommodate dependency installation (git + build tooling) before the demo agents start.
