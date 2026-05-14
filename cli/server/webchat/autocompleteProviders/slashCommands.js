const ACHILLES_COMMAND_CATALOG_TOOL = 'list_achilles_cli_commands';

export function applySlashSelectionToValue(value, cmd) {
    const inputValue = typeof value === 'string' ? value : '';
    const slashIdx = inputValue.lastIndexOf('/');
    if (slashIdx === -1 || !cmd) {
        return null;
    }

    const afterSlash = inputValue.slice(slashIdx + 1);
    const spaceIdx = afterSlash.indexOf(' ');
    const hasSubToken = spaceIdx !== -1;

    let insertText;
    if (hasSubToken && cmd.subCommands && cmd.subCommands.length) {
        const cmdName = cmd.name.replace('/', '');
        const subToken = afterSlash.slice(spaceIdx + 1).trim().toLowerCase();
        const matchingSub = cmd.subCommands.find((sub) =>
            sub.toLowerCase().includes(subToken)
        ) || cmd.subCommands[0];
        insertText = `/${cmdName} ${matchingSub} `;
    } else {
        insertText = cmd.name + ' ';
    }

    const replaceEnd = slashIdx + 1 + afterSlash.length;
    const nextValue = inputValue.slice(0, slashIdx) + insertText + (hasSubToken ? '' : inputValue.slice(replaceEnd));
    return {
        value: nextValue,
        cursor: slashIdx + insertText.length
    };
}

export function applySlashInsertTextToValue(value, insertText) {
    const inputValue = typeof value === 'string' ? value : '';
    const safeInsertText = typeof insertText === 'string' ? insertText : '';
    const slashIdx = inputValue.lastIndexOf('/');
    if (slashIdx === -1 || !safeInsertText) {
        return null;
    }

    const afterSlash = inputValue.slice(slashIdx + 1);
    const replaceEnd = slashIdx + 1 + afterSlash.length;
    return {
        value: inputValue.slice(0, slashIdx) + safeInsertText + inputValue.slice(replaceEnd),
        cursor: slashIdx + safeInsertText.length
    };
}

function extractSubCommands(tool) {
    const subs = [];
    const schema = tool.inputSchema;
    if (!schema || !schema.properties) return subs;

    const props = Object.keys(schema.properties);
    if (props.length <= 2) return subs;

    for (const prop of props) {
        if (!['input', 'prompt', 'text', 'message', 'query'].includes(prop.toLowerCase())) {
            subs.push(prop);
        }
    }
    return subs.slice(0, 6);
}

function buildSlashSuggestions(commands, currentToken, hasSubToken, subToken) {
    const normalizedToken = currentToken.trim().toLowerCase();
    const normalizedSubToken = subToken.trim().toLowerCase();
    const suggestions = [];

    for (const cmd of commands) {
        const cmdName = cmd.name.replace('/', '');
        const normalizedCmdName = cmdName.toLowerCase();
        const subCommands = Array.isArray(cmd.subCommands) ? cmd.subCommands : [];
        const shouldExpandSubCommands = subCommands.length > 0
            && (
                (hasSubToken && normalizedCmdName.startsWith(normalizedToken))
                || (!hasSubToken && normalizedToken === normalizedCmdName)
            );

        if (shouldExpandSubCommands) {
            const matchingSubs = subCommands.filter((sub) =>
                sub.toLowerCase().includes(normalizedSubToken)
            );
            for (const sub of matchingSubs) {
                suggestions.push({
                    label: `/${cmdName} ${sub}`,
                    description: cmd.description || '',
                    insertText: `/${cmdName} ${sub} `,
                    keepMenuOpen: false,
                    command: { ...cmd, subCommands: [sub] }
                });
            }
            continue;
        }

        if (normalizedCmdName.includes(normalizedToken)) {
            suggestions.push({
                label: cmd.name,
                description: cmd.description || '',
                insertText: `${cmd.name} `,
                keepMenuOpen: subCommands.length > 0,
                command: cmd
            });
        }
    }

    return suggestions;
}

async function callMcpInitialize(mcpEndpoint) {
    const initRes = await fetch(mcpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'wc-init-1',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'webchat', version: '1.0.0' }
            }
        })
    });
    if (!initRes.ok) return null;
    const initBody = await initRes.json().catch(() => null);
    if (!initBody || !initBody.result) return null;
    const sessionId = initRes.headers.get('mcp-session-id') || initBody.result?.meta?.sessionId;
    await fetch(mcpEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(sessionId ? { 'mcp-session-id': sessionId } : {})
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });
    return sessionId;
}

