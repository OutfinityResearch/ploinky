# Ploinky Overview

Ploinky is a workspace-local runtime for repository-backed agents.

## Workspace model

- The workspace root is the nearest directory that contains `.ploinky/`.
- Runtime state lives under `.ploinky/`, including `agents.json`, `routing.json`, `.secrets`, `repos/`, `deps/`, `logs/`, `keys/`, and `transcripts/`.
- Agent repositories are cloned under `.ploinky/repos/<repo>/`.
- The default `start` flow requires a static agent and router port the first time, then reuses the saved configuration.

## Common CLI commands

- `ploinky add repo <name> [url] [branch]`: clone a repository into `.ploinky/repos/`.
- `ploinky enable repo <name> [branch]`: enable a repository for discovery and listings.
- `ploinky enable agent <name|repo/name> [global|devel [repo]] [--auth none|pwd|sso] [as <alias>]`: register an agent in `.ploinky/agents.json`.
- `ploinky start [staticAgent] [port]`: resolve dependency waves, start enabled agents, write `routing.json`, and launch the router under the watchdog.
- `ploinky status`: show router, route, repo, and enabled-agent state.
- `ploinky restart`: restart enabled agents and the router.
- `ploinky shell <agent>`: open `/bin/sh` inside the running agent backend.
- `ploinky cli <agent> [args...]`: run the manifest CLI command interactively.
- `ploinky stop`: stop enabled agents and the router without removing runtime state.
- `ploinky shutdown`: stop and remove enabled agent containers.
- `ploinky destroy`: stop the router, remove runtime containers, and clear workspace runtime state for the active workspace.

## Web surfaces

- `/webtty`: browser terminal.
- `/webchat`: chat surface over the same TTY stream, with encrypted transcript storage.
- `/webmeet`: meeting and moderator UI.
- `/dashboard`: management surface, including transcript and feedback views.
- `/status`: browser view over `ploinky status`.

These surfaces usually require per-surface tokens unless an authenticated user session already exists through local auth or SSO.

## Auth and capabilities

- Local auth stores hashed credentials in a workspace variable such as `PLOINKY_AUTH_<ROUTE>_USERS`.
- SSO binds the workspace alias `sso` to an installed `auth-provider/v1` agent.
- Capability discovery is manifest-driven through `provides` and `requires`.
- Delegated MCP tool calls use router-signed invocation tokens and agent keypairs stored under `.ploinky/keys/`.

## Dependency and profile commands

- `ploinky deps prepare [<repo>/<agent>]`: prepare runtime-keyed dependency caches.
- `ploinky deps status`: show cache validity.
- `ploinky deps clean <repo>/<agent>|--global|--all`: remove caches.
- `ploinky profile <dev|qa|prod>`: switch the active profile.
- `ploinky profile show|list|validate`: inspect profile state.

## Secrets and skills

- `ploinky vars`, `ploinky var <NAME> <value>`, and `ploinky echo <NAME>` manage `.ploinky/.secrets`.
- `ploinky expose <ENV_NAME> [<$VAR|value>] [agent]` maps values into agent environments.
- `ploinky default-skills <repoName>` copies skills from a skills repository into `.claude/skills/` and `.agents/skills/`.

## LLM helper behavior

- `ploinky-shell` is a shell-oriented entry point that asks the configured LLM for command suggestions.
- Invalid CLI input can also trigger LLM suggestions.
- The LLM helper uses this file as context, so this overview must stay in sync with the current CLI behavior.
