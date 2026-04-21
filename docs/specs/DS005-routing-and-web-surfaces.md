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

The router must provide first-party browser surfaces at `/webtty`, `/webchat`, `/webmeet`, `/dashboard`, and `/status`. Each surface owns its own login endpoint, session cookie, and fallback asset directory under `cli/server/<surface>/`. Token-based local access is managed through `WEBTTY_TOKEN`, `WEBCHAT_TOKEN`, `WEBMEET_TOKEN`, and `WEBDASHBOARD_TOKEN`; the read-only `/status` surface reuses the dashboard-token namespace for invitation-style access. Asset resolution may also consult the static host root and `webLibs/`, but the documented fallback implementation for the first-party surfaces lives under `cli/server/`.

The router must also expose:

- `/health` for health status.
- `/upload` and `/blobs` for workspace and agent blob flows.
- `/mcp` for router-level MCP aggregation.
- `/mcps/<agent>/mcp` and `/mcp/<agent>/mcp` for agent MCP proxying.
- `/mcps/<agent>/task` for task-status passthrough.
- configured HTTP service prefixes for special downstream HTTP services.

When the static agent is not yet ready to serve its own static assets, the router may serve a temporary bootstrap page that reloads until the agent becomes ready. This bootstrap behavior is part of the current user-facing contract and should remain documented.

## Decisions & Questions

### Question #1: Why does the repository document `cli/server/dashboard/` as the active dashboard surface instead of the root-level `dashboard/` directory?

Response:
The current router handlers resolve the active dashboard fallback from `cli/server/dashboard/`. The root-level `dashboard/` directory is present in the repository but is not the fallback path used by the routed `/dashboard` implementation on this branch, so the documentation must follow the active handler path.

### Question #2: Why does Ploinky expose both router-level and agent-level MCP routes?

Response:
The router-level path aggregates tools and resources across agents, while the agent-level paths proxy directly to a single provider. The split allows the browser or CLI to either ask for a workspace-wide MCP surface or to target one agent explicitly without collapsing those two responsibilities into one endpoint.

## Conclusion

Ploinky’s routed interface depends on a supervised router, a persisted route table, and stable prefixed browser surfaces. The implementation and the documentation must continue to describe those route families and their current fallback asset locations accurately.