async function fetchStructuredCatalog(mcpEndpoint, sessionId, tools) {
    const catalogTool = tools.find((tool) => tool?.name === ACHILLES_COMMAND_CATALOG_TOOL);
    if (!catalogTool) return [];

    const callRes = await fetch(mcpEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(sessionId ? { 'mcp-session-id': sessionId } : {})
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'wc-tool-call-commands-1',
            method: 'tools/call',
            params: { name: catalogTool.name, arguments: {} }
        })
    });
    if (!callRes.ok) return [];
    const callBody = await callRes.json().catch(() => null);
    const content = callBody?.result?.content || callBody?.result?.result?.content;
    if (!Array.isArray(content)) return [];

    const textPart = content.find((entry) => entry?.type === 'text' && typeof entry.text === 'string');
    if (!textPart) return [];

    const parsed = JSON.parse(textPart.text);
    if (!parsed || parsed.type !== 'achilles-slash-command-catalog' || !Array.isArray(parsed.commands)) {
        return [];
    }

    return parsed.commands
        .map((command) => {
            const rawName = typeof command?.name === 'string' ? command.name.trim() : '';
            if (!rawName) return null;
            const normalizedName = rawName.startsWith('/') ? rawName : `/${rawName}`;
            const subCommands = Array.isArray(command.subCommands)
                ? command.subCommands
                    .map((subCommand) => {
                        if (typeof subCommand === 'string') return subCommand.trim();
                        if (subCommand && typeof subCommand.name === 'string') return subCommand.name.trim();
                        return '';
                    })
                    .filter(Boolean)
                : [];
            return {
                name: normalizedName,
                description: typeof command.description === 'string' ? command.description : '',
                subCommands
            };
        })
        .filter(Boolean);
}

async function fetchCommandsFromAgent(agentName, dlog) {
    if (!agentName) return [];
    try {
        const mcpEndpoint = `/mcps/${agentName}/mcp`;
        const sessionId = await callMcpInitialize(mcpEndpoint);
        if (sessionId === null) return [];

        const toolsRes = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(sessionId ? { 'mcp-session-id': sessionId } : {})
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'wc-tools-1', method: 'tools/list' })
        });
        if (!toolsRes.ok) return [];

        const toolsBody = await toolsRes.json().catch(() => null);
        if (!toolsBody || !toolsBody.result || !Array.isArray(toolsBody.result.tools)) return [];

        const tools = toolsBody.result.tools;
        try {
            const structured = await fetchStructuredCatalog(mcpEndpoint, sessionId, tools);
            if (structured.length > 0) {
                return structured.sort((a, b) => a.name.localeCompare(b.name));
            }
        } catch (err) {
            dlog?.('SlashCommandsProvider: structured catalog parse failed, falling back', err?.message || err);
        }

        const fallback = [];
        for (const tool of tools) {
            const toolName = tool.name || '';
            if (!toolName.startsWith('execute_')) continue;
            const skillName = toolName.replace('execute_', '').replace(/_/g, '-');
            fallback.push({
                name: `/${skillName}`,
                description: tool.description || '',
                inputSchema: tool.inputSchema || null,
                subCommands: extractSubCommands(tool)
            });
        }
        return fallback.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
        dlog?.('SlashCommandsProvider: MCP catalog fetch failed (silent)', err?.message || err);
        return [];
    }
}

export function createSlashCommandsProvider({ agentName, dlog } = {}) {
    let commands = [];

    function detectTrigger(value, caretIndex) {
        const inputValue = typeof value === 'string' ? value : '';
        const slashIdx = inputValue.lastIndexOf('/', Math.max(0, caretIndex - 1));
        if (slashIdx === -1) return null;
        const afterSlash = inputValue.slice(slashIdx + 1, caretIndex);
        if (afterSlash.includes(' ') === false && /\s/.test(afterSlash)) {
            return null;
        }
        return { triggerIndex: slashIdx, token: afterSlash };
    }

    function getSuggestions(value, caretIndex) {
        const inputValue = typeof value === 'string' ? value : '';
        const slashIdx = inputValue.lastIndexOf('/');
        if (slashIdx === -1) return [];
        const afterSlash = inputValue.slice(slashIdx + 1);
        const firstChar = afterSlash.charAt(0);
        if (firstChar === ' ' || firstChar === '\n') return [];
        const spaceIdx = afterSlash.indexOf(' ');
        const currentToken = spaceIdx === -1 ? afterSlash : afterSlash.slice(0, spaceIdx);
        const hasSubToken = spaceIdx !== -1;
        const subToken = hasSubToken ? afterSlash.slice(spaceIdx + 1) : '';

        return buildSlashSuggestions(commands, currentToken, hasSubToken, subToken)
            .map((suggestion) => ({
                ...suggestion,
                trigger: '/',
                group: 'Commands'
            }));
    }

    function applySelection(value, suggestion) {
        if (!suggestion) return null;
        if (suggestion.insertText) {
            return applySlashInsertTextToValue(value, suggestion.insertText);
        }
        if (suggestion.command) {
            return applySlashSelectionToValue(value, suggestion.command);
        }
        return null;
    }

    async function refresh() {
        commands = await fetchCommandsFromAgent(agentName, dlog);
        dlog?.('SlashCommandsProvider: loaded', commands.length, 'commands');
    }

    return {
        trigger: '/',
        groupLabel: 'Commands',
        detectTrigger,
        getSuggestions,
        applySelection,
        refresh
    };
}
