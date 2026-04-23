---
id: DS011
title: JWT-HMAC Security Model
status: implemented
owner: ploinky-team
supersedes: DS006 (partial — auth wire protocol only)
summary: Replaces Ed25519 key-pair-per-agent wire protocol with a single HMAC-SHA256 shared secret and JWT-based tokens for all auth flows.
---

# DS011 JWT-HMAC Security Model

## Introduction

DS006 used N+1 Ed25519 key pairs (one router + one per agent), a capability key registry, two distinct token types (invocation tokens and caller assertions), and a separate user-context token for delegated calls. This created operational complexity that scaled linearly with agent count.

DS011 replaces this with a single HMAC-SHA256 shared secret (`PLOINKY_WIRE_SECRET`) and two JWT token types. The router is the sole token issuer. Agents only verify.

## Trust Model

All agents and the router share one secret. Any party holding the secret can forge tokens for any other party. This is acceptable when all agents run in the same workspace under the same operator — the sandbox boundary prevents untrusted code from reading the secret, and inter-agent communication is localhost-only.

If Ploinky later supports multi-tenant or third-party agents, this model must be revisited (per-agent derived secrets or a return to asymmetric signatures).

## Core Content

### 1. Workspace Secret

One secret governs the entire workspace:

- **Name:** `PLOINKY_WIRE_SECRET`
- **Generation:** `crypto.randomBytes(32).toString('hex')` — 64 hex characters, 256 bits of entropy
- **Storage:** `.ploinky/.secrets` under key `PLOINKY_WIRE_SECRET`
- **Auto-creation:** Generated on first agent start via `ensurePersistentSecret('PLOINKY_WIRE_SECRET')` from `cli/services/secretVars.js`
- **Distribution:** Single environment variable `PLOINKY_WIRE_SECRET` injected into every agent container at start

### 2. JWT Token Types

All tokens are compact JWTs with `alg: HS256`, signed using `PLOINKY_WIRE_SECRET`.

The JWT signing and verification code lives in `achillesAgentLib/jwt/` (shared across all agents):
- `jwtSign.mjs` — `signHmacJwt()`, `bodyHashForRequest()`, `canonicalJson()`
- `jwtVerify.mjs` — `verifyJws()`, `verifyInvocationToken()`, `createMemoryReplayCache()`

Ploinky's `Agent/lib/jwtSign.mjs` and `Agent/lib/jwtVerify.mjs` are thin re-exports from `achillesAgentLib/jwt/`.

#### 2a. Session JWT (browser cookie)

Issued by the router after successful password (or SSO) verification. Replaces the opaque session ID + in-memory session store.

```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "typ":  "session",
  "iss":  "ploinky-router",
  "sub":  "user:local:admin",
  "usr":  { "id": "local:admin", "username": "admin", "name": "Admin", "roles": ["local"] },
  "rev":  1,
  "iat":  1713800000,
  "exp":  1713814400,
  "jti":  "<random-base64url>"
}
```

| Claim | Purpose |
|-------|---------|
| `typ` | Always `"session"`. Prevents cross-use of invocation JWTs as session tokens. |
| `sub` | User principal ID, e.g. `user:local:admin` or `user:sso:<provider-sub>`. |
| `usr` | User profile object carried forward into invocation JWTs. |
| `rev` | Credential revision counter from the user record. Incremented on password change. Router checks `rev` against current user record (cached 30 seconds) — mismatch rejects the JWT, invalidating all sessions for that user without a session store. |
| `exp` | 4-hour TTL (14400 seconds) from `iat`. |

**Cookie:** `ploinky_jwt=<compact-jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=14400`

`Secure` flag set when connection is HTTPS (detected via `req.socket.encrypted` or `x-forwarded-proto: https`).

**Session refresh:** On each authenticated request, the router issues a fresh session JWT with a new `iat`/`exp` (sliding window). The old JWT remains valid until its own `exp` but the cookie is overwritten.

