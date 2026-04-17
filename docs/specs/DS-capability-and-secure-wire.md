# Capability, Secure Wire, and Pluggable SSO

Status: implemented (2026-04-17)

## 1. Capabilities are manifest-driven

Agent manifests declare capability contracts and runtime needs:

```json
{
  "identity": { "principalId": "agent:<name>", "agentName": "<name>" },
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

Three tokens flow through the router:

1. **user_context_token** — short-lived JWS minted by core after an
   authenticated workspace session. Opaque to consumers; providers trust
   it only via (3).
2. **caller_assertion** — Ed25519 JWS signed by the caller agent's
   private key. Submitted to the router on delegated calls. Payload binds
   the caller to a `binding_id`, `tool`, `scope`, and `body_hash`.
3. **invocation_token** — Ed25519 JWS signed by the router. Emitted per
   routed request. This is the only token a provider trusts for
   authorization.

For nested delegated calls, the router embeds the current
`user_context_token` inside the provider-facing invocation grant. A
capability agent may forward that token in its next caller assertion, but
it must not mint or rewrite delegated user claims on its own.

Invocation token payload:

```
iss         = "ploinky-router"
sub         = <caller agent principal> | "router:first-party"
aud         = <provider agent principal>
workspace_id
binding_id
contract
scope[]
tool
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
6. `binding_id` resolves to a live workspace binding (enforced at core)
7. `tool` allowed by contract / provider operation policy
8. `scope` is a subset of the consumer's `requires.*.maxScopes`,
   binding-approved scopes, and provider-supported scopes

Providers may also receive `PLOINKY_PROVIDER_BINDINGS_JSON`, a launcher-injected
view of the bindings they are currently allowed to serve. Provider runtimes can
use it as an additional binding allowlist after verifying the signed
invocation token.

Headers on the wire:

- `x-ploinky-invocation` — the router-issued `invocation_token`
- `x-ploinky-caller-assertion` — the caller assertion (agent-to-agent)
- `x-ploinky-auth-info` — **deprecated**; accepted only when
  `PLOINKY_SECURE_WIRE_STRICT` is not `1`. Scheduled for removal.

## 4. Contracts in the first wave

### `secret-store/v1`

Operations: `secret_get`, `secret_put`, `secret_delete`, `secret_grant`,
`secret_revoke`, `secret_list`.

Scope mapping (enforced at call time in
`AssistOSExplorer/dpuAgent/lib/dpu-store.mjs`):

| operation       | required scope(s)                       |
|-----------------|-----------------------------------------|
| `secret_get`    | `secret:read`                           |
| `secret_put`    | `secret:write`                          |
| `secret_delete` | `secret:write`                          |
| `secret_grant`  | `secret:grant` or `secret:write`        |
| `secret_revoke` | `secret:revoke` or `secret:write`       |
| `secret_list`   | `secret:access` or `secret:read`        |

Consumers must not call DPU-specific MCP tool names directly; the generic
client `AssistOSExplorer/gitAgent/lib/secret-store-client.mjs` maps
contract operations onto provider tools behind the scenes.

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
