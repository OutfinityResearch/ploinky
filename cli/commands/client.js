import fs from 'fs';
import path from 'path';
import http from 'http';
import { PLOINKY_DIR } from '../services/config.js';
import { debugLog, parseParametersString, findAgent } from '../services/utils.js';
import { showHelp } from '../services/help.js';

class ClientCommands {
    constructor() {
        this.configPath = path.join(PLOINKY_DIR, 'cloud.json');
        this.loadConfig();
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
        } else {
            this.config = {};
        }
    }

    // Removed legacy PloinkyClient-based call; using local RoutingServer instead.

    async listMethods(agentName) {
        if (!agentName) {
            console.log('Usage: client methods <agentName>');
            console.log('Example: client methods myAgent');
            return;
        }
        const routingFile = path.resolve('.ploinky/routing.json');
        let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
        const port = cfg.port || 8080;
        const payload = { command: 'methods' };
        const result = await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: `/apis/${agentName}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
                let buf = [];
                r.on('data', d => buf.push(d));
                r.on('end', () => {
                    const bodyStr = Buffer.concat(buf).toString('utf8');
                    try {
                        const json = JSON.parse(bodyStr || 'null');
                        resolve({ code: r.statusCode||0, json, raw: bodyStr });
                    } catch {
                        resolve({ code: r.statusCode||0, json: null, raw: bodyStr });
                    }
                });
            });
            req.on('error', (e) => resolve({ code: 0, json: null, raw: String(e) }));
            req.write(JSON.stringify(payload));
            req.end();
        });
        if (Array.isArray(result.json)) {
            console.log(JSON.stringify(result.json));
        } else if (result.code && result.code >= 200 && result.code < 300 && result.json && Array.isArray(result.json.methods)) {
            console.log(JSON.stringify(result.json.methods));
        } else if (result.code && result.code >= 400) {
            console.log(`${agentName}: http=${result.code}`);
        } else {
            console.log(`${agentName}: cannot parse methods`);
        }
    }

    async getAgentStatus(agentName) {
        if (!agentName) {
            console.log('Usage: client status <agentName>');
            console.log('Example: client status myAgent');
            return;
        }
        const routingFile = path.resolve('.ploinky/routing.json');
        let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
        const port = cfg.port || 8080;
        const payload = { command: 'status' };
        const result = await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: `/apis/${agentName}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
                let buf = [];
                r.on('data', d => buf.push(d));
                r.on('end', () => {
                    const bodyStr = Buffer.concat(buf).toString('utf8');
                    let parsed = null;
                    try { parsed = JSON.parse(bodyStr || 'null'); } catch (_) {}
                    resolve({ code: r.statusCode||0, parsed, bodyStr });
                });
            });
            req.on('error', (e)=> resolve({ code: 0, parsed: null, bodyStr: String(e) }));
            req.write(JSON.stringify(payload));
            req.end();
        });
        const code = result.code;
        const hasBody = result.bodyStr && result.bodyStr.length ? 'yes' : 'no';
        const parsed = result.parsed ? 'yes' : 'no';
        const ok = (result.parsed && typeof result.parsed.ok === 'boolean') ? String(result.parsed.ok) : '-';
        console.log(`${agentName}: http=${code} body=${hasBody} parsed=${parsed} ok=${ok}`);
    }

    async listAgents() {
        console.log('Not supported by default. Use management command: cloud agent list');
    }

    async sendTaskPayload(agentName, payloadObj) {
        const routingFile = path.resolve('.ploinky/routing.json');
        let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
        const port = cfg.port || 8080;
        if (!agentName) {
            console.error('Missing agent name and no static agent configured.');
            console.error('Usage: client task <agentName> <json>  OR  client task <json> (uses static agent)');
            return;
        }
        // Resolve agent name (support repo/name); use short name for Router route key
        try {
            const res = findAgent(agentName);
            agentName = res.shortAgentName || agentName;
        } catch (e) {
            console.error(e.message || String(e));
            return;
        }
        const payload = payloadObj || {};
        const res = await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: `/apis/${agentName}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
                let buf = [];
                r.on('data', d => buf.push(d));
                r.on('end', () => {
                    try { resolve(JSON.parse(Buffer.concat(buf).toString('utf8') || '{}')); }
                    catch (e) { resolve({ ok: false, error: 'invalid JSON from agent', raw: Buffer.concat(buf).toString('utf8') }); }
                });
            });
            req.on('error', reject);
            req.write(JSON.stringify(payload));
            req.end();
        });
        console.log(JSON.stringify(res, null, 2));
    }

    getStaticAgent() {
        // Prefer routing.json static
        try {
            const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
            if (routing.static && routing.static.agent) return routing.static.agent;
        } catch(_) {}
        // Fallback to workspace _config
        try {
            const agents = JSON.parse(fs.readFileSync(path.resolve('.ploinky/agents'), 'utf8')) || {};
            if (agents._config && agents._config.static && agents._config.static.agent) return agents._config.static.agent;
        } catch(_) {}
        return null;
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
                console.log('client call is no longer supported. Use RoutingServer and "client task <agent>" instead.');
                break;
            case 'methods':
                await this.listMethods(options[0]);
                break;
            case 'status':
                await this.getAgentStatus(options[0]);
                break;
            case 'list':
                await this.listAgents();
                break;
            case 'task': {
                if (!options.length) {
                    console.log('Usage:');
                    console.log('  client task <agentName> [--parameters <params> | -p <params>] [-key val ...]');
                    console.log('  client task [--parameters <params> | -p <params>] [-key val ...]   (uses static agent)');
                    console.log('Example: client task simulation -task montyHall -iterations 10');
                    console.log('Example: client task myAgent -p name=John,age=25,hobbies[]=reading,writing');
                    break;
                }

                // Determine agent name
                let idx = 0;
                let agentName = null;
                if (options[0] && !String(options[0]).startsWith('-')) {
                    agentName = options[0];
                    idx = 1;
                } else {
                    agentName = this.getStaticAgent();
                }
                if (!agentName) {
                    console.error('No agent specified and no static agent configured.');
                    break;
                }

                const toNumber = (s) => {
                    if (s === undefined || s === null) return s;
                    const n = Number(s);
                    return Number.isFinite(n) && String(n) === String(s) ? n : s;
                };

                let fields = {};
                while (idx < options.length) {
                    let tok = String(options[idx] || '');

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

                    if (tok === '-') {
                        // support pattern: - key value
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
                            fields[key] = true; // flag without value
                            idx += 1;
                        }
                        continue;
                    }
                    // Unrecognized token; skip
                    idx += 1;
                }

                await this.sendTaskPayload(agentName, fields);
                break;
            }
            case 'task-status':
                await this.getTaskStatus(options[0], options[1]);
                break;
            default:
                console.log('Client commands:');
                console.log('  client task <agentName> [-p <params>] [-key val]   - Send a key/value payload');
                console.log('  client task [-p <params>] [-key val] ...         (uses static agent from start)');
                console.log('  client methods <agentName>        - Calls agent via Router with {command:"methods"}');
                console.log('  client status <agentName>         - Calls agent via Router with {command:"status"}');
        }
    }
}

export default ClientCommands;
