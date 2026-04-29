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

## Decisions & Questions

### Question #1: Why are SSO-provider dependencies conditionally enabled?

Response:
The implementation checks whether a dependent manifest resolves to SSO mode before auto-enabling a provider marked with `ssoProvider: true`. This avoids starting unnecessary SSO-provider agents in workspaces that use token-based or local-password access and keeps manifest dependency behavior aligned with the chosen auth path.

### Question #2: Why do aliases participate in both routing and execution identity?

Response:
The router needs a stable per-instance route key, and the runtime needs a stable per-instance container or process identity. Using the alias for both preserves a single operator-visible naming surface for multi-instance agents and avoids having route names diverge from runtime names.

## Conclusion

The manifest and registry layers define what an agent is, how it is named, and how workspace state persists operator choices. Ploinky must continue to interpret manifest directives and registry entries consistently so that startup, routing, and auth flows remain reproducible.
