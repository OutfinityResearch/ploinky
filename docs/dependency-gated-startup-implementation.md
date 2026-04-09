# Dependency-Gated Workspace Startup

## Summary

This document describes the implementation that makes Ploinky wait for the
static agent's full recursive dependency graph before launching the workspace
Router/Watchdog.

The change does **not** replace the existing readiness probe engine. Instead,
it refactors workspace startup to:

1. Resolve the static agent's recursive `manifest.enable` graph.
2. Enable missing dependency nodes.
3. Start dependency nodes in topological waves.
4. Wait for each wave to become ready.
5. Start and wait for the static agent.
6. Launch the Router/Watchdog only after the graph is ready.

## Problem Being Solved

Before this change, `startWorkspace()` started all enabled agents first and
then waited for readiness afterward. That had three problems:

1. The static agent could start before its dependencies were ready.
2. Readiness tracking only covered the static agent and its direct
   dependencies.
3. Protocol inference for readiness drifted away from actual startup behavior.

The result was that startup order and startup readiness were only loosely
related.

During integration work, one extra runtime mismatch surfaced as well:

4. Container-backed `start`-only agents still launched the default
   AgentServer sidecar, even when the manifest did not define an explicit
   `agent` command.

That could make readiness succeed against the wrong process and could also take
the published port away from the real TCP service. The container runtime was
updated so sidecars are launched only when the manifest explicitly defines both
`start` and `agent`.

## Files Added

- `cli/services/startupReadiness.js`
- `cli/services/workspaceDependencyGraph.js`
- `tests/test-functions/workspace_dependency_startup_tests.sh`
- `tests/unit/startupReadiness.test.mjs`
- `tests/unit/workspaceDependencyGraph.test.mjs`

## Files Changed

- `cli/services/docker/agentServiceManager.js`
- `cli/services/workspaceUtil.js`
- `tests/lib.sh`
- `tests/testAgent/manifest.json`
- `tests/testsAfterStart.sh`

## Design Overview

### 1. Shared Readiness Inference

`cli/services/startupReadiness.js` centralizes startup/readiness inference.

It exposes:

- `readManifestStartCommand(manifest)`
- `readManifestAgentCommand(manifest)`
- `resolveAgentExecutionMode(manifest)`
- `resolveAgentReadinessProtocol(manifest)`

The readiness protocol now follows these rules:

1. If `manifest.readiness.protocol` is explicitly `tcp` or `mcp`, use it.
2. If the manifest is `start`-only, treat it as `tcp`.
3. If the manifest declares `agent` or `commands.run`, treat it as `mcp`.
4. If the manifest declares neither, assume the implicit AgentServer fallback
   and treat it as `mcp`.

This is important because Ploinky's runtime defaults to `sh /Agent/server/AgentServer.sh`
when no explicit agent command is provided. A manifest with no `agent` field
is therefore not automatically a plain TCP service.

### 2. Recursive Dependency Graph

`cli/services/workspaceDependencyGraph.js` resolves the recursive dependency
graph starting from the configured static agent.

Each node stores:

- repo name
- short agent name
- optional alias
- manifest path
- parsed manifest
- auth mode
- dependencies
- dependents
- original `enable` spec

The original `enable` spec is preserved so dependency entries such as:

- `gitAgent global`
- `worker devel my-repo`
- `media as media-sidecar`

can be re-enabled without losing mode or alias semantics.

The graph builder also:

- respects `keycloak` gating for SSO-enabled manifests
- uses registry auth mode when already available
- detects cycles and throws a readable cycle path

### 3. Wave-Based Startup

`cli/services/workspaceUtil.js` now starts graph nodes in topological waves.

For each wave:

1. Start every node in the wave with `ensureAgentService(...)`.
2. Write/update routes in `routing.json`.
3. Build readiness entries from the resolved graph nodes.
4. Wait for all nodes in the wave to become ready.

Only after all waves are ready does startup continue.

Because the static node is part of the graph, it is started only after all of
its transitive dependencies are already ready.

### 4. Router Launch Timing

The Router/Watchdog launch remains at the end of `startWorkspace()`, but now it
only runs after the full graph-wait phase succeeds.

