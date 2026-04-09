# Static-Agent Readiness Probe Bug

**File:** `cli/services/workspaceUtil.js`
**Related:** `cli/server/utils/agentReadiness.js`
**Reported:** 2026-04-08 while deploying `soul-gateway` (HTTP service) under a
`testProxies` ploinky workspace.
**Symptom:** `ploinky start <agent>` hangs indefinitely at
`Readiness N/M ready. Waiting on: <agent> (still waiting (Xs/600s): port is
open, waiting for MCP handshake)` for any static (main) agent that does not
speak MCP on `/mcp` — even though the agent's HTTP/TCP port is actually
listening.

## TL;DR

`startWorkspace()` built its readiness-entry list with two branches:

- **Dependency agents** (declared via `manifest.enable`) correctly
  auto-detected the probe protocol per-manifest
  (`getAgentCmd(manifest) ? 'mcp' : 'tcp'`).
- **The static (main) agent** hardcoded the probe protocol to `'mcp'` and
  ignored the manifest entirely.

Every static agent therefore got the MCP handshake probe, regardless of what
the agent actually spoke. Non-MCP services (postgres on the pg wire protocol,
soul-gateway as plain HTTP) could never pass the probe and the CLI hung for
the full 600 s (default) before giving up.

The fix:

1. Apply the same auto-detection the dependency path already uses to the
   static path.
2. Add an explicit manifest escape hatch — `manifest.readiness.protocol`
   (`"tcp"` | `"mcp"`) — so agents that declare an `agent` command for sidecar
   lifecycle management but speak plain HTTP can opt out of MCP probing.

## Background

Ploinky's workspace startup reads routing entries for every running agent and
waits for each one to become "ready" before declaring the workspace up. The
readiness check has two stages:

1. **Port probe** — TCP connect to `127.0.0.1:<hostPort>`; wait until the
   socket accepts. This only tells us the process is listening.
2. **Protocol probe** — one of two modes:
    - `tcp`: port open is enough; the agent is declared ready.
    - `mcp`: perform a full MCP handshake over HTTP on `POST /mcp`:
        - `initialize` (JSON-RPC, expect 2xx + `mcp-session-id` header
          + `result.protocolVersion` in body)
        - `notifications/initialized`
        - `tools/list` (expect 2xx + `result.tools` array in body)

The MCP probe lives in `cli/server/utils/agentReadiness.js` in
`probeAgentMcp(port, timeoutMs)`. It only returns `true` if all three MCP
calls succeed. Otherwise `waitForAgentReady` keeps looping until the overall
timeout.

Different agents need different probe modes:

- MCP servers (most Ploinky sidecar agents running via
  `bash /code/agent.sh`) — `mcp`.
- Raw HTTP servers (e.g. Soul Gateway, a dashboard, a Kubernetes API) —
  `tcp`.
- Wire-protocol databases (postgres, redis) — `tcp`.

The protocol must therefore be chosen per agent.

## Two Code Paths, One Fix Each

### Path A: dependency agents (already correct)

`startWorkspace()` gathers declared dependencies from the static manifest's
`enable` array and, for each resolved dependency, reads its manifest and
decides the protocol (`workspaceUtil.js:443-468`):

```js
let readinessProtocol = 'mcp';
try {
  const dependencyManifestPath = findAgentManifest(manifestRef);
  const dependencyManifest = JSON.parse(
    fs.readFileSync(dependencyManifestPath, 'utf8')
  );
  readinessProtocol = getAgentCmd(dependencyManifest) ? 'mcp' : 'tcp';
} catch (_) {}
```

`getAgentCmd()` (defined at `workspaceUtil.js:23`) returns a truthy value
whenever the manifest declares `agent` or `commands.run` — i.e., whenever
Ploinky should run an agent sidecar process that implements MCP. If neither
field is set (a plain container like `postgres:16-alpine`), the heuristic
correctly falls back to `tcp`.

This path worked for `postgres` as a dependency.

### Path B: the static agent (the bug)

Immediately after the dependency entries, the same function built the
static-agent readiness entry with a hardcoded protocol
(`workspaceUtil.js:532-543`, pre-fix):

