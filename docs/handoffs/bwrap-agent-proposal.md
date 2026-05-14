# Bwrap Agent Proposal

## Reconciliation Status

This handoff is preserved as background input. The reconciled recommendation now lives in `docs/proposals/bwrap-runner-agent.md`: build a normal tool-provider `bwrap-runner` first, and do not present v1 as a transparent replacement for host bwrap in `lite-sandbox: true` agents. Sections below that describe replacing the `lite-sandbox` prerequisite chain should be read as superseded by the Model A recommendation unless a future delegated runtime backend is explicitly designed.

## Goal

Ship a first-class Ploinky agent that bundles a Linux userland with `bwrap`
(bubblewrap) pre-installed and pre-configured, so operators can run bounded
sandboxed jobs without installing bubblewrap on the host.

This does not replace the current "install `bwrap` on your host, then run
`ploinky sandbox enable`" prerequisite chain for whole-agent
`lite-sandbox: true` workloads. It gives callers a separate provider agent
for sandboxed subprocesses. A transparent runtime backend would be a later,
larger design.

## Current State (Observed)

The `lite-sandbox: true` flag is honored at runtime selection in
`cli/services/docker/common.js:533-562` (`getRuntimeForAgent`):

- macOS hosts dispatch to Seatbelt via `sandbox-exec` (which ships with
  macOS) — `cli/services/seatbelt/seatbeltServiceManager.js`.
- Linux hosts dispatch to bubblewrap via `/usr/bin/bwrap`
  (hardcoded in `cli/services/bwrap/bwrapServiceManager.js:90`).
- Unsupported platforms throw `createHostSandboxError` with the install hint
  `"Install the 'bwrap'/'bubblewrap' package and check 'command -v bwrap'"`
  (`docker/common.js:484-507`).

The dispatch is also gated by `isHostSandboxDisabled`
(`cli/services/sandboxRuntime.js`). The workspace default is **disabled**:
operators must run `ploinky sandbox enable` to flip
`.ploinky/config.json` → `sandbox.disableHostRuntimes: false`. Until that
happens, `lite-sandbox: true` manifests silently fall back to the container
runtime (this fallback is allowed before opt-in and disallowed after opt-in
— see DS004 §"Core Content" paragraph on host sandboxes).

