export function authInfoFromInvocation(grant) {
  if (!grant || typeof grant !== 'object') return null;
  const out = {};
  if (grant.sub && /^agent:/i.test(grant.sub)) {
    out.agent = {
      principalId: grant.sub,
      name: String(grant.sub).replace(/^agent:/i, '')
    };
  }
  if (grant.user && typeof grant.user === 'object') {
    out.user = {
      id: String(grant.user.id || grant.user.sub || ''),
      username: String(grant.user.username || grant.user.preferred_username || ''),
      email: String(grant.user.email || ''),
      roles: Array.isArray(grant.user.roles) ? [...grant.user.roles] : []
    };
  }
  out.invocation = {
    scope: Array.isArray(grant.scope) ? [...grant.scope] : [],
    tool: String(grant.tool || ''),
    contract: String(grant.contract || ''),
    bindingId: String(grant.binding_id || ''),
    workspaceId: String(grant.workspace_id || ''),
    userContextToken: String(grant.user_context_token || '')
  };
  return out;
}

export default { authInfoFromInvocation };
