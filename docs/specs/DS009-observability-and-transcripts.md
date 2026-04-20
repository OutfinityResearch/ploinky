---
id: DS009
title: Observability and Transcripts
status: implemented
owner: ploinky-team
summary: Defines router and watchdog observability, encrypted WebChat transcript storage, retention, and feedback aggregation rules.
---

# DS009 Observability and Transcripts

## Introduction

Ploinky exposes operational state both through logs and through a transcript system used by WebChat and the Dashboard. This document defines the current observability and transcript guarantees.

## Core Content

The watchdog and router must emit structured operational logs under `.ploinky/logs/`. The CLI currently exposes router-log streaming and tail retrieval through `logs tail` and `logs last`, and the browser status surface may shell out to `ploinky status` to present a CLI-consistent view of workspace state.

The router health endpoint at `/health` must report process uptime, PID, memory usage, and active-session counts for the first-party browser surfaces and agent MCP sessions. This endpoint is part of the watchdog’s health-check loop and therefore forms part of the runtime stability contract.

WebChat transcripts must be stored under `.ploinky/transcripts/` as per-conversation JSON files. Message payloads must be encrypted at rest with a per-conversation data-encryption key, and that key must itself be wrapped by a master key derived from `PLOINKY_TRANSCRIPTS_MASTER_KEY`. If no master key exists, the runtime may generate one and persist it through workspace secret management.

Transcript records must include retention metadata, hashed identifiers for sessions and users, encrypted message content, and turn-level ratings. Rating a turn must apply to the assistant message and the paired user prompt so that feedback analytics can reason about whole exchanges rather than isolated assistant outputs.

Dashboard transcript access must be more restrictive than generic dashboard access. SSO users may require specific roles from `PLOINKY_TRANSCRIPT_VIEWER_ROLES`, while local sessions may only gain transcript access when `PLOINKY_TRANSCRIPT_VIEWER_ALLOW_LOCAL` explicitly allows it.

## Decisions & Questions

### Question #1: Why may the runtime generate and persist a transcript master key automatically?

Response:
Transcript encryption is meant to be usable in local workspaces without a separate manual provisioning step before the first chat session. Generating and persisting the key at first use keeps encrypted transcript storage operational while still retaining a durable workspace-scoped key instead of a transient in-memory secret.

### Question #2: Why does feedback aggregation treat the assistant reply as the source of truth for a rated turn?

Response:
The current implementation resolves turn feedback from the assistant message and then links back to the paired prompt through transcript metadata. This avoids double counting and matches the actual persistence path implemented by `setTurnRating()` and the dashboard feedback summary builder.

## Conclusion

Ploinky must continue to expose operational logs, health status, and encrypted transcript storage as deliberate runtime features. The documentation must preserve the distinction between general observability and restricted transcript access.
