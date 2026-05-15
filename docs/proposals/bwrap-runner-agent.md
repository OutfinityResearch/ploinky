---
title: Containerized bwrap Runner Agent Proposal
status: implemented (v1 tool-provider)
date: 2026-05-13
owner: ploinky-team
---

# Containerized bwrap Runner Agent Proposal

## Implementation Status

v1 of the tool-provider runner is implemented as the Basic catalog
`bwrap-runner` agent. The agent ships a
`Dockerfile` (Debian Bookworm slim + Node 20 + bubblewrap), `manifest.json`,
`mcp-config.json` exposing a single `sandbox_exec` tool, a typed policy
builder in `bwrap-runner/lib/policy.mjs`, and a startup `healthcheck.sh`
that runs a real nested-bwrap smoke command. Focused Basic repository unit
tests cover the policy builder under `tests/unit/bwrapRunnerPolicy.test.mjs`,
and a gracefully-skipping smoke test for the nested-bwrap health probe lives
at `tests/unit/bwrapRunnerSmoke.test.mjs`.

Implementation deltas vs the proposal:

- Image reference in the manifest is `${BWRAP_RUNNER_IMAGE}` with a
  default of `ploinky/bwrap-runner:node20-bookworm`. The default profile
  runs `scripts/build-image.sh` as a host `preinstall` hook, so first
  startup builds the local image with Podman or Docker when it is not
  already present. Operators can still override `BWRAP_RUNNER_IMAGE` if
  they want to use a pre-published image.
- The agent is not part of the Ploinky core tree. It is installed through
  the normal Basic repository layout, so `findAgent('bwrap-runner')` resolves
  through `.ploinky/repos/basic/bwrap-runner/` when the Basic repository is
  present and the short name is unambiguous.
- The runner state env var is `BWRAP_RUNNER_STATE`; the wrapper also
  honors `PLOINKY_BWRAP_RUNNER_STATE` for compatibility.
- Job working/output paths are bound at `/work` and `/outputs`. Inputs
  mount support is reserved for a follow-up iteration.
- The manifest `agent` command runs `bin/healthcheck.mjs` before
  `AgentServer.sh`, making nested-bwrap support a startup gate. The
  existing `health.readiness.script` probe also runs the same health check
  after startup.
- The wrapper rejects any extra top-level field on the JSON payload (for
  example `mounts`, `binds`, or raw `bwrap` flags), so the policy surface
  stays narrow and typed.
- `getRuntimeForAgent()` is not modified and `lite-sandbox: true` is not
  re-routed; this is sandboxed job delegation through MCP, not a host
  bwrap replacement.

## Reconciliation Status

This is the merged recommendation after comparing this proposal with `docs/handoffs/bwrap-agent-proposal.md` against the current runtime code and DS003, DS004, and DS011. The handoff draft remains useful background, especially for privilege tradeoffs and acceptance criteria, but its claim that a normal agent can replace host bwrap for `lite-sandbox: true` is not the recommended v1 path.

## Problem

Ploinky already supports host sandboxes through `lite-sandbox: true`: Linux selects bubblewrap (`bwrap`) and macOS selects Seatbelt (`sandbox-exec`). That path is useful, but it depends on host setup:

- `ploinky sandbox enable` must be run because host sandboxes are disabled by default.
- Linux must have `bwrap` installed and executable.
- The host kernel and distribution policy must allow the namespace operations bwrap needs.
- The current implementation detects `command -v bwrap`, then starts `/usr/bin/bwrap`, so nonstandard install paths can still fail at launch.

The goal of this proposal is to avoid host-level bwrap setup for sandboxed jobs by shipping a Ploinky agent whose container image is a Linux environment with bwrap already installed and health-checked.

## Current Codebase Facts

The current runtime contract is split by backend:

- `cli/services/docker/common.js` resolves the backend in `getRuntimeForAgent()`.
- Container execution is the default. Ploinky probes `podman` first and falls back to `docker`.
- `lite-sandbox: true` does not mean "container with bwrap". When host sandboxes are enabled, it means `bwrap` on Linux or `seatbelt` on macOS. When host sandboxes are disabled, the same manifest uses the container backend.
- Once the operator opts into host sandboxes, missing or broken host sandbox support fails with guidance. Ploinky does not silently fall back to containers.
- `cli/commands/sandboxCommands.js` persists the workspace switch. The default is disabled; `sandbox enable` writes `sandbox.disableHostRuntimes = false`.
- `cli/services/bwrap/bwrapServiceManager.js` starts host bwrap processes directly, records PIDs under `.ploinky/bwrap-pids/`, clears the environment, binds `/Agent`, `/code`, dependency caches, `/shared`, declared volumes, and runtime resources, and unshares PID but not network.
- The container path in `cli/services/docker/agentServiceManager.js` starts an OCI container with `/Agent`, `/code`, prepared dependency caches, `/shared`, the configured project path, profile-aware code and skills mount modes, manifest volumes under `.ploinky/`, runtime resources, ports, and manifest network settings.
- Ploinky does not currently expose manifest fields for OCI flags such as `--userns`, `--security-opt`, `--cap-add`, `--cap-drop`, `--pids-limit`, `--memory`, or `--read-only`.

