import fs from 'fs';
import path from 'path';
import http from 'http';
import { PLOINKY_DIR } from '../services/config.js';
import { debugLog, parseParametersString } from '../services/utils.js';
import { showHelp } from '../services/help.js';

class ClientCommands {
    constructor() {
        this.configPath = path.join(PLOINKY_DIR, 'cloud.json');
        this.loadConfig();
        this._toolCache = null;
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
        } else {
            this.config = {};
        }
    }

    getRouterPort() {
        const routingFile = path.resolve('.ploinky/routing.json');
        try {
            const cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {};
            return cfg.port || 8080;
        } catch (_) {
            return 8080;
        }
    }

    async sendRouterRequest(pathname, payload) {
        const port = this.getRouterPort();
        return new Promise((resolve) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, (r) => {
                const buf = [];
                r.on('data', d => buf.push(d));
                r.on('end', () => {
                    const bodyStr = Buffer.concat(buf).toString('utf8');
                    try {
                        const json = JSON.parse(bodyStr || 'null');
                        resolve({ code: r.statusCode || 0, json, raw: bodyStr });
                    } catch (_) {
                        resolve({ code: r.statusCode || 0, json: null, raw: bodyStr });
                    }
                });
            });
            req.on('error', (e) => resolve({ code: 0, json: null, raw: String(e) }));
            try {
                req.write(JSON.stringify(payload || {}));
            } catch (_) {
                req.write('{}');
            }
            req.end();
        });
    }

    // Removed legacy PloinkyClient-based call; using local RoutingServer instead.

    formatToolLine(tool) {
        const agent = tool && tool.agent ? String(tool.agent) : 'unknown';
        const name = tool && tool.name ? String(tool.name) : '(unnamed)';
        const title = tool && tool.title && tool.title !== name ? ` (${tool.title})` : '';
        const description = tool && tool.description ? ` - ${tool.description}` : '';
        return `- [${agent}] ${name}${title}${description}`;
    }

    formatResourceLine(resource) {
        const agent = resource && resource.agent ? String(resource.agent) : 'unknown';
        const uri = resource && resource.uri ? String(resource.uri) : '(no-uri)';
        const name = resource && resource.name && resource.name !== uri ? ` (${resource.name})` : '';
        const description = resource && resource.description ? ` - ${resource.description}` : '';
        return `- [${agent}] ${uri}${name}${description}`;
    }

    printAggregatedList(items, formatter, errors) {
        if (!items || !items.length) {
            console.log('No entries found.');
        } else {
            for (const item of items) {
                console.log(formatter(item));
            }
        }
        if (Array.isArray(errors) && errors.length) {
            console.log('\nWarnings:');
            for (const err of errors) {
                const agent = err && err.agent ? err.agent : 'unknown';
                const detail = err && err.error ? err.error : 'unknown error';
                console.log(`- [${agent}] ${detail}`);
            }
        }
    }

    async listTools() {
        const result = await this.sendRouterRequest('/mcp', { command: 'list_tools' });
        if (result.code >= 200 && result.code < 300 && result.json && Array.isArray(result.json.tools)) {
            this.printAggregatedList(result.json.tools, this.formatToolLine.bind(this), result.json.errors);
            return;
        }
        if (Array.isArray(result.json)) {
            this.printAggregatedList(result.json, this.formatToolLine.bind(this), result.json.errors);
            return;
        }
        console.log(result.raw || 'Failed to retrieve tool list');
    }

    async listResources() {
        const result = await this.sendRouterRequest('/mcp', { command: 'list_resources' });
        if (result.code >= 200 && result.code < 300 && result.json && Array.isArray(result.json.resources)) {
            this.printAggregatedList(result.json.resources, this.formatResourceLine.bind(this), result.json.errors);
            return;
        }
        if (Array.isArray(result.json)) {
            this.printAggregatedList(result.json, this.formatResourceLine.bind(this), result.json.errors);
            return;
        }
        console.log(result.raw || 'Failed to retrieve resource list');
    }

    async getAgentStatus(agentName) {
        if (!agentName) {
            console.log('Usage: client status <agentName>');
            console.log('Example: client status myAgent');
            return;
        }
        const payload = { command: 'status' };
        const result = await this.sendRouterRequest(`/mcps/${agentName}`, payload);
        const code = result.code;
        const hasBody = result.raw && result.raw.length ? 'yes' : 'no';
        const parsed = result.json ? 'yes' : 'no';
        const ok = (result.json && typeof result.json.ok === 'boolean') ? String(result.json.ok) : '-';
        console.log(`${agentName}: http=${code} body=${hasBody} parsed=${parsed} ok=${ok}`);
    }

    async findToolAgent(toolName) {
        if (!this._toolCache) {
            const result = await this.sendRouterRequest('/mcp', { command: 'list_tools' });
            if (result.code >= 200 && result.code < 300 && result.json && Array.isArray(result.json.tools)) {
                this._toolCache = result.json.tools;
            } else {
                this._toolCache = [];
            }
        }
        const matchingTools = this._toolCache.filter(t => t.name === toolName);
        if (matchingTools.length === 0) {
            return { agent: null, error: 'not_found' };
        }
        if (matchingTools.length > 1) {
            return { agent: null, error: 'ambiguous', agents: matchingTools.map(t => t.agent) };
        }
        return { agent: matchingTools[0].agent, error: null };
    }

    async callTool(toolName, payloadObj = {}, targetAgent = null) {
        if (!toolName) {
            console.error('Missing tool name. Usage: client tool <toolName> [--agent <agent>] [-p <params>] [-key value ...]');
            return;
        }

        let agent = targetAgent;
        if (!agent) {
            const findResult = await this.findToolAgent(toolName);
            if (findResult.error === 'not_found') {
                console.error(`Tool '${toolName}' not found on any active agent.`);
                return;
            }
            if (findResult.error === 'ambiguous') {
                const errPayload = {
                    ok: false,
                    error: 'ambiguous tool',
                    message: `Tool '${toolName}' was found on multiple agents. Please specify one with --agent.`,
                    agents: findResult.agents
                };
                console.log(JSON.stringify(errPayload, null, 2));
                return;
            }
            agent = findResult.agent;
            debugLog(`--> Found tool '${toolName}' on agent '${agent}'. Calling...`);
        }

        const payload = { command: 'tool', tool: toolName, agent: agent, ...payloadObj };
        const result = await this.sendRouterRequest('/mcp', payload);

        if (result.json) {
            console.log(JSON.stringify(result.json, null, 2));
        } else {
            console.log(result.raw || 'Failed to call tool');
        }
    }

    async getTaskStatus(agentName, taskId) {
        if (!agentName || !taskId) {
            console.log('Usage: client task-status <agent> <task-id>');
            console.log('Example: client task-status myAgent task-123');
            return;
        }

        console.log('Not standardized. If supported by your agent, call its status method via:');
        console.log("  client call <path-or-agent> 'task.status' <taskId>");
    }

    async handleClientCommand(args) {
        const [subcommand, ...options] = args;
        debugLog(`Handling client command: '${subcommand}' with options: [${options.join(', ')}]`);

        switch (subcommand) {
            case 'call':
                console.log('client call is no longer supported. Use "client tool <toolName>" instead.');
                break;
            case 'methods':
                console.log('client methods has been replaced by "client list tools". Showing aggregated tools:');
                await this.listTools();
                break;
            case 'status':
                await this.getAgentStatus(options[0]);
                break;
            case 'list':
                if (!options.length) {
                    console.log('Usage: client list <tools|resources>');
                    break;
                }
                switch ((options[0] || '').toLowerCase()) {
                    case 'tools':
                        await this.listTools();
                        break;
                    case 'resources':
                        await this.listResources();
                        break;
                    default:
                        console.log('Unknown list option. Supported: tools, resources');
                        break;
                }
                break;
            case 'tool': {
                if (!options.length) {
                    console.log('Usage: client tool <toolName> [--agent <agent>] [--parameters <params> | -p <params>] [-key val ...]');
                    console.log('Example: client tool echo -text "Hello"');
                    console.log('Example: client tool plan --agent demo -p steps[]=1,2,3');
                    break;
                }

                const toolName = options[0];
                let idx = 1;
                const toNumber = (s) => {
                    if (s === undefined || s === null) return s;
                    const n = Number(s);
                    return Number.isFinite(n) && String(n) === String(s) ? n : s;
                };

                let fields = {};
                let targetAgent = null;

                while (idx < options.length) {
                    const tok = String(options[idx] || '');

                    if (tok === '--parameters' || tok === '-p') {
                        const parametersString = options[idx + 1] || '';
                        if (parametersString) {
                            try {
                                const parsedParams = parseParametersString(parametersString);
                                fields = { ...fields, ...parsedParams };
                            } catch (e) {
                                console.error(`Error parsing parameters: ${e.message}`);
                                return;
                            }
                        }
                        idx += 2;
                        continue;
                    }

                    if (tok === '--agent' || tok === '-a') {
                        const agentValue = options[idx + 1];
                        if (!agentValue) {
                            console.error('Missing value for --agent');
                            return;
                        }
                        targetAgent = String(agentValue);
                        idx += 2;
                        continue;
                    }

                    if (tok === '-') {
                        const key = String(options[idx + 1] || '').replace(/^[-]+/, '');
                        const val = options[idx + 2];
                        if (key) { fields[key] = toNumber(val); }
                        idx += (val !== undefined) ? 3 : 2;
                        continue;
                    }

                    if (tok.startsWith('-')) {
                        const key = tok.replace(/^[-]+/, '');
                        const next = options[idx + 1];
                        if (next !== undefined && !String(next).startsWith('-')) {
                            fields[key] = toNumber(next);
                            idx += 2;
                        } else {
                            fields[key] = true;
                            idx += 1;
                        }
                        continue;
                    }

                    idx += 1;
                }

                await this.callTool(toolName, fields, targetAgent);
                break;
            }
            case 'task':
                console.log('client task has been replaced by client tool. Use: client tool <toolName> [...]');
                break;
            case 'task-status':
                await this.getTaskStatus(options[0], options[1]);
                break;
            default:
                console.log('Client commands:');
                console.log('  client tool <toolName> [--agent <agent>] [-p <params>] [-key val]  - Call an MCP tool');
                console.log('  client list tools                 - List all tools exposed by registered agents');
                console.log('  client list resources             - List all resources exposed by registered agents');
                console.log('  client status <agentName>         - Calls agent via Router with {command:"status"}');
        }
    }
}

export default ClientCommands;
