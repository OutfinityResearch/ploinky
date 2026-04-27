---
id: DS007
title: Dependency Caches and Startup Readiness
status: implemented
owner: ploinky-team
summary: Defines runtime-keyed dependency caches, manifest-aware startup preparation, and readiness gating across dependency waves.
---

# DS007 Dependency Caches and Startup Readiness

## Introduction

Ploinky no longer treats dependency installation as an incidental side effect of startup. Dependency caches and readiness gating are explicit parts of the runtime contract and of the test surface.

## Core Content

Global Node dependencies must be prepared from `globalDeps/package.json` into `.ploinky/deps/global/<runtime-key>/`. Per-agent Node dependencies must be prepared into `.ploinky/deps/agents/<repo>/<agent>/<runtime-key>/` using a merged package definition in which agent dependencies override the global baseline for conflicts.

A cache is valid only when the runtime key, the relevant package hash, the stamp version, and the core marker module all match the current workspace inputs. Cache preparation must use the correct installation backend for the target runtime family. Container-family runtime keys must install inside an install container for the target image. Sandbox-family runtime keys must install on the host and must reject preparation for a foreign host runtime key.

The `deps prepare`, `deps status`, and `deps clean` commands form the operator-facing contract for cache maintenance. When no explicit target is provided to `deps prepare`, the command must prepare caches for every enabled agent that actually requires a Node dependency cache. Startup must also prepare or refresh missing and stale caches before runtime launch rather than letting agents run `npm install` inside their service runtime. Operators should expect cold startup to require npm, git, network access, and native build tools when caches are absent.

Workspace startup must expand the static agent into a dependency graph using manifest enable directives. The graph must be grouped topologically into waves. A later wave must not start until the earlier wave has been started and all of its members have passed readiness checks.

Readiness must probe TCP or MCP according to the manifest-derived protocol. Manifests with only a `start` command default to TCP readiness. Other agent modes default to MCP readiness unless the manifest explicitly sets `readiness.protocol`. Cold-cache or invalid-cache scenarios may use an extended readiness timeout because installation and warm-up can materially delay the first healthy response.

## Decisions & Questions

### Question #1: Why are dependency caches keyed by runtime and merged package hash?

Response:
The same JavaScript dependency tree is not safe to reuse across incompatible runtimes or across different merged dependency sets. Keying caches by runtime plus merged package hash prevents silent reuse of an install prepared for a different ABI, platform, or dependency definition.

### Question #2: Why does startup wait wave by wave instead of starting all dependencies concurrently?

Response:
The graph contains explicit dependency edges, and tests on this branch validate that dependents wait until their prerequisites are ready. Wave-based gating preserves that contract and avoids exposing partially booted dependency chains that appear “started” but are not yet able to serve requests.

## Conclusion

Dependency preparation and readiness gating are operationally visible guarantees in Ploinky. The runtime must keep caches runtime-aware and must preserve dependency-wave startup ordering as part of the supported behavior.
