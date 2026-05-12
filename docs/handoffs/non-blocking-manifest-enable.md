# Non-blocking Manifest Enable Handoff

## Goal

Add manifest syntax that lets an agent dependency be started without blocking later dependency deployment or static-agent startup.

Target example:

```json
"enable": [
  "webmeetLivekitAiAgent global no-wait",
  "webmeetAgent global"
]
```

`no-wait` means Ploinky should launch the dependency as a background deployment and continue with the rest of the dependency graph. The default behavior stays unchanged: dependencies without `no-wait` are still started and waited on wave by wave.

## Desired Semantics

- `no-wait` is an optional token inside manifest `enable[]` string entries.
- It can appear alongside existing modifiers such as `global`, `devel <repo>`, and `as <alias>`.
- Ploinky must strip `no-wait` before calling `enableAgent`, resolving the agent reference, or parsing mode/alias data.
- A no-wait dependency is still enabled, started, logged, and visible in normal Ploinky state.
- A no-wait dependency must not block later dependencies on:
  - dependency-cache preparation
  - container creation
  - runtime startup
  - TCP/MCP/readiness checks
- No-wait failures must be visible in a durable log and should not fail the main `ploinky start <staticAgent>` command.
- Blocking dependencies remain fail-closed exactly as they do today.

## Likely Design

Implement this as an edge policy in the manifest dependency graph, not as a property of the dependency agent itself.

The same agent may be blocking for one parent and no-wait for another parent. The metadata belongs to the `enable[]` edge that requested it.

## Concrete Consumer: WebMeet LiveKit AI Split

This Ploinky feature is intended to support a WebMeet runtime split in the sibling `AssistOSExplorer` repository.

Current in-progress `AssistOSExplorer` conversion:

- `webmeetAgent` remains the base WebMeet application agent.
  - It owns rooms, guest invites, LiveKit token issuance, chat, transcripts, recordings, artifacts, and AI dispatch metadata.
  - `webmeetAgent/scripts/startAgent.sh` no longer imports `@livekit/agents` or starts `server/livekit-agent.mjs`.
  - `webmeetAgent/package.json` must remain absent so default Explorer startup does not prepare the heavy LiveKit Agents dependency tree under `webmeetAgent`.
  - `WEBMEET_LIVEKIT_AGENT_ENABLED=false` remains the default dispatch guard.
  - If the guard is true, `webmeetAgent` now logs that the worker must be run by the separate `webmeetLivekitAiAgent` Ploinky agent instead of trying to start the worker itself.
- A new optional `webmeetLivekitAiAgent` agent owns the self-hosted LiveKit Agents worker.
  - New files live under `AssistOSExplorer/webmeetLivekitAiAgent/`.
  - `manifest.json` runs `node /code/server/livekit-agent.mjs` in `node:20`.
  - `package.json` owns `@livekit/agents`, `@livekit/rtc-node`, and `achillesAgentLib`.
  - `readiness.protocol` is `none` because the worker is long-running and does not expose an HTTP/MCP readiness port.
  - The agent joins the `webmeet` network and uses shared LiveKit derived credentials matching `webmeetAgent`, `webmeetLivekitServer`, and `webmeetLivekitEgress`.
  - The moved worker entrypoint defaults `WEBMEET_AGENT_API_URL` to `http://webmeetAgent:8791`, so persisted AI chat goes through the base WebMeet API.
- Documentation in `AssistOSExplorer` has been updated to describe the split:
  - top-level `AGENTS.md` and `CLAUDE.md`
  - `docs/index.html`
  - `docs/specs/DS06-ploinky-runtime-invariants.md`
  - `webmeetAgent/AGENTS.md` and `webmeetAgent/CLAUDE.md`
  - `webmeetAgent/README.md`
  - `webmeetAgent/docs/index.html`
  - `webmeetAgent/docs/specs/DS09-ploinky-runtime-invariants.md`
  - `webmeetAgent/docs/specs/DS10-self-hosted-livekit-ai-agents.md`
  - `webmeetLivekitAiAgent/docs/specs/DS01-ploinky-agent-invariant.md`