```js
{
  key: staticRouteKey || staticShortAgent,
  label: staticAgent,
  kind: 'static',
  route: staticRoute,
  protocol: 'mcp',          // <-- always MCP, no manifest lookup
  timeoutMs: staticReadyTimeoutMs,
  intervalMs: staticReadyIntervalMs,
  probeTimeoutMs: staticProbeTimeoutMs,
  installState: staticDependencyState
}
```

No manifest read. No `getAgentCmd()` branch. No escape hatch. **Every** static
agent got `protocol: 'mcp'`, regardless of what it actually spoke.

## Observed Symptoms

### Symptom 1: `ploinky start postgres` hangs

A workspace bootstrapping postgres via `ploinky start postgres` (treating
postgres as the static agent) saw:

```
[start] postgres: ready after 0s.                         ← TCP port probe
[start] Readiness 0/1 ready. Waiting on: postgres (still waiting (5s/600s): port is open, waiting for MCP handshake)
[start] Readiness 0/1 ready. Waiting on: postgres (still waiting (10s/600s): port is open, waiting for MCP handshake)
...
```

Meanwhile, inside the postgres container the PG log filled with:

```
LOG:  invalid length of startup packet
LOG:  invalid length of startup packet
LOG:  invalid length of startup packet
```

That is postgres refusing the JSON-RPC `initialize` POST because the bytes
Ploinky sent to `tcp/5432` are not a valid Postgres startup packet. Postgres
itself was perfectly healthy the entire time — `pg_isready` returned in under
a second.

### Symptom 2: `ploinky start soul-gateway` hangs

Soul Gateway is an HTTP server that handles its own routes (`/healthz`,
`/management`, `/v1/chat/completions`, …). It does not expose `/mcp`. With
soul-gateway as the static agent:

```
[start] soul-gateway: startup cache cold or invalid …; using extended readiness timeout 600000ms.
[start] Tracking readiness for 2 agent(s): postgres, soul-gateway
[start] postgres: ready after 0s.
[start] Readiness 1/2 ready. Waiting on: soul-gateway (still waiting (5s/600s): port is open, waiting for MCP handshake)
...
```

`postgres` passed because the **dependency** path auto-selected TCP for it.
`soul-gateway` hung because the **static** path forced MCP — and a POST to
`/mcp` on the Soul Gateway HTTP service returned 404. `probeAgentMcp` saw a
non-2xx status, returned `false`, the loop retried forever, the CLI hung until
the 600 s timeout.

Meanwhile the soul-gateway container was fully up and `curl localhost:8042/healthz`
returned `{"ok":true}` within a couple of seconds of container start.

### The common thread

In both cases:

- The container was healthy.
- The port was open.
- The TCP dependency probe would have returned `ready` instantly.
- The MCP probe was the only thing standing between the user and a usable
  workspace, and the MCP probe was incapable of succeeding because the agent
  was never going to speak MCP on `/mcp`.

## Root Cause

Two things combined to create the bug:

1. **Hardcoded static-agent protocol.** The static readiness entry at
   `workspaceUtil.js:537` bypassed the manifest-driven protocol selection the
   dependency branch already implemented. The dependency branch was fixed
   earlier (hence its correctness), but the static branch was missed.

2. **No manifest escape hatch.** Even once you add the dependency branch's
   `getAgentCmd()` heuristic to the static branch, it still picks `mcp` for
   any manifest that declares an `agent` command — and some manifests declare
   `agent` specifically to run an installer / startup shim (e.g.
   `bash /code/startup-v2.sh`) even though the actual process is a plain HTTP
   server. For those agents the heuristic is wrong, and there was no way to
   override it.

## The Fix

Location: `cli/services/workspaceUtil.js:537`

```diff
       {
         key: staticRouteKey || staticShortAgent,
         label: staticAgent,
         kind: 'static',
         route: staticRoute,
-        protocol: 'mcp',
+        protocol: (() => {
+          // Honor an explicit `readiness.protocol` (`tcp` | `mcp`) on the
+          // static manifest. Fall back to `mcp` when an `agent` command is
+          // declared (real MCP servers), `tcp` otherwise. This matches the
+          // dependency probe selection at line 458 and lets HTTP-only static
+          // services declare themselves explicitly.
+          try {
+            const sm = JSON.parse(fs.readFileSync(staticManifestPath, 'utf8'));
+            const explicit = String(sm?.readiness?.protocol || '').trim().toLowerCase();
+            if (explicit === 'tcp' || explicit === 'mcp') return explicit;
+            return getAgentCmd(sm) ? 'mcp' : 'tcp';
+          } catch (_) {
+            return 'mcp';
+          }
+        })(),
         timeoutMs: staticReadyTimeoutMs,
         intervalMs: staticReadyIntervalMs,
         probeTimeoutMs: staticProbeTimeoutMs,
         installState: staticDependencyState
       }
```