**Session revocation:** No in-memory session store for local auth. Revocation is handled by the `rev` counter:
1. Password change increments `rev` in the user record (`.ploinky/.secrets` user blob).
2. All outstanding session JWTs carry the old `rev` value.
3. On next request, the router compares JWT `rev` to current user record `rev` — mismatch → 401.
4. The `rev` check uses a 30-second in-memory cache to avoid reading `.ploinky/.secrets` on every request.

**SSO sessions** still use the in-memory session store (`sessionStore.js`) since they depend on OAuth refresh tokens and server-side state.

#### 2b. Invocation JWT (router → agent)

Issued by the router for every tool call forwarded to an agent. Short-lived, single-use, body-bound.

```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "typ":     "invocation",
  "iss":     "ploinky-router",
  "aud":     "agent:AchillesIDE/dpuAgent",
  "sub":     "user:local:admin",
  "caller":  "router:first-party",
  "tool":    "dpu_secret_put",
  "scope":   ["secret:read", "secret:write", "secret:access", "secret:grant", "secret:revoke"],
  "bh":      "<SHA-256 base64url of canonical JSON body>",
  "usr":     { "id": "local:admin", "username": "admin", "roles": ["local"] },
  "iat":     1713800000,
  "exp":     1713800060,
  "jti":     "<random-base64url>"
}
```

| Claim | Purpose |
|-------|---------|
| `typ` | Always `"invocation"`. |
| `aud` | Target agent principal. Agent MUST reject if `aud` does not match its own `PLOINKY_AGENT_PRINCIPAL`. |
| `caller` | `"router:first-party"` for browser calls. `"agent:Repo/agentName"` for delegated agent-to-agent calls. |
| `tool` | Exact tool name being invoked. |
| `scope` | Capability scopes for this call. First-party and delegated calls default to `["secret:read", "secret:write", "secret:access", "secret:grant", "secret:revoke"]` when no explicit scopes are provided. dpuAgent's `assertInvocationScopeFor()` checks these against an operation-to-scope map. |
| `bh` | SHA-256 base64url digest of the canonical JSON body (`canonicalJson({ tool, arguments })`). Agent MUST reject if hash does not match the received body. |
| `usr` | User profile carried from the session JWT. This is how the agent knows the end user's identity. |
| `exp` | 60-second TTL from `iat`. Maximum allowed: 120 seconds. |
| `jti` | Replay protection. Agent maintains an in-memory replay cache (max 4096 entries, TTL-pruned). |

**Delivery:** `Authorization: Bearer <compact-jwt>` header on the proxied request to the agent container.

**Invocation token passthrough:** The raw JWT string is preserved in `metadata.invocationToken` on the tool subprocess envelope. `authInfoFromInvocation()` includes it as `authInfo.invocationToken`. Agents that need to make delegated calls (e.g., gitAgent calling dpuAgent) read this field and present it as `X-Ploinky-Caller-JWT`.

### 3. Authentication Flows

#### 3a. User Login (local auth — `"ploinky": "pwd enable"`)

1. Browser requests any protected route.
2. Router checks for `ploinky_jwt` cookie. Not found → 302 to `/auth/login?returnTo=<path>`.
3. User submits credentials via the login form.
4. Router loads user record from `PLOINKY_AUTH_<AGENT>_USERS` in `.ploinky/.secrets`.
5. Password verified via `verifyPasswordHash()` (scrypt, timing-safe). On failure → 401.
6. Router calls `mintSessionJwt(user, rev)` in `localService.js`.
7. Sets `ploinky_jwt` cookie and redirects to `returnTo`.

#### 3b. Guest Auth (`"guest": true` in manifest)

For agents that should be publicly accessible without login (e.g., a web chat widget):

1. Browser requests a guest agent's route. No `ploinky_jwt` or `ploinky_guest` cookie.
2. Router resolves auth mode = `guest` from the agent manifest's `guest: true` flag.
3. Router first checks for an existing `ploinky_jwt` cookie (authenticated user takes priority over guest).
4. If no authenticated session, router auto-mints a guest session JWT:
   `{ typ:"session", sub:"user:guest:<random-uuid>", usr:{ id:"guest:<uuid>", username:"visitor", roles:["guest"] }, rev:0 }`
