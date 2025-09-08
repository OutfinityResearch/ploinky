const fs = require('fs');
const path = require('path');
const http = require('http');
const { PLOINKY_DIR } = require('../config');
const { debugLog } = require('../utils');
const { showHelp } = require('../help');

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
            console.log('Usage: client methods <agent>');
            console.log('Example: client methods myAgent');
            return;
        }

        console.log('Not supported by default. If your agent exposes a methods command, try:');
        console.log("  client call <path-or-agent> 'agent.methods'");
    }

    async getAgentStatus(agentName) {
        if (!agentName) {
            console.log('Usage: client status <agent>');
            console.log('Example: client status myAgent');
            return;
        }

        console.log('Not supported by default. Use management commands:');
        console.log("  cloud agent list | cloud deployments | cloud status");
    }

    async listAgents() {
        console.log('Not supported by default. Use management command: cloud agent list');
    }

    async interactiveTask(agentName) {
        if (!agentName) {
            console.log('Usage: client task <agentName>');
            return;
        }
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise(res => rl.question(q, ans => res(ans)));
        try {
            const cmd = (await ask('Command type: ')).trim();
            console.log("Enter parameters as JSON or lines; type 'end' on a new line to finish:");
            const lines = [];
            rl.setPrompt('> ');
            rl.prompt();
            for await (const line of rl) {
                if (line.trim().toLowerCase() === 'end') break;
                lines.push(line);
                rl.prompt();
            }
            rl.close();
            let args;
            const joined = lines.join('\n');
            try { args = JSON.parse(joined); } catch (_) { args = joined; }
            const routingFile = path.resolve('.ploinky/routing.json');
            let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(routingFile, 'utf8')) || {}; } catch (_) { cfg = {}; }
            const port = cfg.port || 8088;
            const payload = { command: cmd, args };
            console.log(`[client] POST http://127.0.0.1:${port}/apis/${agentName}`);
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
            console.log('--- Result ---');
            console.log(JSON.stringify(res, null, 2));
            console.log('--------------');
        } catch (e) {
            console.error('Interactive task failed:', e.message);
            try { rl.close(); } catch (_) {}
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

    handleClientCommand(args) {
        const [subcommand, ...options] = args;
        debugLog(`Handling client command: '${subcommand}' with options: [${options.join(', ')}]`);

        switch (subcommand) {
            case 'call':
                console.log('client call is no longer supported. Use RoutingServer and "client task <agent>" instead.');
                break;
            case 'methods':
                this.listMethods(options[0]);
                break;
            case 'status':
                this.getAgentStatus(options[0]);
                break;
            case 'list':
                this.listAgents();
                break;
            case 'task':
                await this.interactiveTask(options[0]);
                break;
            case 'task-status':
                this.getTaskStatus(options[0], options[1]);
                break;
            default:
                console.log('Client commands:');
                console.log('  client task <agent>           - Interactive: enter command type, then params (end to send)');
                console.log('  client methods <agent>        - If supported by your agent (via RoutingServer)');
                console.log('  client status <agent>         - If supported by your agent');
        }
    }
}

module.exports = ClientCommands;