Protocol resolution order:

1. If `manifest.readiness.protocol` is an explicit, lowercased `tcp` or `mcp`,
   use it. This is the escape hatch for services that know what they speak
   regardless of what `getAgentCmd` would infer.
2. Otherwise, if the manifest declares an agent command
   (`manifest.agent` or `manifest.commands.run`), default to `mcp`. Matches
   historical behavior for sidecar MCP agents.
3. Otherwise, use `tcp`. Raw containers like postgres now work out of the box.
4. On any read/parse error, fall back to `mcp`. This preserves the previous
   behavior so nothing silently degrades if the manifest file is unreadable.

## New Manifest Field: `readiness.protocol`

Any agent manifest can now declare:

```json
{
  "container": "node:20-slim",
  "agent": "bash /code/startup.sh",
  "readiness": {
    "protocol": "tcp"
  }
}
```

Recognized values:

- `"tcp"` — port-open probe only. Appropriate for HTTP services, plain TCP
  services (postgres, redis), and any service that does not implement the
  MCP `/mcp` handshake.
- `"mcp"` — full `initialize` + `notifications/initialized` + `tools/list`
  handshake on `POST /mcp`. Appropriate for Ploinky MCP sidecar agents.

When the field is absent the probe protocol is inferred:

| `manifest.agent` or `manifest.commands.run` set? | Inferred protocol |
| --- | --- |
| yes | `mcp` |
| no | `tcp` |

### Concrete examples

**Postgres (plain container, no agent command):**

```json
{
  "container": "postgres:16-alpine",
  "start": "postgres",
  "profiles": { "default": { "ports": ["5432:5432"], ... } }
}
```

No `agent`, no `readiness` → inferred `tcp`. Works as a dependency and as a
standalone static agent.

**An MCP sidecar agent:**

```json
{
  "container": "node:20-slim",
  "agent": "bash /code/agent.sh"
}
```

Has `agent`, no `readiness` → inferred `mcp`. Unchanged behavior.

**Soul Gateway (HTTP service with an agent-command startup shim):**

```json
{
  "container": "node:20-slim",
  "agent": "bash /code/startup-v2.sh",
  "readiness": { "protocol": "tcp" },
  "profiles": { "default": { "ports": ["0.0.0.0:8042:8042"], ... } }
}
```

The inference would have said `mcp` because `agent` is set, but the explicit
field overrides it to `tcp`. The probe now returns as soon as the Soul
Gateway HTTP listener is accepting on 8042.

## Why Both Changes Were Necessary

Just auto-detecting with `getAgentCmd()` on the static branch would fix
postgres but not soul-gateway, because soul-gateway's manifest intentionally
declares an `agent` command to run a startup shim
(`bash /code/startup-v2.sh`) that performs install, syncs shared volumes,
then `exec`s `node src/index.mjs`. The `agent` field is real; the service
just happens to be HTTP at the end of that shim.

Just adding a `readiness.protocol` field without the auto-detect would fix
soul-gateway once it declared the field, but would leave postgres (and every
other plain container) hanging for 600 s until someone added the escape hatch
to each one. The two fixes together mean:

- Plain containers (no `agent` cmd) work out of the box.
- Normal MCP sidecars keep working unchanged.
- HTTP / custom-protocol services with an agent-command startup shim get a
  one-line escape hatch in their manifest.

## Backward Compatibility

- Agents that already worked continue to work. The `try/catch` returns the
  old default (`'mcp'`) on any failure path, so nothing silently degrades.
- Manifests that do not set `readiness.protocol` are unaffected unless they
  have no `agent`/`commands.run` field and were previously mis-classified as
  MCP (those agents never worked as static agents before the fix — they
  always timed out — so "fixing" them is a win, not a regression).
- No schema migration is required. The field is optional and purely
  additive.

## Verification

### Repro (without the fix)

```bash
# Any workspace that starts a non-MCP static agent.
ploinky start postgres
# or
ploinky start soul-gateway 8080
```