5. Sets `ploinky_guest` cookie (1-hour TTL). Subsequent requests reuse the same guest identity.
6. Agents see `usr.roles: ["guest"]` in the invocation JWT and can restrict access accordingly.

#### 3c. Browser → Agent (First-Party Call)

1. Router verifies session JWT from `ploinky_jwt` cookie (HS256, typ, exp, rev check with 30s cache).
2. Router calls `buildFirstPartyInvocation()` in `invocationMinter.js`: mints invocation JWT with `caller:"router:first-party"`, default scopes, body hash, and `usr` claims.
3. Router proxies to agent container with `Authorization: Bearer <invocation-jwt>`.
4. Agent verifies invocation JWT via `verifyInvocationFromHeaders()` in `invocationAuth.mjs`: HS256 signature, `aud` match, `bh` match, `jti` replay check.
5. Agent extracts `authInfo` via `authInfoFromInvocation(grant, { invocationToken })`.

#### 3d. Agent → Agent (Delegated Call)

All inter-agent calls go through the router. There are no direct agent-to-agent connections.

1. gitAgent holds its invocation JWT (`IJ-git`) from the original browser call, available as `authInfo.invocationToken`.
2. gitAgent sends `POST /mcps/dpuAgent/mcp` to the router with header `X-Ploinky-Caller-JWT: <IJ-git>`.
3. Router detects `X-Ploinky-Caller-JWT`, calls `verifyDelegatedToolCall()` in `invocationMinter.js`:
   - Verifies `IJ-git` (HS256 signature, `typ=invocation`, `iss=ploinky-router`, `exp` not passed).
   - Does NOT check `bh` or `jti` (they bound the original call, not this new one).
   - Extracts `caller = IJ-git.aud` (the agent principal) and `user = IJ-git.usr`.
4. Router calls `buildDelegatedInvocation()`: mints a fresh invocation JWT for dpuAgent with `caller:"agent:AchillesIDE/gitAgent"`, default scopes, new `bh`, new `jti`.
5. Router proxies to dpuAgent with `Authorization: Bearer <fresh-jwt>`.
6. dpuAgent verifies the JWT — same single code path as any call.

### 4. Agent-Side Verification

Every agent verifies incoming requests identically via `verifyInvocationFromHeaders()` in `Agent/lib/invocationAuth.mjs`. There is only one token type to verify and one code path:

1. Extract Bearer token from `Authorization` header.
2. Read `PLOINKY_WIRE_SECRET` from environment.
3. Call `verifyInvocationToken()` from `achillesAgentLib/jwt/jwtVerify.mjs`: HS256 signature, `aud` match, `bh` match, `jti` replay, `exp` check.
4. Return `{ ok: true, payload, rawToken }`.

The `rawToken` is preserved so agents can forward it for delegated calls.

### 5. authInfo Contract

`authInfoFromInvocation(grant, { invocationToken })` in `Agent/lib/invocation-auth.mjs` converts the verified JWT payload into a standard `authInfo` object:

```javascript
{
  agent: { principalId, name },       // from grant.caller (if agent:...)
  user: { id, username, email, roles }, // from grant.usr (or grant.user for compat)
  invocation: { scope, tool, contract, bindingId, workspaceId },
  invocationToken: '<raw-jwt-string>'  // for delegated calls
}
```

The function reads `grant.caller || grant.sub` for the caller principal and `grant.usr || grant.user` for user claims, providing backward compatibility with both old and new claim names.

### 6. User Management

- **Storage:** User records in `.ploinky/.secrets` under `PLOINKY_AUTH_<AGENT>_USERS`.
- **Seeding:** `manifest.json` `pwd.users` array, hashed at enable time.
- **Self-service:** Users change their own credentials via `/auth/account`. Password change increments `rev`, invalidating all session JWTs.
- **Rev counter:** Each user record has a `rev` field (default 1). `updateLocalCredentials()` increments it on password change. The router caches user records for 30 seconds via `resolveUserRev()`.

