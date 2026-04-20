---
id: DS006
title: Auth, Capabilities, and Secure Wire
status: implemented
owner: ploinky-team
summary: Defines local auth, SSO provider binding, capability discovery, and the signed secure-wire path for delegated agent calls.
---

# DS006 Auth, Capabilities, and Secure Wire

## Introduction

Authentication and inter-agent trust in Ploinky are manifest-driven and workspace-scoped. This document defines the contracts for local auth, SSO binding, capability discovery, and signed delegated invocations.

## Core Content

The router authentication layer must normalize successful authentication onto request context so that protected handlers can rely on `req.user`, `req.session`, and `req.authMode` rather than on transport-specific details. Token-based surface login remains valid for first-party browser surfaces when SSO is not active. Local auth must validate hashed credentials stored in a workspace-managed variable, while SSO must bind the workspace alias `sso` to an installed provider that advertises `auth-provider/v1`.

Local auth users must be stored as hashed user records rather than plain-text credentials. Session state must be retained in the router-side session store, and local-auth credential rotation must revoke sessions tied to the affected policy variable.

Capability discovery must be built from installed manifests. A provider advertises contracts under `provides`. A consumer advertises dependencies under `requires`. Workspace-level capability bindings, including the SSO binding, must live with the workspace configuration instead of in an external service. Agent principals must be derived deterministically from repository and agent names.

Secure delegated tool calls must use signed tokens and replay protection. The router must own an Ed25519 signing keypair under `.ploinky/keys/router/`. Each agent principal must own an Ed25519 keypair under `.ploinky/keys/agents/`. Router-signed invocation tokens must bind the provider audience, tool name, body hash, scope, and expiry. Delegated agent caller assertions must be verified against the registered agent public keys and matched against a router-signed user-context token when a call is forwarded on behalf of an authenticated user.

Secure wire is enabled by default and is only disabled when `PLOINKY_SECURE_WIRE` explicitly turns it off. This default matters because first-party calls and delegated calls share the same agent-side verification expectations once secure wire is active.

## Decisions & Questions

### Question #1: Why is the SSO provider modeled as a workspace capability binding instead of a special-case global setting only?

Response:
The implementation already uses the capability registry to reason about which installed agents provide `auth-provider/v1`. Representing the SSO provider as a workspace binding keeps SSO aligned with the same provider-selection and contract vocabulary used elsewhere in the runtime instead of creating a parallel, special-purpose registry model.

### Question #2: Why does secure wire default to enabled?

Response:
The router proxy and agent runtime already implement invocation-token verification, caller-assertion verification, and replay caches as first-class features. Default-enabled secure wire makes the safer path the ordinary path and requires an explicit operator decision to disable verification when a legacy or diagnostic scenario needs it.

## Conclusion

Ploinky’s auth and trust model is workspace-scoped, capability-aware, and signature-backed. The repository must continue to document and implement local auth, SSO binding, and secure delegated invocations as connected parts of one system.