Observe:

- `postgres: ready after 0s.` (if it is a dependency)
- `Readiness N/M ready. Waiting on: <static-agent> (still waiting (Xs/600s): port is open, waiting for MCP handshake)`
- Inside postgres: `invalid length of startup packet` loop.
- Or the static HTTP agent receives `POST /mcp` on the application's real port
  and returns 404.
- The CLI hangs until 600 s and aborts with `did not become ready within
  600000ms`.

### Positive test (with the fix)

1. Manifest A — plain container dependency:

    ```json
    { "container": "postgres:16-alpine", "start": "postgres",
      "profiles": { "default": { "ports": ["5432:5432"], ... } } }
    ```

    Expected: `ploinky start postgres` reports `postgres: ready after 0s.`
    and the CLI returns immediately.

2. Manifest B — HTTP service behind a startup shim:

    ```json
    { "container": "node:20-slim",
      "agent": "bash /code/startup.sh",
      "readiness": { "protocol": "tcp" },
      "profiles": { "default": { "ports": ["0.0.0.0:8042:8042"], ... } } }
    ```

    Expected: `ploinky start my-http-app 8080` starts the container, reports
    `my-http-app: ready after Ns.` as soon as the HTTP server listens on
    8042, and then launches the watchdog + RoutingServer on 8080 without
    colliding with the agent's port.

3. Manifest C — real MCP sidecar (regression fuse):

    ```json
    { "container": "node:20-slim", "agent": "bash /code/agent.sh" }
    ```

    Expected: unchanged behavior — `protocol: 'mcp'` via the
    `getAgentCmd`-based fallback, full handshake required before
    `ready`.

### End-to-end verification performed

Soul Gateway v2 was deployed into `~/work/testProxies` with:

- `manifest.readiness = { "protocol": "tcp" }`
- `manifest.agent = "bash /code/startup-v2.sh"`
- `manifest.profiles.default.ports = ["0.0.0.0:8042:8042"]`
- `ploinky start soul-gateway 8080` (router on 8080, agent on 8042
  directly)

Result:

```
[start] postgres: ready after 0s.
[start] soul-gateway: ready after 0s.
[start] Readiness 2/2 ready.
[start] Watchdog launched in background (pid …).
```

Followed by:

```
$ curl http://localhost:8042/healthz
{"ok":true,"db":true,"snapshotGeneration":1,"uptimeSeconds":4}
```

Both agents reached `ready` in under a second, the workspace came up cleanly,
and a follow-up HTTP probe to the actual Soul Gateway port returned the
expected health payload.

## Related Files

- `cli/services/workspaceUtil.js` — static readiness entry construction
  (lines ~532-556 after the fix) and the dependency branch
  (lines 443-468).
- `cli/services/workspaceUtil.js:23` — `getAgentCmd(manifest)` heuristic.
- `cli/server/utils/agentReadiness.js` — `waitForAgentReady`,
  `probeAgentMcp`, `probeLocalPortDetailed`. The protocol name resolved by
  `workspaceUtil.js` is passed straight through to `waitForAgentReady` as
  `protocol`, which honors `'tcp'` by short-circuiting after the port probe.

## Out-of-scope Follow-ups

These are not part of this fix but are worth considering:

- **Richer HTTP probe.** Accepting `readiness.protocol = "http"` with an
  optional `readiness.httpPath` would let services declare a healthcheck
  endpoint directly (`GET /healthz` must return 2xx) instead of relying on
  "port open" as a ready signal. Some services bind their port before they
  are actually usable.
- **Router/agent port collision.** The new Ploinky model spawns a watchdog
  `RoutingServer` on the static-agent port, which collides with any agent
  that declares an explicit `ports: ["x:x"]` mapping on the same port. The
  workaround today is to start the workspace on a different static port
  (`ploinky start <agent> 8080` while the agent binds 8042 directly). A
  nicer fix would be for the workspace to detect the collision and either
  pick a free port for the router automatically or skip router spawn when
  the static agent already owns the user-facing port.
- **Propagating `readiness` through the dependency branch.** The dependency
  branch still only uses `getAgentCmd()` and does not honor a
  `readiness.protocol` override on a dependency's own manifest. Mirroring
  the static branch's escape hatch there would keep the two paths
  symmetric.