### 7. dpuAgent Authorization (Unchanged)

The dpuAgent's domain-level authorization model is unaffected. It continues to:

1. Check invocation scope via `assertInvocationScopeFor()` against `OPERATION_SCOPE_MAP`.
2. Resolve actor principal from `authInfo.user.id`.
3. Check per-resource ACLs from `permissions.manifest.json`.
4. Check per-agent policies from `agentPolicies` before granting agent principals secret roles.
5. Encrypt secret values with AES-256-GCM using `DPU_MASTER_KEY`.

### 8. Agent Container Bootstrap

Two security-related env vars, no volume mounts:

```
PLOINKY_AGENT_PRINCIPAL=agent:AchillesIDE/dpuAgent
PLOINKY_WIRE_SECRET=<64-hex-chars>
```

Set by `agentServiceManager.js` (Docker/Podman) and `bwrapServiceManager.js` (bubblewrap) via `ensurePersistentSecret('PLOINKY_WIRE_SECRET')`.

### 9. File Layout

| File | Role |
|------|------|
| `achillesAgentLib/jwt/jwtSign.mjs` | `signHmacJwt`, `bodyHashForRequest`, `canonicalJson` — shared JWT signing |
| `achillesAgentLib/jwt/jwtVerify.mjs` | `verifyJws`, `verifyInvocationToken`, `createMemoryReplayCache` — shared JWT verification |
| `Agent/lib/jwtSign.mjs` | Re-exports from `achillesAgentLib/jwt/jwtSign.mjs` |
| `Agent/lib/jwtVerify.mjs` | Re-exports from `achillesAgentLib/jwt/jwtVerify.mjs` |
| `Agent/lib/invocationAuth.mjs` | Reads `PLOINKY_WIRE_SECRET`, verifies invocation JWTs from `Authorization: Bearer` header |
| `Agent/lib/invocation-auth.mjs` | `authInfoFromInvocation(grant, { invocationToken })` — converts JWT payload to authInfo |
| `Agent/lib/toolEnvelope.mjs` | `deriveActor()` — extracts caller, user, and invocationToken from tool envelope metadata |
| `Agent/server/AgentServer.mjs` | MCP server; single verification path via `verifyInvocationFromHeaders()` |
| `cli/server/mcp-proxy/invocationMinter.js` | Router-side: `buildFirstPartyInvocation()`, `buildDelegatedInvocation()`, `verifyDelegatedToolCall()` |
| `cli/server/mcp-proxy/index.js` | MCP proxy; detects `X-Ploinky-Caller-JWT` for delegated calls, `Authorization: Bearer` for forwarding |
| `cli/server/auth/localService.js` | `mintSessionJwt()`, `verifySessionJwt()`, `mintGuestSessionJwt()`, `resolveUserRev()` |
| `cli/server/authHandlers.js` | `ensureAuthenticated()` — handles local, SSO, and guest auth modes |
| `cli/services/agents.js` | `resolveManifestAuthMode()` — detects `guest: true`, `pwd enable`, `sso enable` from manifest |

### 10. What Changed from DS006

| Component | DS006 (Ed25519) | DS011 (JWT-HMAC) |
|-----------|----------------|------------------|
| Workspace secret | N/A | `PLOINKY_WIRE_SECRET` (1 value) |
| Router key pair | Ed25519 in `.ploinky/keys/router/` | Removed |
| Agent key pairs | Ed25519 in `.ploinky/keys/agents/` | Removed |
| Public key registry | `capabilityAgentKeys` in config | Removed |
| `agentKeystore.js` | 297 lines | Deleted |
| Session store (local) | In-memory `Map` | JWT cookie (stateless) |
| Session cookie | Opaque `randomId(24)` as `ploinky_local` | Compact JWT as `ploinky_jwt` |
| Invocation token | Ed25519 JWS (custom) | HS256 JWT (standard) |
| Caller assertion | Ed25519 JWS (agent-signed) | Reuse invocation JWT as `X-Ploinky-Caller-JWT` |
| User context token | Ed25519 JWS (separate) | Embedded in invocation JWT `usr` claim |
| Agent bootstrap env vars | 4 + volume mount | 2, no volume mount |
| Agent verification paths | 2 (`verifyInvocation` + `verifyDirectAgent`) | 1 (`verifyInvocationFromHeaders`) |
| JWT code location | `Agent/lib/wireSign.mjs`, `wireVerify.mjs` | `achillesAgentLib/jwt/` (shared) |
| Guest auth | N/A | `guest: true` in manifest, `ploinky_guest` cookie |
| Capability bindings | Unchanged | Unchanged |
| dpuAgent ACLs | Unchanged | Unchanged |
| Password hashing (scrypt) | Unchanged | Unchanged |