After `no-wait` support exists in Ploinky, wire this consumer by adding the optional worker to the WebMeet or Explorer dependency graph with no-wait semantics, for example:

```json
"enable": [
  "webmeetLivekitAiAgent global no-wait"
]
```

The exact parent should be chosen deliberately:

- `webmeetAgent/manifest.json` is the most domain-local parent because AI participants are WebMeet behavior.
- `explorer/manifest.json` is broader and should only own the edge if Explorer is intentionally responsible for starting every optional WebMeet adjunct.

The expected steady state is:

- Fresh `ploinky start explorer` starts the WebMeet base app without blocking on the LiveKit AI worker dependency install.
- The no-wait worker starts in the background and prepares its own dependency cache under `webmeetLivekitAiAgent`.
- If the background worker install or startup fails, the no-wait log/status path makes that failure visible.
- `WEBMEET_LIVEKIT_AGENT_ENABLED` should be set to `true` only when the operator wants admin AI dispatch to be active; otherwise attach requests should continue to fail clearly.

## WebMeet Verification After No-wait Lands

Use the existing Ubuntu 24 VM smoke path when possible, because the original hang was observed on Ubuntu 24 during a fresh local Explorer deployment.

Default startup smoke:

```bash
rm -rf /home/ubuntu/explorer-no-wait-smoke
mkdir -p /home/ubuntu/explorer-no-wait-smoke
cd /home/ubuntu/explorer-no-wait-smoke
git clone https://github.com/PloinkyRepos/AssistOSExplorer.git workspace
cd workspace
PLOINKY_MASTER_KEY=ubuntu-smoke-key ploinky start explorer 18086
```

Expected default smoke result:

- `ploinky start explorer 18086` reaches ready without waiting on a `webmeetAgent` install of `@livekit/agents`.
- Dependency wave output may mention `webmeetLivekitAiAgent` only if the no-wait edge has been wired.
- If wired, the worker line should say it was launched in the background and include a log/status path.
- The WebMeet API/proxy/MCP container should be running and room/chat/media flows should remain available.

Background worker smoke:

```bash
cd /home/ubuntu/explorer-no-wait-smoke/workspace
PLOINKY_MASTER_KEY=ubuntu-smoke-key ploinky var WEBMEET_LIVEKIT_AGENT_ENABLED true
PLOINKY_MASTER_KEY=ubuntu-smoke-key ploinky start explorer 18086
```

Expected background worker result:

- Main Explorer startup still completes without waiting for `webmeetLivekitAiAgent` dependency preparation.
- `.ploinky/logs/no-wait/` or the chosen no-wait log directory contains a worker log.
- `.ploinky/running/no-wait/` or the chosen status directory records success or failure.
- When the worker eventually succeeds, `podman ps` shows a `webmeetLivekitAiAgent` container.
- If the worker fails, the status file and log include the npm/install/start failure without failing the already-running Explorer stack.

Full AI dispatch smoke, when credentials/provider setup is available:

- Ensure `WEBMEET_LIVEKIT_AGENT_ENABLED=true`.
- Ensure `webmeetLivekitAiAgent` is running and has accepted its LiveKit worker registration.
- Create a WebMeet room as an admin.
- Use the WebMeet admin attach flow.
- Confirm LiveKit reports a real `AGENT` participant with WebMeet attributes for `webmeetAgent`, `webmeetAgentName`, `webmeetMeetingId`, `webmeetAgentType`, and `webmeetAgentMode`.
- Confirm WebMeet persists dispatch metadata only after the participant appears.

## Relevant Files

- `cli/services/bootstrapManifest.js`
  - Owns `parseEnableDirective()`.
  - `applyManifestDirectives()` enables agents declared in manifest `enable[]`.