Docs that already encode this contract:

- `docs/specs/DS003-agent-manifest-and-registry.md`
- `docs/specs/DS004-runtime-execution-and-isolation.md`
- `docs/specs/DS011-security-model.md`
- `docs/runtime.html`
- `docs/spec-agent.html`

## Feasibility Answer

Yes, Ploinky can ship a `bwrap-runner` agent that runs inside a Linux container and exposes a tool for sandboxed command execution. This is the right first step.

However, it should not be treated as a drop-in replacement for `lite-sandbox: true`.

`lite-sandbox: true` is currently a backend selector for an entire agent process. A containerized runner agent would instead be a sandbox execution provider: other agents call it through the router, and it runs one job at a time or a bounded number of jobs inside inner bwrap sandboxes. That solves "run this risky command or generated code in a prepared bwrap Linux environment" without changing the existing host-sandbox contract.

Transparent replacement of the host bwrap backend is possible, but it is a larger second phase. It would require a new runtime backend that delegates lifecycle operations to a provider agent: start service, stop service, exec shell, read logs, probe readiness, publish or proxy ports, and persist registry state. That should not be folded into the initial runner.

## Recommended Design

Create a new agent repository, for example `ploinky-bwrap-runner`, with:

- `Dockerfile`
- `manifest.json`
- `mcp-config.json`
- `bin/sandbox-exec.mjs`
- `bin/healthcheck.mjs`
- focused tests for wrapper argument generation and policy enforcement

The runner image should be based on a normal Linux Node image, for example Debian slim rather than Alpine, because the existing Ploinky dependency-cache logic already distinguishes container libc variants and Debian gives predictable `bubblewrap` packaging.

Example image shape:

```Dockerfile
FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap ca-certificates bash coreutils findutils grep sed git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code
```

The manifest should run through normal Ploinky container execution, not `lite-sandbox`:

```json
{
  "container": "ghcr.io/plonkyrepos/ploinky-bwrap-runner:node20-bookworm",
  "about": "Runs bounded commands inside inner bubblewrap sandboxes",
  "readiness": { "protocol": "mcp" },
  "profiles": {
    "default": {
      "ports": ["127.0.0.1:7119:7000"],
      "mounts": {
        "code": "ro",
        "skills": "ro"
      }
    }
  },
  "runtime": {
    "resources": {
      "persistentStorage": {
        "key": "bwrap-runner",
        "containerPath": "/var/lib/ploinky-bwrap-runner",
        "chmod": 448
      },
      "env": {
        "PLOINKY_BWRAP_RUNNER_STATE": "{{STORAGE_CONTAINER_PATH}}"
      }
    }
  }
}
```

`mcp-config.json` should expose a single default tool first:

```json
{
  "tools": [
    {
      "name": "sandbox_exec",
      "title": "Sandbox Exec",
      "description": "Run a bounded command inside a bwrap sandbox",
      "command": "bin/sandbox-exec.mjs",
      "cwd": "/code",
      "timeoutMs": 120000,
      "inputSchema": {
        "command": { "type": "string", "minLength": 1, "maxLength": 4096 },
        "stdin": { "type": "string", "optional": true, "maxLength": 1048576 },
        "timeoutMs": { "type": "number", "optional": true, "min": 100, "max": 120000 },
        "network": { "type": "string", "optional": true, "enum": ["none", "inherit"] },
        "env": {
          "type": "object",
          "optional": true,
          "additionalProperties": true
        }
      }
    }
  ]
}
```

The wrapper should read the JSON payload from stdin, validate it again locally, create a per-job directory under `PLOINKY_BWRAP_RUNNER_STATE/jobs/<id>/`, write optional stdin to a file, and then invoke bwrap with a fixed policy.

Default policy:

