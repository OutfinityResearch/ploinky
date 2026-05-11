---
id: DS004
title: Runtime Execution and Isolation
status: implemented
owner: ploinky-team
summary: Defines how Ploinky selects execution backends, mounts code and skills, supervises agent services, and applies runtime resources.
---

# DS004 Runtime Execution and Isolation

## Introduction

Ploinky runs agents through multiple backend styles, but it must present one coherent runtime contract to the workspace. This document defines the backend, mount, and service-supervision rules that the implementation currently enforces.

## Core Content

Container execution is the default backend. The runtime must prefer `podman` when it is available and fall back to `docker` otherwise. Agent container names must be derived from the repository name, the agent or alias name, and a workspace hash so that multiple workspaces can run the same agent names without collisions.

The container's network namespace is selected from the manifest. The default is a workspace-defined bridge by name; agents that opt into `network.mode: "host"` run with `--network host` and share the host's network namespace directly. The runtime must not emit `-p` port publishes for host-network agents, must not register bridge aliases for them, and must not create a named bridge on their behalf. Sibling agents on a bridge that need to reach a host-network agent must route through the host gateway entry the runtime exposes (`host.containers.internal` on podman with netavark, or the bridge gateway IP); manifest defaults that previously assumed a bridge alias must be either re-pointed or made overridable through operator-supplied vars when the dependency moves to host networking.

Existing container reuse must compare both the resolved runtime environment and the effective manifest network (`profiles.<profile>.network` when present, otherwise root `manifest.network`). If the effective network changes, the runtime must recreate the container instead of returning an instance attached to the old namespace.

The runtime may also execute agents through host sandbox backends when the manifest sets `lite-sandbox: true`, but host sandboxes are disabled by default per workspace. Operators must explicitly run `ploinky sandbox enable` to opt into host sandboxes; until then, manifests requesting `lite-sandbox: true` use the container runtime. Once enabled, Linux hosts must select `bwrap`; macOS hosts must select `seatbelt`; unsupported or misconfigured hosts must fail with operator guidance. Ploinky must not silently fall back from a requested host sandbox to containers when the operator has opted in. The environment variable `PLOINKY_DISABLE_HOST_SANDBOX=1` forces the disabled state regardless of workspace configuration.

Each agent execution environment must expose the shared `Agent/` payload at `/Agent` for container backends or the equivalent runtime location for sandbox backends. If a manifest does not provide an explicit agent command, the runtime must fall back to `Agent/server/AgentServer.sh`, which supervises `AgentServer.mjs` and restarts it after exit.

Code and skills mounts must be profile-aware. The active profile defaults to `dev`, where code and skills are writable unless overridden. In `qa` and `prod`, code and skills default to read-only unless the profile explicitly relaxes them. The profile merge order is `profiles.default` plus the selected profile overlay. Workspace-root write access must not bypass read-only code, dependency-cache, staged Agent library, or protected Ploinky state paths.

Manifest volume declarations must create missing host directories before startup. Relative host paths are resolved against the workspace root. Runtime resources declared under `runtime.resources` may create persistent storage under `.ploinky/data/<key>/` and may materialize environment variables from workspace paths, persisted secrets, and variable references.

The static agent’s preinstall host hook must be allowed to run before dependency startup begins. This is part of the current startup contract because dependent services may require variables or files that the static agent’s preinstall hook creates before the dependency graph is expanded into startup waves.

## Decisions & Questions

### Question #1: Why does the static agent’s preinstall hook run before dependency startup?

Response:
The implementation explicitly runs the static agent’s preinstall hook before manifest directives and dependency waves are applied. This ordering allows the static agent to seed workspace variables or files that dependent agents consume during their own startup and matches the current behavior in `startWorkspace()`.

### Question #2: Why are mount permissions profile-driven instead of being hardcoded per runtime?

Response:
The repository already supports multiple deployment stances through `dev`, `qa`, and `prod`. Mount policy is therefore an operational concern, not a property of one backend. Keeping it profile-driven allows the same agent manifest to run with writable development mounts and read-only higher-assurance mounts without forking the runtime implementation.

### Question #3: Why is host networking handled at the manifest layer rather than as a runtime flag?

Response:
Host networking changes the agent's port surface, its DNS resolution, and the way siblings address it; that affects manifest content (no `-p` flags, no bridge aliases, sibling URL configuration) more than it affects the implementation. Modeling it as `network.mode: "host"` in the manifest keeps the choice declarative, visible to operators, reflected in the manifest registry, and reproducible across `podman` and `docker` runtimes without bespoke flags at the call site.

## Conclusion

Ploinky’s runtime layer must continue to provide predictable service startup across container and sandbox backends, preserve the shared `Agent/` payload, avoid implicit backend fallbacks, and apply profile-aware isolation rules that are visible to operators and tests.
