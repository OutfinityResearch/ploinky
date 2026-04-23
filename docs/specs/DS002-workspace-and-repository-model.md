---
id: DS002
title: Workspace and Repository Model
status: implemented
owner: ploinky-team
summary: Defines how Ploinky discovers the workspace root, stores runtime state under .ploinky, and manages cloned and enabled repositories.
---

# DS002 Workspace and Repository Model

## Introduction

Ploinky’s runtime contract begins with workspace discovery and repository management. The implementation assumes a workspace root anchored by `.ploinky/`, and the rest of the runtime builds on that assumption.

## Core Content

The workspace root must be the nearest ancestor directory that contains `.ploinky/`. If no such directory is found, the current working directory becomes the effective root and `initEnvironment()` will create `.ploinky/` there. The runtime must not silently spread state across multiple unrelated roots inside one command invocation.

The repository must store workspace runtime state under `.ploinky/`, including at minimum:

- `agents.json` for enabled-agent records and workspace configuration.
- `enabled_repos.json` for enabled repository names.
- `repos/` for cloned repositories.
- `agents/`, `code/`, and `skills/` for working directories and symlink projections.
- `logs/`, `running/`, `deps/`, `keys/`, and `transcripts/` for live runtime state.
- `.secrets` and `profile` for workspace-local configuration.

Repository installation must clone into `.ploinky/repos/<name>/`. Predefined repositories are resolved through the built-in catalog in `cli/services/repos.js`, while custom repositories may provide their own URL. Skills-only repositories are not valid targets for `enable repo`; they must instead be consumed through `default-skills`.

The all-repository `update` flow must update repositories under `.ploinky/repos/` and then update project repositories discovered from a project search root. When the operator provides a folder path, discovery starts from that path. When no folder path is provided, discovery starts from the current working directory. Discovery must include the search root itself when it is a git repository, recurse through ordinary child directories, and skip runtime or generated directories such as `.ploinky/`, `.git/`, `node_modules/`, and `globalDeps/`.

Enabled repositories constrain discovery when `enabled_repos.json` is populated. If no repositories are explicitly enabled, installed repositories remain discoverable by default. This fallback is part of the user-facing repository model and must remain documented as such.

Agent source and skill trees must be projected into `.ploinky/code/<agent>/` and `.ploinky/skills/<agent>/` through symlinks when an agent is enabled. If a real directory blocks a symlink target, the runtime may warn and skip that symlink rather than destroying the existing path.

## Decisions & Questions

### Question #1: Why is workspace discovery anchored by `.ploinky/` instead of a fixed repository root?

Response:
The CLI is intended to run from arbitrary directories inside a workspace. Anchoring discovery to `.ploinky/` allows commands such as `ploinky status`, `ploinky-shell`, and routed browser helpers to work from subdirectories without requiring the operator to return to one fixed source root.

### Question #2: Why do installed repositories remain discoverable when no explicit enabled list exists?

Response:
This preserves a workable default for freshly initialized workspaces and matches the current implementation in `getActiveRepos()`. The explicit enabled list narrows discovery only when the operator has chosen to manage that list, which keeps first-run behavior simpler without removing the ability to curate visible repositories later.

### Question #3: Why does `update` default project discovery to the current working directory?

Response:
The command is intended to act on the directory where the operator runs it, matching the normal shell expectation for commands that accept an optional root path. Operators can still provide a folder path to broaden, narrow, or redirect discovery, including pointing directly at a single repository root.

## Conclusion

The workspace and repository model centers on a single `.ploinky/` root, repository clones under that root, and a predictable state layout. The runtime and documentation must continue to describe and preserve that layout as the foundation for all higher-level behavior.