- `--die-with-parent`
- `--unshare-user`
- `--unshare-pid`
- `--unshare-ipc`
- `--unshare-uts`
- `--unshare-net` unless the request explicitly asks for `network: "inherit"` and the runner profile permits networked jobs
- `--clearenv`
- allowlisted env only: `PATH`, `HOME`, `TMPDIR`, `LANG`, plus explicit user env after validation
- read-only system binds for `/usr`, `/bin`, `/lib`, `/lib64`, and certificate/resolver files that exist in the image
- `--proc /proc`
- `--dev /dev`
- `--tmpfs /tmp`
- read-write bind of only the per-job work directory at `/work`
- optional read-only bind of prepared input artifacts under `/inputs`
- optional read-write bind of an output directory at `/outputs`
- `--chdir /work`
- command executed through `/bin/sh -lc <command>` for MVP ergonomics

The wrapper should return structured JSON or text containing:

- exit code
- signal
- stdout tail
- stderr tail
- elapsed time
- job id
- output directory path when outputs are retained

## Container Runtime Requirements

The runner moves bwrap setup from the host filesystem into the image, but it cannot remove all host and OCI runtime constraints. Bubblewrap relies on Linux namespaces, and the upstream bubblewrap README says the protection level is determined by the bwrap arguments used by the calling framework. The runner must therefore health-check the actual nested bwrap capability during agent startup, not only check that `/usr/bin/bwrap` exists.

The health check should run a minimal nested namespace command similar to:

```bash
bwrap \
  --die-with-parent \
  --unshare-user \
  --unshare-pid \
  --ro-bind /usr /usr \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  -- /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/true
```

If this fails, the runner should fail readiness with the exact stderr and guidance. Common causes include host kernel user namespaces being disabled, the outer container runtime blocking namespace creation, or an overly restrictive seccomp/AppArmor profile. These settings cannot be made portable by baking sysctls or host policy into the image; the image can supply `bwrap`, but the host and outer OCI runtime still decide whether nested namespace creation is permitted.

Ploinky currently has no manifest-level way to pass extra OCI flags, so the first implementation should aim to work with default Podman/Docker settings and fail clearly when the runtime blocks nested bwrap. If that is not reliable enough, add a narrowly-scoped container options feature to Ploinky.

Examples of runtime settings that may be needed on some hosts include relaxed seccomp or AppArmor policy, user namespace configuration, process limits, memory limits, or tmpfs mounts. They should be expressed through a typed allowlist, not raw string fragments and not a hidden special case for one agent.

Proposed future manifest extension:

```json
{
  "runtime": {
    "containerOptions": {
      "userns": "keep-id",
      "securityOpt": [],
      "capAdd": [],
      "capDrop": ["ALL"],
      "pidsLimit": 256,
      "memory": "1g",
      "readOnlyRootfs": false,
      "tmpfs": ["/tmp:rw,nosuid,nodev,size=512m"]
    }
  }
}
```

That extension must be allowlisted and tested in `startAgentContainer()`. It should not accept raw string fragments because container flags are privileged deployment policy.

## Security Model

The runner improves portability and repeatability, but it does not make arbitrary hostile code safe in the strong multi-tenant sense.

Security boundaries:

- The outer Ploinky container isolates the runner from the host according to Docker/Podman policy and Ploinky mount policy.
- The inner bwrap sandbox isolates the requested job from the runner container filesystem according to the wrapper's bwrap arguments.
- The runner process remains trusted. It can see the mounted Ploinky surfaces that its own manifest receives.
- The job should not receive `PLOINKY_DERIVED_MASTER_KEY`, router invocation tokens, workspace secrets, or the runner's full environment.
- Network access should default to off for jobs. Networked jobs should be an explicit runner policy decision.
- Inputs and outputs should go through per-job directories, not arbitrary host or workspace path binds.
- Resource limits need outer-container support for CPU, memory, and process counts. Bwrap alone is not a resource-governance solution.

The trust chain is:

```text
caller agent -> router invocation JWT -> bwrap-runner container -> inner bwrap job
```

The runner container is a trusted provider agent. If future validation shows it needs relaxed outer-container hardening to run nested bwrap, that relaxation must be documented as an explicit operator grant. A compromise of the runner process has the same shared-HMAC risk described in DS011 for any agent that receives `PLOINKY_DERIVED_MASTER_KEY`; the inner job must not receive that secret.

The runner should be documented as defense in depth for operator-enabled code, consistent with DS011. It should not be documented as tenant isolation.

## Integration Patterns

### Phase 1: Tool Provider

Enable the runner as a normal agent:

```bash
enable agent bwrap-runner
start <staticAgent> <port>
client tool sandbox_exec --agent bwrap-runner -p command='node -e "console.log(1+1)"'
```

