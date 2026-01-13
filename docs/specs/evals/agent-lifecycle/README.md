# Agent Lifecycle Evaluations

## Overview

Evaluation scenarios for agent container lifecycle management. Tests cover the complete lifecycle from creation through termination, including health monitoring and error recovery.

## Scenarios

### Basic Lifecycle

#### agent-start-basic
Verify basic agent startup from manifest.

**Prerequisites**:
- Docker/Podman available
- Valid manifest.json

**Steps**:
1. Create minimal agent manifest
2. Run `ploinky start agent-name`
3. Verify container running
4. Check health endpoint responds

**Expected**: Agent starts within 30s, health check passes

---

#### agent-stop-graceful
Verify graceful agent shutdown.

**Prerequisites**:
- Running agent

**Steps**:
1. Run `ploinky stop agent-name`
2. Verify graceful shutdown signal sent
3. Confirm container stops
4. Verify no orphan processes

**Expected**: Clean shutdown within 10s

---

#### agent-restart
Verify agent restart preserves state.

**Prerequisites**:
- Running agent with persistent state

**Steps**:
1. Create stateful data in agent
2. Run `ploinky restart agent-name`
3. Verify state persisted after restart

**Expected**: State maintained across restart

### Health Monitoring

#### agent-health-success
Verify health check success reporting.

**Steps**:
1. Start healthy agent
2. Query health endpoint
3. Verify response format

**Expected**: `{"ok": true, "server": "ploinky-agent-mcp"}`

---

#### agent-health-failure
Verify health check failure detection.

**Steps**:
1. Start agent with failing health
2. Monitor status over time
3. Verify failure detected

**Expected**: Status shows unhealthy after timeout

### Error Recovery

#### agent-crash-restart
Verify automatic restart on crash.

**Steps**:
1. Start agent with supervisor
2. Cause agent process to crash
3. Verify automatic restart
4. Check restart count incremented

**Expected**: Agent restarts within 60s (per AgentServer.sh)

---

#### agent-oom-handling
Verify out-of-memory handling.

**Steps**:
1. Start agent with memory limit
2. Cause memory exhaustion
3. Verify container behavior
4. Check restart behavior

**Expected**: Container killed, supervisor restarts

### Container Management

#### agent-port-allocation
Verify port allocation and deallocation.

**Steps**:
1. Start multiple agents
2. Verify unique port assignment
3. Stop agents
4. Verify ports released

**Expected**: No port conflicts, clean release

---

#### agent-volume-mount
Verify volume mounting for workspace.

**Steps**:
1. Start agent with workspace mount
2. Create file in mounted path
3. Verify file accessible from host
4. Stop agent, verify file persists

**Expected**: Bidirectional file access

### Multi-Agent

#### agent-parallel-start
Verify multiple agents can start concurrently.

**Steps**:
1. Define 3 agent configurations
2. Start all simultaneously
3. Verify all reach running state
4. Check no resource conflicts

**Expected**: All agents running within 60s

## Test Matrix

| Scenario | Priority | Automation |
|----------|----------|------------|
| agent-start-basic | P0 | Automated |
| agent-stop-graceful | P0 | Automated |
| agent-restart | P1 | Automated |
| agent-health-success | P0 | Automated |
| agent-health-failure | P1 | Automated |
| agent-crash-restart | P1 | Manual |
| agent-oom-handling | P2 | Manual |
| agent-port-allocation | P1 | Automated |
| agent-volume-mount | P1 | Automated |
| agent-parallel-start | P2 | Automated |

## Related Specifications

- [../../DS/DS03-agent-model.md](../../DS/DS03-agent-model.md) - Agent Model
- [../../DS/DS11-container-runtime.md](../../DS/DS11-container-runtime.md) - Container Runtime
- [../../src/cli/services/docker/](../../src/cli/services/docker/) - Docker service docs
