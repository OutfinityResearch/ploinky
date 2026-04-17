/**
 * toolEnvelope.mjs
 *
 * Shared parse / normalize / write helpers used by tool wrappers that live
 * inside an agent container. Tools read a single JSON envelope from stdin,
 * potentially with layers of { tool, input, arguments, params } wrappers,
 * and emit their response to stdout.
 *
 * In the new secure-wire world the envelope also carries:
 *   - invocation: a verified invocation grant (set by the AgentServer after
 *     verifying the router's signed invocation_token). Tools MUST NOT invent
 *     caller or delegated-user data outside of what this field exposes.
 *   - legacyAuthInfo: a transitional field that carries the deprecated
 *     x-ploinky-auth-info shape during migration. Consumers should prefer
 *     `invocation` over this when both are present.
 */

export function readStdinFallback(process) {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) return resolve('');
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(data));
    });
}

export function safeParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function unwrapInput(envelope) {
    let current = envelope;
    for (let i = 0; i < 6; i += 1) {
        if (!current || typeof current !== 'object') break;
        if (current.input && typeof current.input === 'object') {
            current = current.input;
            continue;
        }
        if (current.arguments && typeof current.arguments === 'object') {
            current = current.arguments;
            continue;
        }
        if (current.params?.arguments && typeof current.params.arguments === 'object') {
            current = current.params.arguments;
            continue;
        }
        if (current.params?.input && typeof current.params.input === 'object') {
            current = current.params.input;
            continue;
        }
        break;
    }
    return current && typeof current === 'object' ? current : {};
}

export function extractMetadata(envelope) {
    if (!envelope || typeof envelope !== 'object') return {};
    return envelope.metadata && typeof envelope.metadata === 'object'
        ? envelope.metadata
        : {};
}

export function extractInvocationGrant(envelope) {
    const metadata = extractMetadata(envelope);
    const grant = metadata.invocation && typeof metadata.invocation === 'object'
        ? metadata.invocation
        : null;
    return grant;
}

export function extractLegacyAuthInfo(envelope) {
    const metadata = extractMetadata(envelope);
    const direct = metadata.authInfo && typeof metadata.authInfo === 'object'
        ? metadata.authInfo
        : null;
    if (direct) return direct;
    // historic: sometimes stuffed into metadata.auth (MCP meta passthrough)
    const nested = metadata.auth && typeof metadata.auth === 'object' ? metadata.auth : null;
    return nested;
}

/**
 * Derive a normalized actor suitable for ACL checks.
 * Prefers invocation grant, falls back to legacy auth info.
 *
 * Returns:
 *   {
 *     authenticated,
 *     principalId,
 *     agent: { principalId, name } | null,
 *     delegatedUser: { id, username, email, roles } | null,
 *     userContextToken: string,
 *     invocationVerified: bool
 *   }
 */
export function deriveActor(envelope) {
    const grant = extractInvocationGrant(envelope);
    if (grant) {
        const callerPrincipal = String(grant.sub || grant.caller?.principalId || '').trim();
        const delegated = grant.user && typeof grant.user === 'object' ? grant.user : null;
        return {
            authenticated: true,
            invocationVerified: true,
            principalId: callerPrincipal || '',
            agent: callerPrincipal && /^agent:/i.test(callerPrincipal)
                ? { principalId: callerPrincipal, name: callerPrincipal.replace(/^agent:/i, '') }
                : null,
            delegatedUser: delegated
                ? {
                      id: String(delegated.sub || delegated.id || ''),
                      username: String(delegated.username || delegated.preferred_username || ''),
                      email: String(delegated.email || ''),
                      roles: Array.isArray(delegated.roles) ? [...delegated.roles] : []
                  }
                : null,
            userContextToken: String(grant.user_context_token || ''),
            scope: Array.isArray(grant.scope) ? [...grant.scope] : [],
            tool: String(grant.tool || ''),
            bindingId: String(grant.binding_id || ''),
            contract: String(grant.contract || ''),
            workspaceId: String(grant.workspace_id || '')
        };
    }
    const legacy = extractLegacyAuthInfo(envelope);
    if (legacy) {
        const agent = legacy.agent && typeof legacy.agent === 'object' ? legacy.agent : null;
        const user = legacy.user && typeof legacy.user === 'object' ? legacy.user : null;
        const agentPrincipal = String(agent?.principalId || '').trim();
        return {
            authenticated: Boolean(user || agent),
            invocationVerified: false,
            principalId: agentPrincipal || (user?.id ? `user:${user.id}` : ''),
            agent: agent ? { principalId: agentPrincipal, name: String(agent.name || '') } : null,
            delegatedUser: user
                ? {
                      id: String(user.id || ''),
                      username: String(user.username || ''),
                      email: String(user.email || ''),
                      roles: Array.isArray(user.roles) ? [...user.roles] : []
                  }
                : null,
            userContextToken: '',
            scope: [],
            tool: '',
            bindingId: '',
            contract: '',
            workspaceId: ''
        };
    }
    return {
        authenticated: false,
        invocationVerified: false,
        principalId: '',
        agent: null,
        delegatedUser: null,
        userContextToken: '',
        scope: [],
        tool: '',
        bindingId: '',
        contract: '',
        workspaceId: ''
    };
}

export function writeJson(value, stream) {
    (stream || process.stdout).write(JSON.stringify(value));
}

/**
 * Legacy helper: for tools that continue to read `authInfo` during migration.
 * Produces the old-style { user, agent, sessionId, ... } blob from whichever
 * source is available. Tools SHOULD migrate to deriveActor() over time.
 */
export function toLegacyAuthInfo(envelope) {
    const actor = deriveActor(envelope);
    if (!actor.authenticated) return null;
    const legacy = {};
    if (actor.agent) {
        legacy.agent = {
            principalId: actor.agent.principalId,
            name: actor.agent.name
        };
    }
    if (actor.delegatedUser) {
        legacy.user = { ...actor.delegatedUser };
    }
    if (actor.workspaceId) {
        legacy.workspaceId = actor.workspaceId;
    }
    if (actor.userContextToken) {
        legacy.invocation = {
            userContextToken: actor.userContextToken
        };
    }
    return legacy;
}

export default {
    readStdinFallback,
    safeParseJson,
    unwrapInput,
    extractMetadata,
    extractInvocationGrant,
    extractLegacyAuthInfo,
    deriveActor,
    writeJson,
    toLegacyAuthInfo
};