## Decisions & Questions

### Decision #1: Why HMAC-SHA256 instead of Ed25519?

The Ed25519 model provides non-repudiation (only the router can mint invocation tokens, only gitAgent can mint gitAgent assertions). In a single-workspace deployment where all agents are operator-controlled, non-repudiation between agents has no consumer. HMAC eliminates per-agent key lifecycle in exchange for a trust model that matches the actual deployment: one operator, one workspace, shared trust.

### Decision #2: Why use the invocation JWT as caller proof instead of a separate caller token?

The agent's own invocation JWT already contains both identity (`aud` = the agent principal) and user context (`usr`). Presenting it back to the router is sufficient — the router minted it, can verify it, and knows it was delivered to a specific container. This collapses two tokens and one signing operation into zero new tokens and zero signing operations on the agent side.

### Decision #3: Why skip `bh` and `jti` checks on the caller JWT?

The caller JWT's `bh` and `jti` were computed for the original tool call. The delegated call has a different body and the same JWT may be used for multiple delegated calls within its TTL. The router mints a fresh invocation JWT for the target with correct `bh` and `jti` — integrity and replay protection are enforced on the final hop.

### Decision #4: Why default scopes instead of empty scopes?

First-party browser calls and delegated calls use a default scope set (`secret:read`, `secret:write`, `secret:access`, `secret:grant`, `secret:revoke`) when no explicit scopes are provided. dpuAgent's `assertInvocationScopeFor()` requires specific scopes per operation and rejects empty scope sets. The default scopes grant broad access at the invocation layer; fine-grained access control is enforced by dpuAgent's per-resource ACLs and `agentPolicies`.

### Decision #5: Why `rev` counter with a 30-second cache?

Reading `.ploinky/.secrets` on every request adds unnecessary I/O. Password changes are rare; a 30-second delay before invalidation is acceptable. The cache is implemented in `resolveUserRev()` in `localService.js`.

### Decision #6: Why `invocationToken` as a standard authInfo field?

Agents that need to make delegated calls (e.g., gitAgent calling dpuAgent) must present their invocation JWT to the router. Rather than having each tool script extract the raw JWT from the envelope metadata, `authInfoFromInvocation()` accepts `{ invocationToken }` as a standard option and includes it in the returned authInfo. `AgentServer.mjs` passes `rawToken` through `metadata.invocationToken`, and `toolEnvelope.mjs`'s `deriveActor()` exposes it alongside other grant fields.

### Decision #7: Why a separate `ploinky_guest` cookie for guest auth?

Guest sessions use a separate cookie name (`ploinky_guest`) from authenticated sessions (`ploinky_jwt`) to keep the logic separate. When a guest agent is accessed, the router first checks for `ploinky_jwt` — if the user is already logged in, that identity is used instead of creating a guest session. This avoids conflicts between authenticated and guest sessions in the same browser.

## Conclusion

The JWT-HMAC model preserves all security properties that matter for single-workspace Ploinky deployments (authenticated identity, scoped authorization, body integrity, replay protection, short-lived tokens) while eliminating per-agent key pair lifecycle, the public key registry, separate caller assertions, separate user context tokens, and the in-memory session store. The total number of token types drops from three to two. The number of agent verification code paths drops from two to one. Agent bootstrap drops from four env vars plus a volume mount to two env vars.