The contract for bubblewrap on the host (from DS004 + DS011 §"Runtime
Isolation and Mount Policy"):

- The binary must live at `/usr/bin/bwrap`.
- Bubblewrap unshares PID but **not** network — agents reach the router on
  `127.0.0.1` (`bwrapServiceManager.js:317-325`).
- Bwrap binds `/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, a curated set of
  `/etc/*` (resolv.conf, hosts, passwd, group, nsswitch.conf, ld.so.cache,
  SSL roots), plus `--proc`, `--dev`, and a fresh `--tmpfs /tmp`
  (`bwrapServiceManager.js:207-253`).
- The code does **not** probe for `kernel.unprivileged_userns_clone=1`,
  AppArmor restrictions, or a working clone of a new user namespace.
  Failure mode is "bwrap exits immediately and we surface the last log
  line" (`bwrapServiceManager.js:602-619`).

So the operator's manual steps today are:

1. Install `bubblewrap` package (`apt`, `dnf`, …).
2. Make sure it lands at `/usr/bin/bwrap` (some distros use `/usr/local/bin`
   — current code will not find it).
3. Make sure `kernel.unprivileged_userns_clone=1` (Debian-derived) or that
   the equivalent AppArmor / Yama policies allow it.
4. Run `ploinky sandbox enable` in each workspace where lite-sandbox is
   desired.
5. Restart any already-running agents so the new dispatch takes effect.

Steps 1–3 are out-of-band host configuration. They are the friction this
proposal removes.

## Problem Statement

`lite-sandbox` is meant to be a lightweight isolation tier between "no
sandbox" and "full container," but in practice it has a heavier
*operational* footprint than running a container, because:

- It only exists on macOS + Linux.
- On Linux it requires a kernel knob the operator may not know about.
- On macOS the `sandbox-exec` profile language is bespoke and the binary is
  technically deprecated by Apple, even though it still works.
- Errors when bwrap is missing or misconfigured are surfaced late, at the
  first attempt to start the agent.

The result is that contributors and downstream users either disable
lite-sandbox entirely (`ploinky sandbox disable`, the safe-by-default state)
or wrestle with kernel/AppArmor for an afternoon. Either outcome means the
sandbox tier is rarely exercised in the wild.

## Proposed Approach

Add a **`bwrap-agent`** to `.ploinky/repos/basic/`. It is an ordinary
container-backed Ploinky agent whose image is a minimal Linux userland with
bubblewrap already installed and health-checked. Host kernel and outer
container-runtime policy still decide whether nested bwrap can run. The agent
includes a small service that accepts "run this command/script inside a bwrap
sandbox" requests from other agents over the existing router-mediated
invocation path.

This is **Model A** below. I think Model A is the right starting point; a
second, more invasive option is described as **Model B** for completeness.

### Model A — Sandbox-as-a-service (recommended)

`bwrap-agent` is a normal Ploinky agent. It does **not** replace the
existing `bwrap` runtime backend. Instead, callers that want a sandbox
declare `bwrap-agent` as a dependency:

```json
{
  "container": "node:20-bullseye",
  "agent": "node /code/server.js",
  "enable": [
    "bwrap-agent global"
  ]
}
```

…and invoke it through the router's existing delegated-invocation flow
(DS011 §"Secure-Wire Invocation Model") to do work inside the sandbox.
Concretely, the caller posts to `/mcps/bwrap-agent/mcp` with an
`X-Ploinky-Caller-JWT` and a `tools/call`. The tool surface would be
something like:

- `runScript` with `{ script, stdin, env, mounts, timeoutMs }` →
  `{ exitCode, stdout, stderr }`
- `runScriptStream` — SSE / chunked stream variant for long jobs
- `mkSession` with `{ image?, mounts }` → returns a session id; subsequent
  `runInSession` calls reuse the same bwrap rootfs for state-bearing
  workloads

Why this shape:

1. It composes with everything Ploinky already does — JWT auth, router
   routing, agent enable/disable, profiles, `no-wait` deps, watchdog.
2. It is transparent: the caller agent's manifest declares the dependency,
   so the operator can audit who is using the sandbox.
3. It does not require any change to `getRuntimeForAgent` — the
   `bwrap-agent` itself runs as a container, like every other agent, on
   whatever host the operator already has (Linux, macOS+Podman/Docker
   Desktop, Linux+rootless Podman).
4. Manifests that *only* need a sandboxed sub-process can stop setting
   `lite-sandbox: true` entirely and call into `bwrap-agent` instead. The
   `lite-sandbox` path remains as-is for agents that genuinely want their
   *whole* process tree wrapped.

### Model B — A bwrap-host runtime backend

A heavier alternative: extend `getRuntimeForAgent` so that
`lite-sandbox: true` agents transparently launch *inside* a long-running
`bwrap-host` container instead of on the operator's host. This would
preserve the existing manifest contract (no caller-side changes) at the
cost of:

- A fourth runtime branch (`bwrap-container`) in
  `cli/services/docker/common.js:533-562`, with corresponding
  service-manager code that mirrors `bwrapServiceManager.js` but uses
  `docker exec` to enter the bwrap-host container.
- Filesystem topology changes — `/Agent`, `/code`, dependency caches, and
  the workspace bind would have to be mounted into the bwrap-host
  container *and then* re-bound into the inner bwrap rootfs. This is
  doable but the read-only / profile-aware mount policy in DS004 has to be
  preserved across both hops.
- Network: bwrap-host would need to share the host network namespace (or
  the same bridge as the router) so that inner agents can still reach
  `127.0.0.1:<router>`.

Model B is more invasive and forecloses some debugging affordances (the
operator can no longer `htop` the agent process directly). I recommend
deferring it until Model A has demonstrated value.

## Manifest Sketch (Model A)

Drop into `.ploinky/repos/basic/bwrap-agent/manifest.json`:

```json
{
  "container": "ghcr.io/ploinky/bwrap-host:latest",
  "agent": "node /code/server.js",
  "about": "Run commands or scripts inside a bubblewrap sandbox without installing bwrap on the host.",
  "readiness": { "protocol": "tcp" },
  "profiles": {
    "default": {
      "env": [
        "PLOINKY_BWRAP_AGENT_DEFAULT_TIMEOUT_MS",
        "PLOINKY_BWRAP_AGENT_MAX_OUTPUT_BYTES"
      ]
    }
  },
  "volumes": {
    ".ploinky/data/bwrap-agent/sessions": "/var/lib/bwrap-agent/sessions"
  }
}
```

A consumer enables it like any other dependency:

```json
"enable": [
  "bwrap-agent global no-wait"
]
```

`no-wait` is appropriate because the sandbox provider does not need to be
ready before the consumer's startup completes; the consumer's first sandbox
call will block on readiness.

## Container Image Design

Base: `debian:12-slim` or `ubuntu:24.04` — Debian-family because it ships a
recent bubblewrap (≥0.8) and matches the existing `node:20-bullseye` image
family the other agents use, which simplifies the dependency cache.

Layers:

1. `apt-get install -y --no-install-recommends bubblewrap ca-certificates tini nodejs npm`.
2. Copy a small Node.js server (`/code/server.js`) that:
   - Exposes the AgentServer protocol (`Agent/server/AgentServer.sh` /
     `AgentServer.mjs`) so the router can talk to it like any other agent.
   - Registers MCP tools (`runScript`, `runScriptStream`, `mkSession`,
     `runInSession`, `destroySession`).
   - Materializes incoming requests into a workdir under
     `/var/lib/bwrap-agent/sessions/<id>/`, builds the `bwrap` argv from the
     request, spawns it, captures stdout/stderr with size caps, returns the
     result.
3. Default sandbox argv mirrors what `bwrapServiceManager.js:207-253`
   builds for the host case (system reads, `/proc`, `/dev`,
   `--tmpfs /tmp`, `--unshare-pid`, no network unshare unless the request
   opts in).
4. Entrypoint: `tini -- node /code/server.js` so PID-1 reaping is sane when
   sandboxed children exit.

The image's working assumption is that bubblewrap will be exercised
*inside* the container. That is the technically interesting part — see
"Privilege Requirements" below.

## Privilege Requirements (the hard part)

Bubblewrap creates a new user namespace via a `clone` syscall with
`CLONE_NEWUSER | CLONE_NEWPID | ...`. Inside a default Docker or Podman
container, that call is blocked by the default seccomp / AppArmor profile
on most distros, even though the kernel supports it.

The image therefore can only function when the container is started with
relaxed isolation. Concretely we will need some combination of:

- **Docker (Linux host, default daemon)**: launch with
  `--security-opt seccomp=unconfined --security-opt apparmor=unconfined
  --cap-add SYS_ADMIN`. This *does* drop most container hardening for the
  bwrap-agent container, which is acceptable because the *whole point* of
  this agent is to be the privileged sandbox host — but it must be called
  out loudly in the agent's `about` and in the docs.
- **Podman (rootless, Linux host)**: usually works without the seccomp
  override because rootless Podman already runs inside a user namespace
  the container shares; `--security-opt unmask=ALL` may still be needed
  for `/proc/sys/kernel/*`.
- **Docker Desktop (macOS)**: the Linux VM that Docker Desktop ships has
  `kernel.unprivileged_userns_clone=1` and a permissive seccomp by
  default; the above flags are still required for the *container* though.
- **Setuid bwrap fallback**: bubblewrap can be built setuid-root, which
  removes the userns requirement at the cost of running a setuid binary
  inside the container. We should **not** rely on this; it weakens the
  inner sandbox.

This means the `bwrap-agent` manifest needs to express the extra
container flags. Today, manifest `container` is just the image name; the
runtime does not expose a hook for arbitrary `--security-opt` /
`--cap-add` flags (see `agentServiceManager.js:505` for image resolution
and surrounding code for the assembled `docker run` argv). We have two
options:

1. **Hardcode the flags for this agent** in `agentServiceManager.js`
   guarded by a manifest marker such as `"requiresSandboxHost": true`.
   Small surface area, easy to audit, narrowly scoped.
2. **Generalize**: add `containerSecurity` / `containerCaps` fields to
   the manifest grammar (DS003 §"Agent Manifest and Registry") and let
   any agent request them. Larger blast radius — operator-supplied
   manifests would gain a way to escape container hardening — so this
   change must be gated to the basic/system repo only or audited at
   enable-time.

Recommendation: option (1) for the first cut. It is reversible, and the
mechanism is easy to expand later if other agents need similar
privileges (the `docker-agent` already has a related but distinct need
— it talks to the host docker socket, not nested-userns).

## Integration Points

Code changes required to land Model A:

- `.ploinky/repos/basic/bwrap-agent/` — new agent (manifest + `code/` +
  README).
- `cli/services/docker/agentServiceManager.js` — recognize the new
  `requiresSandboxHost: true` manifest flag (or whatever name is
  chosen) and append the necessary `--security-opt` / `--cap-add` flags
  to the runtime argv.
- `docs/specs/DS003-agent-manifest-and-registry.md` — document the new
  manifest field if option (2) is chosen, or document the
  basic-repo-only exception if option (1) is chosen.
- `docs/specs/DS004-runtime-execution-and-isolation.md` — extend the
  "Core Content" paragraph on host sandboxes to mention that
  `bwrap-agent` is the recommended path for operators who cannot
  install bubblewrap on the host, and to clarify that `lite-sandbox:
  true` and `bwrap-agent` are independent mechanisms.
- `docs/specs/DS011-security-model.md` §"Runtime Isolation and Mount
  Policy" — discuss the relaxed container hardening on the
  bwrap-agent container and why it is acceptable (it is a *deliberately*
  privileged container that exists to provide the inner sandbox).
- `cli/services/help.js` and `docs/cli-reference.html` — surface
  `ploinky bwrap-agent` as an installable agent.

No changes are required to `getRuntimeForAgent`, the bwrap host
service manager, the seatbelt service manager, or the dispatch in
`agentServiceManager.js:949-965` for Model A. They are independent
mechanisms.

## Security Analysis

This proposal **does not strengthen** the isolation story for callers.
A consumer that calls `bwrap-agent.runScript` is delegating to a
sandbox that lives inside a container that itself runs with relaxed
seccomp/AppArmor. The trust chain is:

  caller agent → router (JWT) → bwrap-agent (container, relaxed) → bwrap (userns)

Each hop reduces blast radius, but the bwrap-agent container is more
privileged than a default container. Specifically:

- A compromise of the bwrap-agent process can escape its container
  more easily than a regular agent because seccomp/AppArmor are
  unmasked.
- A compromise of the bwrap-agent *user* (the workspace operator's
  `PLOINKY_DERIVED_MASTER_KEY` is injected into it, like every other
  agent — DS011 §"Workspace Key and Encrypted Storage") yields the same
  HMAC-forgery surface as compromising any other agent. The shared-HMAC
  caveat in DS011 §"Question #2" applies as-is.

The argument for accepting this trade-off:

1. The bwrap-agent is **operator-installed**, like the `docker-agent`
   already in `.ploinky/repos/basic/`. Both occupy the same trust tier
   ("the operator has chosen to grant this agent privileged host
   access"). The proposal does not weaken the default posture for any
   other agent.
2. The alternative is "no sandbox at all on hosts without bwrap." A
   privileged bwrap container providing an inner userns sandbox is
   strictly better than the status quo on those hosts.
3. Operators who do not want a privileged container present should
   simply not enable the agent. The default state is "not installed."

## Open Questions

1. **Naming**: `bwrap-agent` vs `sandbox-agent` vs `sandbox-host`? The
   first is precise but Linux-centric; the second is portable but loses
   the technical signal; the third invites confusion with the existing
   `ploinky sandbox enable` CLI.
2. **macOS coverage**: should this agent also provide a Seatbelt-based
   tool when run on macOS, so the API is uniform regardless of host?
   The image would have to be macOS-native, which Ploinky does not
   currently support as a runtime backend. Probably out of scope for v1.
3. **Manifest field design**: option (1) hardcoded vs option (2)
   generalized `containerSecurity` / `containerCaps`. I lean (1) for v1.
4. **Tool surface**: do we expose `runScript`, `mkSession + runInSession`,
   or both? Sessions are more useful for stateful workloads but multiply
   the failure modes (orphaned rootfs, leaked tmpfs, cleanup on agent
   restart).
5. **Should this agent replace `ploinky sandbox enable` in the docs as
   the recommended path?** If yes, the DS004 wording on host sandboxes
   needs to soften — they would become the "advanced / opt-in" path
   rather than the canonical one.

## Acceptance Criteria

For Model A v1 to be considered done:

- `ploinky enable agent basic/bwrap-agent` installs and starts on
  Linux + Docker, Linux + Podman, macOS + Docker Desktop, and
  macOS + Podman machine.
- The agent exposes `runScript` returning correct exit codes,
  truncated-but-capped stdout/stderr, and propagates `timeoutMs`.
- A test agent in `tests/` declares `bwrap-agent` as a dependency,
  calls `runScript` with `{ script: "id -u" }`, and asserts that the uid
  inside the sandbox is different from the uid the agent itself runs
  as (proof that a user namespace was actually created).
- A test asserts that the sandbox cannot read
  `/etc/ploinky-test-secret` mounted into the bwrap-agent container at
  a path that is **not** in the sandbox bind list — i.e. the inner
  bind policy is honored.
- Docs in `docs/specs/DS004-...` and `docs/specs/DS011-...` updated to
  describe the agent's trust tier and to point operators at it from the
  "lite-sandbox" sections.

## Reporting Notes

- **Implemented**: nothing yet — this document is a proposal. No code
  was changed in this turn; the only file written is
  `docs/handoffs/bwrap-agent-proposal.md`.
- **Reviewed**: I personally read
  `cli/services/docker/common.js:470-562`,
  `cli/services/bwrap/bwrapServiceManager.js:1-100` and 560-630,
  `docs/specs/DS004-runtime-execution-and-isolation.md`,
  `docs/specs/DS011-security-model.md`, and
  `.ploinky/repos/basic/{docker-agent,puppeteer-agent,ubuntu-bash}/manifest.json`.
- **Delegated**: an Explore agent surveyed
  `cli/services/{docker,bwrap,seatbelt}/`,
  `cli/services/{runtimeResourcePlanner,runtimeStaging,sandboxRuntime,workspaceUtil}.js`,
  `cli/commands/sandboxCommands.js`, and the relevant DS specs to
  produce a structural map of how `lite-sandbox` dispatches today. I
  spot-checked the dispatch claim in `common.js:533-562` and the
  bwrap-path claim in `bwrapServiceManager.js:90,587` directly before
  writing this proposal. Findings about the wider bwrap/seatbelt
  argv-building code are attributed to that survey and not personally
  re-verified line-by-line.
- **Not verified**: I have not built the proposed Docker image, have
  not measured whether bubblewrap actually starts inside a
  Docker-Desktop-VM container with the proposed flags, and have not
  prototyped the AgentServer-side MCP tool registration. Those are the
  first concrete validation steps before this proposal becomes a PR.