Other agents can call `sandbox_exec` through the router's MCP proxy. This keeps secure-wire invocation and route audit behavior in the normal path.

This phase needs no changes to `lite-sandbox`. It may need one small documentation update once the runner exists.

### Phase 2: First-Class Sandbox Provider

Add a provider declaration without changing `lite-sandbox`:

```json
{
  "sandboxProvider": {
    "type": "bwrap-runner",
    "agent": "bwrap-runner"
  }
}
```

This lets agents intentionally delegate risky tools to the runner while still starting their normal service process in their own container.

### Phase 3: Delegated Runtime Backend

Only if we need long-running sandboxed services without host bwrap, introduce a new runtime family such as `sandbox-agent`.

Required provider tools:

- `sandbox_start_service`
- `sandbox_stop_service`
- `sandbox_exec`
- `sandbox_status`
- `sandbox_logs`
- `sandbox_probe`

Required core changes:

- Extend `getRuntimeForAgent()` with a new manifest field. Do not overload `lite-sandbox`.
- Add a runtime manager parallel to `bwrapServiceManager.js` and `agentServiceManager.js`.
- Persist registry records with `runtime: "sandbox-agent"` and provider agent metadata.
- Make `containerMonitor.js`, `workspaceUtil.js`, shell attach, restart, health probes, and route registration provider-aware.
- Decide how provider-managed service ports are allocated and proxied. The runner probably needs an internal reverse proxy or a fixed localhost port range exposed by the outer container.
- Decide how dependency caches are prepared. Child services inside the runner use the runner image runtime, not the host bwrap runtime key.

This phase is substantial and should follow the simpler tool-provider design only after real usage proves it is needed.

## Acceptance Criteria

For the tool-provider v1 to be accepted:

1. The runner starts through normal Ploinky container execution without `lite-sandbox: true`.
2. Startup readiness runs a real nested-bwrap health check and reports actionable stderr when blocked by the host or OCI runtime.
3. `sandbox_exec` returns exit code, signal, elapsed time, bounded stdout, bounded stderr, and job id.
4. The default job policy clears the environment, disables network, exposes only allowlisted system reads, and gives write access only to the per-job work/output paths.
5. Tests prove env clearing, timeout handling, output truncation, default no-network behavior, and denial of reads outside the inner bind policy.
6. Documentation clearly says this is sandboxed job delegation, not a transparent replacement for host bwrap or Seatbelt whole-agent sandboxing.

## Implementation Plan

1. Create `ploinky-bwrap-runner` agent repo with the Dockerfile, manifest, `mcp-config.json`, wrapper, and health check.
2. Make the wrapper generate bwrap args from a typed policy object, not string concatenation.
3. Add wrapper unit tests for default no-network policy, env clearing, workdir-only write access, stdout/stderr truncation, timeout, and rejection of unsafe payloads.
4. Add an integration smoke test that runs the image and verifies the nested bwrap health check under the supported local runtime.
5. Document the runner as an optional sandboxed job provider in `docs/runtime.html` and `docs/spec-agent.html`.
6. If default Podman/Docker settings are not reliable, add allowlisted `runtime.containerOptions` support in Ploinky and tests around generated run args.
7. Only after Phase 1 stabilizes, consider `sandboxProvider` or `sandbox-agent` runtime work.

## Open Questions

1. Should networked jobs be allowed at all in the MVP, or should network stay hard-disabled until there is a concrete use case?
2. Should job outputs be retained by default, or should callers opt into retention per request?
3. Do we want the runner image to include language toolchains beyond Node, or should those be mounted as explicit per-job input images later?
4. Should Ploinky core grow `runtime.containerOptions` for all agents, or should that be restricted to trusted runtime/provider agents?
5. Should command execution use `/bin/sh -lc` for ergonomics, or should the MVP require an argv array to reduce shell injection footguns for callers?

## Recommendation

Build the containerized bwrap runner as a normal Ploinky agent first. It gives us a portable Linux+bwrap execution target, keeps the existing `lite-sandbox` contract intact, and avoids a broad runtime rewrite.

Do not claim that this replaces host bwrap for `lite-sandbox: true`. It provides sandboxed job execution through an agent. A transparent delegated runtime backend should be a later, explicit feature with its own manifest field and registry/runtime manager support.

## References

- `docs/specs/DS004-runtime-execution-and-isolation.md`
- `docs/specs/DS011-security-model.md`
- `cli/services/docker/common.js`
- `cli/services/docker/agentServiceManager.js`
- `cli/services/bwrap/bwrapServiceManager.js`
- Upstream bubblewrap README: https://github.com/containers/bubblewrap/blob/main/README.md
