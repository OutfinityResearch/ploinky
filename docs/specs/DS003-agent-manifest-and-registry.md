---
id: DS003
title: Agent Manifest and Registry
status: implemented
owner: ploinky-team
summary: Defines how Ploinky discovers agent manifests, records enabled agents, and interprets manifest directives that affect workspace composition.
---

# DS003 Agent Manifest and Registry

## Introduction

Ploinky does not operate on anonymous directories. It discovers runnable units through `manifest.json` files and persists operator choices in a workspace registry. This document defines the manifest-driven and registry-driven contract.

## Core Content

An installed agent must be discoverable as a directory under `.ploinky/repos/<repo>/` that contains `manifest.json`. The agent descriptor exposed to the rest of the runtime is formed from the repository name, the short agent directory name, and the parsed manifest content.

When an operator enables an agent, Ploinky must persist a registry record in `.ploinky/agents.json` with enough information to restart that agent reproducibly. That record must retain the repository name, short agent name, run mode, project path, alias when present, and normalized auth policy when local or SSO auth is in use.

Alias handling is part of the stable contract. Aliases must be unique inside the workspace, must follow the repository’s allowed character set, and must be treated as route keys and container-name differentiators. Commands that target a specific running alias must be able to use that alias instead of the canonical short agent name.

The manifest surface may define startup commands, CLI commands, readiness hints, dependencies, profiles, runtime resources, local password defaults, SSO-provider markers, repository bootstrap directives, and enable directives. Manifest `enable` entries may pull in additional agents and may attach aliases. Manifest `repos` entries may clone and enable repositories before dependent agents are resolved.

Manifest enablement is conditional for SSO providers. If a dependency manifest sets `ssoProvider: true`, it should only be auto-enabled for a dependent manifest when that dependent resolved to SSO mode. This keeps password-only or no-auth workspaces from booting unused SSO-provider dependencies.

The manifest `container` (or `image`) field may template `${VAR}` references against the agent's resolved environment. Resolution order is the agent's manifest env (decrypted Ploinky secrets and manifest-declared defaults, via the same env map the runtime injects into the container) and then `process.env`. An unresolved reference must fail at agent start with a clear error rather than running a malformed image string. Templating is the supported way to pin a container version (for example `livekit/livekit-server:${WEBMEET_LIVEKIT_VERSION}`) while keeping the version in a workspace var or operator-controlled deploy input rather than baking a tag into the manifest.

The manifest `network` object selects the container's network namespace. The default is a workspace-defined bridge selected by `network.name` (with optional `network.aliases` for sibling DNS). When an agent declares `network.mode: "host"`, the runtime must run the container with `--network host`, must not create or attach a named bridge, must not emit `-p` port publishes, and must not register network aliases. Host-network agents still declare `ports` for documentation and readiness probing; the runtime treats those declarations as probe metadata only. Sibling agents on a bridge can reach a host-network agent through the runtime-provided host gateway entry (for example `host.containers.internal`) rather than through a bridge alias.

## Decisions & Questions

### Question #1: Why are SSO-provider dependencies conditionally enabled?

Response:
The implementation checks whether a dependent manifest resolves to SSO mode before auto-enabling a provider marked with `ssoProvider: true`. This avoids starting unnecessary SSO-provider agents in workspaces that use token-based or local-password access and keeps manifest dependency behavior aligned with the chosen auth path.

### Question #2: Why do aliases participate in both routing and execution identity?

Response:
The router needs a stable per-instance route key, and the runtime needs a stable per-instance container or process identity. Using the alias for both preserves a single operator-visible naming surface for multi-instance agents and avoids having route names diverge from runtime names.

### Question #3: Why is `network.mode: "host"` exposed instead of letting agents define ports more aggressively?

Response:
Some workloads, notably WebRTC SFUs such as LiveKit, are broken by the source-address rewriting that podman's bridge UDP port-publishing performs. The SFU learns peers at bridge-internal addresses and sends server-initiated UDP back inside the bridge, so subscriber media never reaches the real client. Modeling host networking as an explicit manifest-level mode keeps the workspace decision visible, scoped to a single agent, and consistent with the rest of the manifest contract instead of relying on out-of-band container flags.

### Question #4: Why is `${VAR}` expanded in the `container` field instead of forcing a hard-coded image tag?

Response:
The image tag is part of the deploy contract that operators tune through workspace vars and CI inputs (for example `WEBMEET_LIVEKIT_VERSION`). Allowing `${VAR}` in `container` lets a single manifest serve `dev`, `qa`, and `prod` profiles with profile-specific or operator-overridden versions without forking the manifest. Failing closed on an unresolved reference forces the operator to set the var, which is preferable to silently running a stale or wrong image.

## Conclusion

The manifest and registry layers define what an agent is, how it is named, and how workspace state persists operator choices. Ploinky must continue to interpret manifest directives and registry entries consistently so that startup, routing, and auth flows remain reproducible.
