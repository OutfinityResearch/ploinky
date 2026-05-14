---
id: DS005
title: Routing and Web Surfaces
status: implemented
owner: ploinky-team
summary: Defines the router, watchdog, route table, static serving rules, and browser surfaces exposed by Ploinky.
---

# DS005 Routing and Web Surfaces

## Introduction

The routed interface is the operator-visible face of a running Ploinky workspace. This document defines the responsibilities of the watchdog, the router, the route table, and the prefixed browser surfaces.

## Core Content

The router must be supervised by `cli/server/Watchdog.js`, which launches and restarts `cli/server/RoutingServer.js`, records restart events, performs health checks against `/health`, and writes watchdog logs under `.ploinky/logs/watchdog.log`. The router itself must write request and lifecycle logs under `.ploinky/logs/router.log`.

The route table must be persisted in `.ploinky/routing.json`. It must contain the router port, the static agent metadata, and the current per-agent route entries resolved during startup. Static requests for `/`, `/index.html`, and static-agent entry aliases must resolve against the configured static host path from that file.

The router must provide first-party browser surfaces at `/webtty`, `/webchat`, `/webmeet`, `/dashboard`, and `/status`. Each surface owns its own session cookie and fallback asset directory under `cli/server/<surface>/`. `/webtty`, `/webchat`, and `/webmeet` must rely on the router login flow and the authenticated router session; they no longer accept surface-specific token login. `/dashboard` and the read-only `/status` surface continue to support dashboard-token access through `WEBDASHBOARD_TOKEN`. Asset resolution may also consult the static host root and `webLibs/`, but the documented fallback implementation for the first-party surfaces lives under `cli/server/`.

For `/webchat`, the router must treat `agent` as an explicit agent-selection query parameter and must preserve the remaining query parameters across the browser session endpoints. When a WebChat request selects an explicit agent, the router must forward every additional query parameter except router-reserved stream/session parameters such as `tabId` to that agent's `ploinky cli <agent>` launch as long-form CLI flags encoded as single `--key=value` tokens. The router must not hardcode ordinary target-agent parameter names for this forwarding behavior; interpretation belongs to the target agent CLI. The reserved compatibility parameters `workspace-dir`/`workspaceDir` and `workspace-skill-root`/`workspaceSkillRoot` are resolved by WebChat against the Ploinky workspace root and forwarded as absolute `--dir=` and `--skill-root=` values server-side so browser URLs can avoid leaking absolute host paths.

WebChat must remain a generic transport. It must not hardcode optional catalog agent ids, backend tags, MCP tool names, or domain-specific dispatch logic. Query parameters such as `feature-mode`, `tag-relay-agent`, or future agent-owned options are ordinary target-agent launch flags once they pass the router-reserved parameter filter. Their interpretation belongs to the selected agent CLI or to an explicitly configured downstream integration, not to Ploinky's router or WebChat handler.

When `/webchat` is launched with `forward-envelope=1`, messages may be written to the target TTY as the WebChat JSON envelope instead of plain text. The envelope may include sanitized attachment metadata, sanitized structured references (currently only `kind: "workspace-path"` records with `path`, `type`, and optional `label`), and a short-lived router-minted invocation token scoped to the selected chat agent, allowing that agent to perform delegated MCP calls through the router without WebChat naming the downstream provider. Reference paths must be workspace-relative; the server must drop entries containing absolute paths, traversal segments, NUL bytes, or reserved secret-file names before forwarding the envelope. Target CLIs that opt into this flag must tolerate `__webchatMessage` envelopes and normalize them before invoking their normal prompt flow; CLIs that do not recognize `references` must ignore them safely.

WebChat must provide a generic composer autocomplete surface driven by trigger providers. The composer controller owns menu lifecycle, keyboard navigation (Arrow Up/Down, Enter, Tab, Escape), pointer selection, grouped rendering, positioning, and insertion. Trigger providers supply suggestions:

- `/` opens the slash-command provider. The client queries the selected agent's MCP endpoint (`/mcps/<agent>/mcp`) for available tools. When the agent advertises a structured slash-command catalog tool, the provider uses that catalog; otherwise it maps `execute_<skill>` tool names to slash commands. If the catalog fetch fails or returns no tools, the slash group remains silent.
- `@` opens the tag-catalog and workspace-paths providers. The browser tag-catalog provider reads only the static `tag-relay-tags` launch parameter; it must not call arbitrary MCP tools named by browser URL parameters. Dynamic backend catalogs remain owned by the selected chat agent or downstream relay when an actual message is submitted with a router-minted invocation token. The workspace-paths provider queries `/webchat/suggestions/files` and shows files/folders relative to the WebChat working directory. Selecting a file inserts a stable `@file:<relative-path>` token and records a structured `workspace-path` reference on the outgoing envelope.

