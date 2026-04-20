# Capability, Secure Wire, and Pluggable SSO

Status: implemented (2026-04-20)

## 1. Capabilities are manifest-driven

Agent manifests declare capability contracts and runtime needs. Agent
**identity** is derived deterministically by Ploinky from the installed
agent ref as `agent:<repo>/<agent>` — manifests must **not** declare an
`identity` block, and any `identity` field will be ignored.

```json
{
  "provides": {
    "<contract-name>/v1": {
      "operations": [...],
      "supportedScopes": [...]
    }
  },
  "requires": {
    "<alias>": { "contract": "<contract-name>/v1", "maxScopes": [...] }
  },
  "runtime": {
    "resources": {
      "persistentStorage": { "key": "<key>", "containerPath": "/path" },
      "env": { "VAR": "{{STORAGE_CONTAINER_PATH}}" }
    }
  }
}
```

Principal derivation lives in `ploinky/cli/services/agentIdentity.js`
(`deriveAgentPrincipalId(repo, agent) -> "agent:<repo>/<agent>"`). All
launcher and registry code paths use that helper; there is no short-form
fallback like `agent:<agentName>`.

Ploinky core no longer branches on concrete agent names (`dpuAgent`,
`gitAgent`, `keycloak`, `postgres`). The runtime loads each agent's
`runtime.resources.*` block and expands templated env values:

- `{{WORKSPACE_ROOT}}` — host workspace root
- `{{STORAGE_CONTAINER_PATH}}` — container path of the declared storage
- `{{STORAGE_HOST_PATH}}` — host path of the declared storage
- `{{secret:<NAME>}}` — auto-generated persistent secret
- `{{var:<NAME>}}` — workspace `.secrets` / process env lookup

Mounting policy that used to live in core (for example, chmod-ing
`/opt/keycloak/data`) now lives in manifest `volumeOptions`:

```json
"volumeOptions": {
  "/opt/keycloak/data": {
    "chmod": 511,
    "makeWorldWritableSubdirs": ["tmp"]
  }
}
```

## 2. Capability registry and bindings

`ploinky/cli/services/capabilityRegistry.js`:

- `buildCapabilityIndex()` — walks `.ploinky/repos`, returns
  `{ agents, byContract, byPrincipal }`
- `listProvidersForContract(contract)` — find all agents that `provides`
  a given contract
- `resolveAgentDescriptor(agentRef)` — find a single agent descriptor
- `setCapabilityBinding / getCapabilityBinding / removeCapabilityBinding` —
  persist a binding under `agents.json._config.capabilityBindings`
- `resolveAliasForConsumer({ consumerAgentRef, alias, requestedScopes })`
  — enforce scope intersection
  (`consumer.maxScopes ∩ binding.approvedScopes ∩ provider.supportedScopes`)

First-party bindings use the reserved consumer id `workspace` (for example
`workspace:sso`). Agent-to-agent bindings use the consumer's own agent ref.

## 3. Secure routed invocation

There are now two routed call modes.

### 3.1 First-party routed calls

Ploinky still mints a router-signed **invocation token** for first-party
calls that originate from an authenticated browser/session and go
directly to a target agent.

Invocation token payload:

```
iss         = "ploinky-router"
sub         = "router:first-party"
aud         = <provider agent principal>
tool
scope[]
body_hash   = SHA-256 over canonical JSON of the request body
jti
iat, exp    (exp - iat <= 120s)
user        (normalized delegated user claims)
user_context_token (router-issued delegated-user token for nested hops)
```

Provider verification steps (`ploinky/Agent/lib/wireVerify.mjs`):

1. Signature valid against the router's session public key
2. `aud === <own principal>`
3. `iat` and `exp` within skew window; lifetime `<= 120s`
4. `jti` not seen within TTL (in-memory replay cache)
5. `body_hash` matches canonical request body

### 3.2 Direct delegated agent calls

The Git/DPU path no longer uses capability bindings or provider-neutral
secret-store routing. Instead, `gitAgent` calls `dpuAgent` explicitly
through the router with two signed artifacts:

1. **user_context_token** — short-lived JWS minted by core after an
   authenticated workspace session, audience-pinned to the immediate
   caller agent
2. **caller_assertion** — Ed25519 JWS signed by the caller agent's
   private key, binding the caller to a target audience, tool, scope,
   body hash, and forwarded `user_context_token`

The router verifies the delegated `tools/call` request before forwarding
it, then relays:

- `x-ploinky-caller-assertion`
- `x-ploinky-user-context`

The receiving agent runtime verifies both headers again and reconstructs
`metadata.invocation` for the tool entrypoint. No unsigned
`x-ploinky-auth-info` fallback remains in the active Git/DPU runtime path.

## 4. Contracts in the first wave

### `auth-provider/v1`

Operations:

```
sso_begin_login({ redirectUri, prompt }) -> { authorizationUrl, providerState, expiresAt }
sso_handle_callback({ redirectUri, query, providerState }) -> { user, providerSession }
sso_validate_session({ providerSession })                -> { user, providerSession }
sso_refresh_session({ providerSession })                 -> { user, providerSession }
sso_logout({ providerSession, postLogoutRedirectUri })   -> { redirectUrl }
```

Core keeps:

- `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/check`
- workspace session store + cookie issuance
- dev-only web-token auth
- local auth fallback
- browser pending-auth state (keyed by a core-owned `state`)

Provider owns (implemented in `basic/keycloak/runtime/index.mjs`):

- OIDC discovery, auth URL construction
- PKCE + nonce
- code-for-token exchange
- JWKS resolution + JWT verification
- claim normalization (realm_access, resource_access roles → flat list)
- refresh and logout URL construction

## 5. `ploinky sso` command flow

1. `ploinky sso enable [providerAgent]` — sets a workspace binding of
   `workspace:sso → <providerAgent>` with contract `auth-provider/v1`
   (via `bindSsoProvider`).
2. `ploinky sso disable` — removes the binding and flips
   `config.sso.enabled` to `false`.
3. `ploinky status` — shows the bound provider generically; it does not
   render realm, client id, or Keycloak-specific fields.

If no provider is passed, Ploinky reuses the existing binding, selects the
sole installed `auth-provider/v1` implementation, or requires an explicit
choice when multiple providers are installed.

Core no longer carries a provider-specific SSO fallback. When no
`workspace:sso` binding exists, SSO is simply unconfigured and the existing
dev-only web-token auth remains the fallback path.

## 6. Current boundary

- Capability bindings remain live for generic contracts such as
  `auth-provider/v1`.
- Agent identity is always derived by Ploinky as `agent:<repo>/<agent>`.
- The Git/DPU secret path is intentionally not provider-neutral anymore:
  `gitAgent` is explicitly DPU-aware and `dpuAgent` is the authority for
  secret scopes, ACLs, and agent secret-role ceilings.
