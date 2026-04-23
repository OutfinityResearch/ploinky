---
id: DS008
title: Secrets, Skills, and LLM Assistance
status: implemented
owner: ploinky-team
summary: Defines secret resolution, wildcard exposure rules, default-skills installation, repository-local skill boundaries, and the LLM helper inputs.
---

# DS008 Secrets, Skills, and LLM Assistance

## Introduction

Ploinky’s operator tooling depends on a shared secret-resolution model and on explicit boundaries around copied skills and LLM helper context. This document defines those support-layer contracts.

## Core Content

Secret resolution must prefer process environment variables, then `.ploinky/.secrets`, then the nearest `.env` file found by walking upward from the current working directory. This precedence model applies across runtime resource templating, auth configuration, dependency helpers, and LLM settings discovery.

Workspace variable commands must preserve explicit operator control. `var` writes workspace-local values, `vars` lists known names, `echo` resolves aliases, and `expose` maps values into agent environments. Wildcard expansion is allowed, but the all-match `*` pattern must exclude variable names containing `API_KEY` or `APIKEY`. Sensitive values therefore require explicit manifest or operator intent rather than accidental blanket inclusion.

`default-skills` must copy skill directories from a skills repository into `.claude/skills/` and `.agents/skills/` and must update `.gitignore` through the managed marker block. Existing copied skill directories must be replaced before copying so deleted upstream files do not remain locally. The copied skills are a workspace convenience and must not be documented as runtime product pages or runtime DS files for the host project.

When the all-repository `update` flow refreshes project repositories, it must install or refresh `AchillesCopilotBasicSkills` in every discovered project repository and update each repository's managed `.gitignore` block. A failure to clone the skills repository, copy the skills, or update `.gitignore` is a command failure, not just an informational warning.

The repository-local skills under `.agents/skills/` must be listed consistently in `AGENTS.md` and in the HTML documentation, but they remain maintenance tooling. Host-project docs may summarize them, yet must keep the DS set focused on Ploinky itself rather than creating one DS file per copied skill.

`ploinky-shell` and invalid-command fallback logic depend on Achilles LLM tooling. The helper must load model-key definitions from Achilles config, inspect available API keys, and include `docs/ploinky-overview.md` as its system context. That file is therefore part of the implemented command-suggestion surface and must be updated whenever command semantics or operator guidance changes.

## Decisions & Questions

### Question #1: Why are copied or local skills summarized instead of being expanded into host-project DS files?

Response:
The user-facing runtime is Ploinky, not the copied skill catalog. Summarizing the current skill catalog keeps repository maintenance discoverable without collapsing the host/runtime boundary that the GAMP rules require downstream projects to preserve.

### Question #2: Why is `docs/ploinky-overview.md` treated as part of the runtime contract?

Response:
The LLM helper in `cli/commands/llmSystemCommands.js` reads that file directly to shape command suggestions. Once a documentation file becomes executable context for a runtime feature, it is no longer optional prose; it is part of the operator-visible behavior and must stay synchronized with the CLI.

### Question #3: Why does skill refresh replace existing copied directories instead of only overwriting files?

Response:
The skills repository is the source of truth for copied skill payloads. A copy operation that only overwrites same-named files can leave stale files behind after upstream deletes or renames them. Replacing each copied skill directory before copying keeps the local discovery roots aligned with the selected skills repository while preserving the managed `.gitignore` block around those generated local installations.

## Conclusion

Secret resolution, skill installation, and LLM assistance are support layers, but they still define observable behavior. Ploinky must keep those layers explicit, predictable, and clearly bounded from the host-project runtime documentation surface.