- `cli/services/workspaceDependencyGraph.js`
  - Builds the recursive dependency graph from manifest `enable[]`.
  - Currently stores dependencies as `Set<nodeId>` only.
- `cli/services/workspaceUtil.js`
  - Starts graph waves with `updateRoutes(waveNames)`.
  - Builds readiness entries and waits for all entries in a wave before continuing.
- `cli/services/docker/agentServiceManager.js`
  - `ensureAgentService()` is synchronous and may block during dependency-cache preparation.
- `docs/specs/DS003-agent-manifest-and-registry.md`
  - Manifest syntax and dependency graph behavior.
- `docs/specs/DS007-dependency-caches-and-startup-readiness.md`
  - Dependency preparation and readiness semantics.
- `tests/unit/workspaceDependencyGraph.test.mjs`
  - Graph parsing and wave tests.
- `tests/unit/startupReadiness.test.mjs`
  - Readiness protocol tests.

## Implementation Plan

1. Extend `parseEnableDirective()`.
   - Recognize a case-insensitive `no-wait` token.
   - Remove all `no-wait` tokens from the directive before computing `spec`.
   - Keep existing `as <alias>` parsing behavior.
   - Return `{ spec, alias, noWait }`.

2. Update manifest dependency reference parsing.
   - Ensure `parseManifestDependencyRef()` receives a cleaned spec.
   - Add tests for:
     - `agent no-wait`
     - `agent global no-wait`
     - `agent devel repo no-wait`
     - `agent global no-wait as alias`
     - `agent global as alias no-wait`

3. Preserve edge metadata in `workspaceDependencyGraph.js`.
   - Keep `node.dependencies` for topology.
   - Add a parallel edge map such as:

```js
dependencyEdges: new Map([
  [childId, { noWait: Boolean(parsedDependency.noWait) }]
])
```

   - Prefer a clear helper so future edge policies do not require reshaping every caller again.

4. Compute blocking versus non-blocking nodes in `workspaceUtil.js`.
   - For each wave, identify nodes that must be waited on by dependents.
   - A node reached only through no-wait edges should be launched via background deployment and omitted from that wave's readiness wait.
   - Static agent startup must still wait on its blocking dependency chain.

5. Add a background launch path.
   - Do not call synchronous `ensureAgentService()` inline for no-wait dependencies.
   - Start a detached helper process for each no-wait node.
   - The helper should start one agent using the same manifest/env/runtime path as normal startup.
   - Write logs under `.ploinky/logs/no-wait/<agent-key>.log` or a similarly predictable path.
   - The main start command should print the log path.

6. Record status for eventual failures.
   - At minimum, the helper log must include start time, command target, success, and failure stack/message.
   - Prefer also writing a small JSON status file under `.ploinky/running/no-wait/<agent-key>.json` with `state`, `startedAt`, `finishedAt`, and `error`.

7. Update docs/specs.
   - `DS003`: document `no-wait` as a manifest `enable[]` modifier and define that it is edge-local.
   - `DS007`: document that no-wait dependencies are started asynchronously and are excluded from dependency readiness gating.

8. Add tests.
   - Unit-test parsing in or near `workspaceDependencyGraph.test.mjs`.
   - Add a graph test proving no-wait metadata is retained.
   - Add a focused workspace startup test if there is already a cheap helper pattern for simulating no-wait launch without real containers. Otherwise keep the first pass to parser/graph tests and document the remaining smoke test.

## Suggested Acceptance Criteria

- Existing manifest enable strings behave unchanged.
- `parseEnableDirective("worker global no-wait as ai")` returns cleaned `spec: "worker global"`, `alias: "ai"`, and `noWait: true`.
- `ploinky start explorer` can launch a no-wait dependency without waiting for its npm dependency cache to finish.
- The no-wait dependency's failure is visible in a durable log/status file.
- Blocking dependency failures still fail `ploinky start`.
- Specs and tests cover the new behavior.