If any dependency or the static agent fails readiness:

- startup aborts
- the Router is not launched

### 5. Runtime Alignment For `start`-Only Containers

`cli/services/docker/agentServiceManager.js` now matches the startup contract
assumed by the readiness inference:

1. `start`-only manifests run only their `start` command.
2. `start + agent` manifests run the `start` command and launch the explicit
   `agent` command as a sidecar.
3. manifests with no explicit `agent` command do not get a synthetic
   AgentServer sidecar when `start` is present.

This keeps container behavior aligned with the bwrap and seatbelt runtimes and
prevents false-positive readiness on the default MCP sidecar.

## Behavior Details

### Graph Scope

The blocking startup graph includes:

- the configured static agent
- every recursive dependency reachable through `manifest.enable`

This is the critical path for workspace startup.

### Additional Enabled Agents

Agents already enabled in the workspace registry but not part of the static
agent's dependency graph are still started, but only **after** the blocking
graph is ready.

They are treated as non-blocking extras:

- they do not delay the static dependency graph
- they do not prevent the Router from starting if they fail

This keeps the implementation focused on the user's requested behavior:
waiting for the static agent and all of *its* dependencies.

### Alias Handling

Graph nodes use a stable id:

- `repo/agent`
- `repo/agent as alias`

Registry lookup prefers the exact alias-backed instance when present.

### Failure Modes

Startup now fails early when:

- the static agent cannot be resolved
- a dependency graph cycle exists
- a graph node is missing from the registry after enable
- an agent fails to start
- an agent does not expose a host port
- an agent does not become ready before timeout

## Testing

Unit coverage was added for both new helper modules, and shell coverage was
added for the end-to-end startup cases that were previously unverified.

### `tests/unit/startupReadiness.test.mjs`

Covers:

- `start`-only manifests
- explicit `agent` manifests
- implicit AgentServer fallback
- explicit `readiness.protocol` overrides
- `start + agent` manifests
- the fact that top-level `manifest.run` does not affect startup readiness

### `tests/unit/workspaceDependencyGraph.test.mjs`

Covers:

- dependency ref parsing
- recursive graph expansion
- alias preservation
- original `enable` spec preservation
- SSO-gated `keycloak`
- registry-derived auth mode
- cycle detection

### `tests/test-functions/workspace_dependency_startup_tests.sh`

This shell module is sourced from `tests/testsAfterStart.sh` and runs isolated
temp-workspace scenarios so the dependency-startup assertions do not interfere
with the main fast-suite workspace.

It covers:

- recursive dependency-wave startup across a transitive graph
- mixed TCP and MCP dependencies in the same graph
- dependency-level `readiness.protocol: "tcp"` override handling
- regression coverage for a static `start`-only TCP service
- failure behavior where dependency readiness prevents Router launch

Supporting shell helpers were added in `tests/lib.sh` for:

- route host-port lookup from `routing.json`
- ordered log assertions by line position

## Current Status

The implementation is complete for the orchestration and targeted startup
coverage work:

- shared readiness inference
- recursive dependency graph resolution
- dependency-wave startup
- static-agent gating
- Router launch gating
- container-runtime alignment for `start`-only services
- shell coverage for nested, mixed-protocol, override, and failure scenarios

Verified:

- `node --test ploinky/tests/unit/*.test.js ploinky/tests/unit/*.test.mjs`
- direct execution of the new shell scenarios in
  `tests/test-functions/workspace_dependency_startup_tests.sh`

## Remaining Gap

The main remaining verification gap is a full `tests/test_all.sh` pass after
these additions. The dependency-startup scenarios themselves are now covered,
but the entire fast suite was not rerun as part of this targeted step.

## Relationship To The Earlier Readiness Bug

This work builds on the earlier static-agent readiness protocol fix described in
`docs/static-agent-readiness-probe-bug.md`.

That earlier fix corrected how protocol selection worked for the static agent.
This implementation goes further by changing **when** agents are started and
waited on:

- earlier fix: correct protocol selection
- this implementation: correct dependency-gated startup sequencing

Both are needed for reliable workspace boot.
