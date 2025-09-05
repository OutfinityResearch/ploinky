const fs = require('fs');
const path = require('path');
const PloinkyClient = require('../../../client/ploinkyClient');
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

    getClient() {
        // Ensure we have the latest config
        this.loadConfig();
        const serverUrl = this.config.serverUrl || 'http://localhost:8000';
        if (!this._client || this._client.serverUrl !== serverUrl) {
            this._client = new PloinkyClient(serverUrl);
        }
        if (this.config.authToken) {
            this._client.setAuthToken(this.config.authToken);
        }
        return this._client;
    }

    async callAgent(agentName, method, ...params) {
        if (!agentName || !method) {
            console.log('Usage: client call <agent> <method> [param1] [param2] ...');
            console.log('Example: client call myAgent processData "input.json" "output.json"');
            return;
        }

        try {
            const pathOrAgent = agentName;
            const agentPath = pathOrAgent.startsWith('/') ? pathOrAgent : `/${pathOrAgent}`;
            console.log(`Calling ${agentPath} -> ${method}(${params.join(', ')})...`);

            const client = this.getClient();
            const result = await client.call(agentPath, method, ...params);

            // The server returns arbitrary JSON; print nicely
            console.log(JSON.stringify(result, null, 2));
        } catch (error) {
            console.error('Error calling agent:', error.message);
        }
    }

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

    async sendTask(agentName, task) {
        if (!agentName || !task) {
            console.log('Usage: client task <agent> <task-description>');
            console.log('Example: client task myAgent "Process all pending orders"');
            return;
        }

        console.log('Not standardized. If your agent supports tasks, use a specific command via:');
        console.log("  client call <path-or-agent> '<command>' [params...]");
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
                this.callAgent(options[0], options[1], ...options.slice(2));
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
                if (options.length >= 2) {
                    this.sendTask(options[0], options.slice(1).join(' '));
                } else {
                    console.log('Usage: client task <agent> <task-description>');
                }
                break;
            case 'task-status':
                this.getTaskStatus(options[0], options[1]);
                break;
            default:
                console.log('Client commands:');
                console.log('  client call <path|agent> <command> [params...]  - Call an agent command');
                console.log("  tip: use '/auth' 'login' <user> <pass> or other agent commands");
                console.log('  Other helpers depend on agent support; prefer "client call" or management via "cloud".');
        }
    }
}

module.exports = ClientCommands;