WebChat must not hardcode optional agent ids, backend tags, or agent-owned tool names for `@` suggestions. The browser tag-catalog provider must remain silent when no static `tag-relay-tags` configuration is supplied. Unknown `@word` mentions remain ordinary chat text unless the selected chat agent has explicitly configured them.

WebChat must expose `GET /webchat/suggestions/files` for the workspace-paths provider. The endpoint must require the same authenticated browser session as the surface, resolve a workspace-confined working directory from the same launch parameters used for `--dir`/`--skill-root` forwarding (`workspace-dir`/`workspaceDir`, with compatibility support for confined `dir`, falling back to the workspace root), and return relative file/folder candidates only. It must reject absolute caller paths, traversal (`..`), NUL bytes, symlink escapes outside the workspace root, and reserved secret files such as `.secrets` and `*.secrets`. Results must be capped and sorted with directories before files. Host absolute paths must never appear in the response.

WebChat must also expose a Cancel button during active agent processing. The Cancel button sends a raw control sequence (ESC, `\x1b`) to the agent's TTY session via a dedicated `/webchat/control` endpoint. The agent must interpret this as an interrupt signal and abort the current operation. The Cancel button replaces the Send button while processing is active and reverts when the agent produces output or the session closes.

The router must also expose:

- `/health` for health status.
- `/upload` and `/blobs` for workspace and agent blob flows.
- `/mcp` for router-level MCP aggregation.
- `/mcps/<agent>/mcp` and `/mcp/<agent>/mcp` for agent MCP proxying.
- `/mcps/<agent>/task` for task-status passthrough.
- manifest-declared HTTP service prefixes for downstream HTTP services.

HTTP service routes must be declared by the target agent rather than hard-coded into router handlers. An enabled agent may provide `httpServices` entries with an external prefix, internal upstream prefix, and auth mode. The router resolves those declarations from the route table and agent manifest, then forwards matching requests to the owning agent route. Public service declarations with `auth: "none"` intentionally run without router identity; `auth: "guest"` follows the normal guest policy, honoring an existing local session unless the declaration explicitly sets `forceGuest: true`, and otherwise mints a scoped guest session; protected declarations reuse the owning route's normal auth policy.

When the static agent is not yet ready to serve its own static assets, the router may serve a temporary bootstrap page that reloads until the agent becomes ready. This bootstrap behavior is part of the current user-facing contract and should remain documented.

## Decisions & Questions

### Question #1: Why does the repository document `cli/server/dashboard/` as the active dashboard surface instead of the root-level `dashboard/` directory?

Response:
The current router handlers resolve the active dashboard fallback from `cli/server/dashboard/`. The root-level `dashboard/` directory is present in the repository but is not the fallback path used by the routed `/dashboard` implementation on this branch, so the documentation must follow the active handler path.

### Question #2: Why does Ploinky expose both router-level and agent-level MCP routes?

Response:
The router-level path aggregates tools and resources across agents, while the agent-level paths proxy directly to a single provider. The split allows the browser or CLI to either ask for a workspace-wide MCP surface or to target one agent explicitly without collapsing those two responsibilities into one endpoint.

### Question #3: Why special-case workspace-relative WebChat launch parameters?

Response:
Most WebChat query parameters belong to the selected agent CLI and should be forwarded unchanged. Workspace-relative launch parameters are different because their purpose is to keep absolute host filesystem paths out of browser URLs while preserving the absolute `--dir` and `--skill-root` values expected by local CLIs such as AchillesCLI.

### Question #4: Why forbid hardcoded optional agent ids in WebChat?

Response:
Ploinky is the framework layer. If a first-party surface hardcodes a catalog agent, the framework takes ownership of that agent's lifecycle, tags, tool names, and security policy by accident. Agent-specific workflows must be declared by manifests, query parameters, plugins, or the selected agent's own runtime. WebChat may carry generic envelopes and invocation grants, but it must not decide that a particular message belongs to a particular catalog agent.

## Conclusion

Ploinky’s routed interface depends on a supervised router, a persisted route table, and stable prefixed browser surfaces. The implementation and the documentation must continue to describe those route families and their current fallback asset locations accurately.
