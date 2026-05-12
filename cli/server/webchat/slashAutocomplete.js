const SLASH_MENU_MAX_VISIBLE = 8;
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

function applySlashInsertTextToValue(value, insertText) {
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

export function createSlashAutocomplete({ cmdInput }, { agentName, dlog }) {
    let commands = [];
    let selectedIndex = -1;
    let active = false;
    let menuEl = null;

    function buildMenuElement() {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
        menuEl = document.createElement('div');
        menuEl.className = 'wa-slash-menu';
        menuEl.setAttribute('role', 'listbox');
        menuEl.setAttribute('aria-label', 'Command suggestions');
        menuEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
        });
        document.body.appendChild(menuEl);
    }

    function positionMenu() {
        if (!menuEl || !cmdInput) return;
        const rect = cmdInput.getBoundingClientRect();
        const composerRect = cmdInput.closest('.wa-composer')?.getBoundingClientRect();
        if (!composerRect) return;

        menuEl.style.left = `${rect.left - composerRect.left}px`;
        menuEl.style.bottom = `${composerRect.bottom - rect.top + 4}px`;
        menuEl.style.width = `${Math.max(320, rect.width)}px`;
    }

    function renderMenu() {
        if (!menuEl || !active || commands.length === 0) {
            hideMenu();
            return;
        }

        const value = cmdInput.value || '';
        const slashIdx = value.lastIndexOf('/');
        if (slashIdx === -1) {
            hideMenu();
            return;
        }

        const afterSlash = value.slice(slashIdx + 1);
        const spaceIdx = afterSlash.indexOf(' ');
        const currentToken = spaceIdx === -1 ? afterSlash : afterSlash.slice(0, spaceIdx);
        const hasSubToken = spaceIdx !== -1;
        const subToken = hasSubToken ? afterSlash.slice(spaceIdx + 1) : '';

        const suggestions = buildSuggestions(commands, {
            currentToken,
            hasSubToken,
            subToken
        });

        if (suggestions.length === 0) {
            hideMenu();
            return;
        }

        if (selectedIndex >= suggestions.length) {
            selectedIndex = 0;
        }

        menuEl.innerHTML = '';
        const startIdx = selectedIndex >= SLASH_MENU_MAX_VISIBLE
            ? selectedIndex - SLASH_MENU_MAX_VISIBLE + 1
            : 0;
        const visible = suggestions.slice(startIdx, startIdx + SLASH_MENU_MAX_VISIBLE);

        visible.forEach((suggestion, i) => {
            const item = document.createElement('div');
            item.className = 'wa-slash-menu-item' + (i + startIdx === selectedIndex ? ' wa-slash-menu-item-active' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', i + startIdx === selectedIndex ? 'true' : 'false');

            const label = document.createElement('span');
            label.className = 'wa-slash-menu-label';
            label.textContent = suggestion.label;

            const desc = document.createElement('span');
            desc.className = 'wa-slash-menu-desc';
            desc.textContent = suggestion.description || '';

            item.appendChild(label);
            item.appendChild(desc);

            item.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                selectedIndex = i + startIdx;
                applySelection(suggestions[selectedIndex]);
            });

            menuEl.appendChild(item);
        });

        positionMenu();
        menuEl.style.display = 'block';
    }

    function hideMenu() {
        if (menuEl) {
            menuEl.style.display = 'none';
        }
        active = false;
        selectedIndex = -1;
    }

    function applySelection(suggestion) {
        if (!suggestion || !cmdInput) return;
        const selection = suggestion.insertText
            ? applySlashInsertTextToValue(cmdInput.value || '', suggestion.insertText)
            : applySlashSelectionToValue(cmdInput.value || '', suggestion.command);
        if (!selection) return;
        cmdInput.value = selection.value;

        try {
            cmdInput.setSelectionRange(selection.cursor, selection.cursor);
        } catch (_) {}

        cmdInput.dispatchEvent(new Event('input', { bubbles: true }));
        cmdInput.focus();
        if (suggestion.keepMenuOpen) {
            active = true;
            renderMenu();
            return;
        }
        hideMenu();
    }

    function handleKeydown(event) {
        if (!active || !menuEl || menuEl.style.display === 'none') return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, commands.length - 1);
            renderMenu();
            return true;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            renderMenu();
            return true;
        }

        if (event.key === 'Enter' && selectedIndex >= 0) {
            event.preventDefault();
            const visibleItems = menuEl.querySelectorAll('.wa-slash-menu-item');
            const startIdx = selectedIndex >= SLASH_MENU_MAX_VISIBLE
                ? selectedIndex - SLASH_MENU_MAX_VISIBLE + 1
                : 0;
            const visibleIdx = selectedIndex - startIdx;
            if (visibleItems[visibleIdx]) {
                visibleItems[visibleIdx].dispatchEvent(new PointerEvent('pointerdown', { cancelable: true }));
            }
            return true;
        }

        if (event.key === 'Tab' && selectedIndex >= 0) {
            event.preventDefault();
            const visibleItems = menuEl.querySelectorAll('.wa-slash-menu-item');
            const startIdx = selectedIndex >= SLASH_MENU_MAX_VISIBLE
                ? selectedIndex - SLASH_MENU_MAX_VISIBLE + 1
                : 0;
            const visibleIdx = selectedIndex - startIdx;
            if (visibleItems[visibleIdx]) {
                visibleItems[visibleIdx].dispatchEvent(new PointerEvent('pointerdown', { cancelable: true }));
            }
            return true;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            hideMenu();
            return true;
        }

        return false;
    }

    function onInputChange() {
        if (!cmdInput) return;
        const value = cmdInput.value || '';
        const slashIdx = value.lastIndexOf('/');

        if (slashIdx !== -1) {
            const afterSlash = value.slice(slashIdx + 1);
            const firstChar = afterSlash.charAt(0);
            if (firstChar === ' ' || firstChar === '\n') {
                hideMenu();
                return;
            }
            if (!active) {
                active = true;
                selectedIndex = 0;
                buildMenuElement();
            }
            renderMenu();
        } else {
            hideMenu();
        }
    }

    async function fetchCommandCatalog() {
        try {
            if (!agentName) return;
            const mcpEndpoint = `/mcps/${agentName}/mcp`;

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

            if (!initRes.ok) return;

            const initBody = await initRes.json().catch(() => null);
            if (!initBody || !initBody.result) return;

            const sessionId = initRes.headers.get('mcp-session-id') || initBody.result?.meta?.sessionId;

            await fetch(mcpEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized'
                })
            });

            const toolsRes = await fetch(mcpEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'wc-tools-1',
                    method: 'tools/list'
                })
            });

            if (!toolsRes.ok) return;

            const toolsBody = await toolsRes.json().catch(() => null);
            if (!toolsBody || !toolsBody.result || !Array.isArray(toolsBody.result.tools)) return;

            const tools = toolsBody.result.tools;
            const structuredCommands = await fetchAchillesSlashCatalog(mcpEndpoint, sessionId, tools);
            if (structuredCommands.length > 0) {
                commands = structuredCommands.sort((a, b) => a.name.localeCompare(b.name));
                dlog('SlashAutocomplete: loaded', commands.length, 'commands from structured MCP catalog');
                return;
            }

            const slashCommands = [];

            for (const tool of tools) {
                const toolName = tool.name || '';
                if (!toolName.startsWith('execute_')) continue;

                const skillName = toolName.replace('execute_', '').replace(/_/g, '-');
                const desc = tool.description || '';

                slashCommands.push({
                    name: `/${skillName}`,
                    description: desc,
                    inputSchema: tool.inputSchema || null,
                    subCommands: extractSubCommands(tool)
                });
            }

            if (slashCommands.length > 0) {
                commands = slashCommands.sort((a, b) => a.name.localeCompare(b.name));
                dlog('SlashAutocomplete: loaded', commands.length, 'commands from MCP');
            }
        } catch (err) {
            dlog('SlashAutocomplete: MCP catalog fetch failed (silent)', err?.message || err);
        }
    }

    async function fetchAchillesSlashCatalog(mcpEndpoint, sessionId, tools) {
        try {
            const catalogTool = tools.find((tool) => tool?.name === ACHILLES_COMMAND_CATALOG_TOOL);
            if (!catalogTool) {
                return [];
            }

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
                    params: {
                        name: catalogTool.name,
                        arguments: {}
                    }
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
        } catch (err) {
            dlog('SlashAutocomplete: structured catalog fetch failed (fallback to tools/list)', err?.message || err);
            return [];
        }
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

    function destroy() {
        hideMenu();
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
        commands = [];
    }

    return {
        handleKeydown,
        onInputChange,
        fetchCommandCatalog,
        destroy,
        get isActive() { return active; }
    };
}

function buildSuggestions(commands, {
    currentToken,
    hasSubToken,
    subToken
}) {
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
                    command: {
                        ...cmd,
                        subCommands: [sub]
                    },
                    insertText: `/${cmdName} ${sub} `,
                    keepMenuOpen: false
                });
            }
            continue;
        }

        if (normalizedCmdName.includes(normalizedToken)) {
            suggestions.push({
                label: cmd.name,
                description: cmd.description || '',
                command: cmd,
                insertText: `${cmd.name} `,
                keepMenuOpen: subCommands.length > 0
            });
        }
    }

    return suggestions;
}
