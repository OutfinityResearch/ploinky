const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

class CloudCommand {
    constructor() {
        this.configFile = path.join(process.cwd(), '.ploinky', 'cloud.json');
        this.config = null;
    }

    async execute(args) {
        const subcommand = args[0];
        const subArgs = args.slice(1);

        await this.loadConfig();

        switch (subcommand) {
            case 'start':
                return this.start(subArgs);
            case 'stop':
                return this.stop(subArgs);
            case 'status':
                return this.status(subArgs);
            case 'login':
                return this.login(subArgs);
            case 'logout':
                return this.logout(subArgs);
            case 'add':
                return this.handleAdd(subArgs);
            case 'remove':
                return this.handleRemove(subArgs);
            case 'list':
                return this.handleList(subArgs);
            case 'deploy':
                return this.deploy(subArgs);
            case 'undeploy':
                return this.undeploy(subArgs);
            case 'run':
                return this.runTask(subArgs);
            case 'config':
                return this.showConfig(subArgs);
            case 'metrics':
                return this.showMetrics(subArgs);
            case 'help':
            default:
                return this.showHelp();
        }
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configFile, 'utf-8');
            this.config = JSON.parse(data);
        } catch (err) {
            this.config = {
                serverUrl: 'http://localhost:8000',
                authToken: null,
                currentContext: 'local'
            };
        }
    }

    async saveConfig() {
        await fs.mkdir(path.dirname(this.configFile), { recursive: true });
        await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
    }

    async start(args) {
        const port = args.includes('--port') ? 
            args[args.indexOf('--port') + 1] : '8000';
        
        const dir = args.includes('--dir') ? 
            args[args.indexOf('--dir') + 1] : process.cwd();

        console.log(`Starting Ploinky Cloud server on port ${port}...`);
        
        // Start server in background
        const serverProcess = spawn('node', [
            path.join(__dirname, '../../bin/p-cloud'),
            '--port', port,
            '--dir', dir
        ], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Save PID for later
        this.config.serverPid = serverProcess.pid;
        this.config.serverPort = port;
        this.config.serverUrl = `http://localhost:${port}`;
        await this.saveConfig();

        serverProcess.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        serverProcess.unref();
        
        console.log(`Server started with PID ${serverProcess.pid}`);
        console.log(`Access dashboard at http://localhost:${port}/management`);
    }

    async stop(args) {
        if (!this.config.serverPid) {
            console.log('No server is running');
            return;
        }

        try {
            process.kill(this.config.serverPid, 'SIGTERM');
            console.log(`Stopped server with PID ${this.config.serverPid}`);
            
            delete this.config.serverPid;
            delete this.config.serverPort;
            await this.saveConfig();
        } catch (err) {
            console.error('Failed to stop server:', err.message);
        }
    }

    async status(args) {
        if (!this.config.serverPid) {
            console.log('Server: Not running');
            return;
        }

        try {
            process.kill(this.config.serverPid, 0);
            console.log(`Server: Running (PID: ${this.config.serverPid})`);
            console.log(`URL: ${this.config.serverUrl}`);
            
            // Get server status
            const status = await this.apiCall('/management/api/overview');
            if (status) {
                console.log(`Active Agents: ${status.activeAgents}`);
                console.log(`Total Requests: ${status.totalRequests}`);
                console.log(`Uptime: ${this.formatUptime(status.uptime)}`);
            }
        } catch (err) {
            console.log('Server: Not responding');
            delete this.config.serverPid;
            await this.saveConfig();
        }
    }

    async login(args) {
        const username = args[0] || 'admin';
        const password = await this.promptPassword('Password: ');

        if (password === null) {
            console.log('Login cancelled.');
            return;
        }

        try {
            const response = await this.apiCall('/auth', {
                method: 'POST',
                body: JSON.stringify({
                    command: 'login',
                    params: [username, password]
                })
            });

            if (response && response.authorizationToken) {
                this.config.authToken = response.authorizationToken;
                this.config.userId = response.userId;
                await this.saveConfig();
                console.log(`Logged in as ${response.userId}`);
            } else {
                console.error('✗ Login failed');
            }
        } catch (err) {
            console.error('Login error:', err.message);
        }
    }

    async logout(args) {
        if (!this.config.authToken) {
            console.log('Not logged in');
            return;
        }

        delete this.config.authToken;
        delete this.config.userId;
        await this.saveConfig();
        console.log('Logged out');
    }

    async handleAdd(args) {
        const type = args[0];
        const subArgs = args.slice(1);

        switch (type) {
            case 'admin':
                return this.addAdmin(subArgs);
            case 'host':
            case 'domain':
                return this.addDomain(subArgs);
            case 'repo':
            case 'repository':
                return this.addRepository(subArgs);
            case 'agent':
                return this.addAgent(subArgs);
            default:
                console.log('Usage: cloud add <admin|host|repo|agent> [options]');
        }
    }

    async handleRemove(args) {
        const type = args[0];
        const subArgs = args.slice(1);

        switch (type) {
            case 'admin':
                return this.removeAdmin(subArgs);
            case 'host':
            case 'domain':
                return this.removeDomain(subArgs);
            case 'repo':
            case 'repository':
                return this.removeRepository(subArgs);
            case 'agent':
                return this.removeAgent(subArgs);
            default:
                console.log('Usage: cloud remove <admin|host|repo|agent> [options]');
        }
    }

    async handleList(args) {
        const type = args[0] || 'all';

        switch (type) {
            case 'domains':
            case 'hosts':
                return this.listDomains();
            case 'repos':
            case 'repositories':
                return this.listRepositories();
            case 'agents':
                return this.listAgents();
            case 'deployments':
                return this.listDeployments();
            case 'all':
                await this.listDomains();
                console.log();
                await this.listRepositories();
                console.log();
                await this.listDeployments();
                break;
            default:
                console.log('Usage: cloud list <domains|repos|agents|deployments|all>');
        }
    }

    async addAdmin(args) {
        const username = args[0];
        if (!username) {
            console.log('Usage: cloud add admin <username>');
            return;
        }

        const password = await this.promptPassword('Password: ');
        if (password === null) {
            console.log('Operation cancelled.');
            return;
        }
        const confirmPassword = await this.promptPassword('Confirm Password: ');
        if (confirmPassword === null) {
            console.log('Operation cancelled.');
            return;
        }

        if (password !== confirmPassword) {
            console.error('Passwords do not match');
            return;
        }

        const response = await this.apiCall('/management/api/admins', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (response && response.success) {
            console.log(`Admin user '${username}' created successfully`);
        } else {
            console.error('Failed to create admin user');
        }
    }

    async addDomain(args) {
        const domain = args[0];
        if (!domain) {
            console.log('Usage: cloud add host <domain>');
            return;
        }

        const response = await this.apiCall('/management/api/domains', {
            method: 'POST',
            body: JSON.stringify({ name: domain, enabled: true })
        });

        if (response && response.success) {
            console.log(`Domain '${domain}' added successfully`);
        } else {
            console.error('Failed to add domain');
        }
    }

    async removeDomain(args) {
        const domain = args[0];
        if (!domain) {
            console.log('Usage: cloud remove host <domain>');
            return;
        }

        const response = await this.apiCall(`/management/api/domains/${domain}`, {
            method: 'DELETE'
        });

        if (response && response.success) {
            console.log(`Domain '${domain}' removed successfully`);
        } else {
            console.error('Failed to remove domain');
        }
    }

    async addRepository(args) {
        const name = args[0];
        const url = args[1];
        
        if (!name || !url) {
            console.log('Usage: cloud add repo <name> <url>');
            return;
        }

        const response = await this.apiCall('/management/api/repositories', {
            method: 'POST',
            body: JSON.stringify({ name, url, enabled: true })
        });

        if (response && response.success) {
            console.log(`Repository '${name}' added successfully`);
        } else {
            console.error('Failed to add repository');
        }
    }

    async removeRepository(args) {
        const url = args[0];
        if (!url) {
            console.log('Usage: cloud remove repo <url>');
            return;
        }

        const response = await this.apiCall(`/management/api/repositories`, {
            method: 'DELETE',
            body: JSON.stringify({ url })
        });

        if (response && response.success) {
            console.log(`Repository removed successfully`);
        } else {
            console.error('Failed to remove repository');
        }
    }

    async deploy(args) {
        const domain = args[0];
        const path = args[1];
        const agent = args[2];

        if (!domain || !path || !agent) {
            console.log('Usage: cloud deploy <domain> <path> <agent>');
            return;
        }

        const response = await this.apiCall('/management/api/deployments', {
            method: 'POST',
            body: JSON.stringify({ domain, path, agent })
        });

        if (response && response.success) {
            console.log(`Deployed '${agent}' to ${domain}${path}`);
        } else {
            console.error('Failed to deploy agent');
        }
    }

    async undeploy(args) {
        const domain = args[0];
        const path = args[1];

        if (!domain || !path) {
            console.log('Usage: cloud undeploy <domain> <path>');
            return;
        }

        const response = await this.apiCall('/management/api/deployments', {
            method: 'DELETE',
            body: JSON.stringify({ domain, path })
        });

        if (response && response.success) {
            console.log(`Undeployed from ${domain}${path}`);
        } else {
            console.error('Failed to undeploy');
        }
    }

    async runTask(args) {
        const agent = args[0];
        const command = args[1];
        const params = args.slice(2);

        if (!agent || !command) {
            console.log('Usage: cloud run <agent-path> <command> [params...]');
            return;
        }

        const response = await this.apiCall(agent, {
            method: 'POST',
            body: JSON.stringify({ command, params })
        });

        if (response) {
            console.log(JSON.stringify(response, null, 2));
        } else {
            console.error('Task execution failed');
        }
    }

    async listDomains() {
        const response = await this.apiCall('/management/api/domains');
        if (response && response.domains) {
            console.log('Configured Domains:');
            response.domains.forEach(domain => {
                console.log(`  - ${domain.name} ${domain.enabled ? '✓' : '✗'}`);
            });
        }
    }

    async listRepositories() {
        const response = await this.apiCall('/management/api/repositories');
        if (response && response.repositories) {
            console.log('Agent Repositories:');
            response.repositories.forEach(repo => {
                console.log(`  - ${repo.name}: ${repo.url}`);
            });
        }
    }

    async listAgents() {
        const response = await this.apiCall('/management/api/agents');
        if (response && response.agents) {
            console.log('Available Agents:');
            response.agents.forEach(agent => {
                console.log(`  - ${agent.name}: ${agent.description || 'No description'}`);
            });
        }
    }

    async listDeployments() {
        const response = await this.apiCall('/management/api/deployments');
        if (response && response.deployments) {
            console.log('Active Deployments:');
            response.deployments.forEach(dep => {
                console.log(`  - ${dep.domain}${dep.path} -> ${dep.agent} [${dep.status}]`);
            });
        }
    }

    async showMetrics(args) {
        const range = args[0] || '24h';
        const response = await this.apiCall(`/management/api/metrics?range=${range}`);
        
        if (response) {
            console.log('System Metrics:');
            console.log(`  Total Requests: ${response.totalRequests}`);
            console.log(`  Error Rate: ${response.errorRate}`);
            console.log(`  Uptime: ${this.formatUptime(response.uptime)}`);
            
            if (response.agents) {
                console.log('\nAgent Metrics:');
                Object.entries(response.agents).forEach(([agent, metrics]) => {
                    console.log(`  ${agent}:`);
                    console.log(`    Requests: ${metrics.count}`);
                    console.log(`    Avg Duration: ${metrics.avgDuration}ms`);
                    console.log(`    Error Rate: ${metrics.errorRate}`);
                });
            }
        }
    }

    async showConfig(args) {
        console.log('Current Configuration:');
        console.log(JSON.stringify(this.config, null, 2));
    }

    async apiCall(endpoint, options = {}) {
        const url = new URL(endpoint, this.config.serverUrl);
        
        const requestOptions = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(this.config.authToken ? {
                    'Cookie': `authorizationToken=${this.config.authToken}`
                } : {}),
                ...options.headers
            }
        };

        if (options.body) {
            requestOptions.body = options.body;
        }

        return new Promise((resolve, reject) => {
            const req = http.request(url, requestOptions, (res) => {
                let data = '';
                
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (err) {
                        resolve(null);
                    }
                });
            });

            req.on('error', (err) => {
                console.error('API call failed:', err.message);
                resolve(null);
            });

            if (requestOptions.body) {
                req.write(requestOptions.body);
            }
            
            req.end();
        });
    }

    promptPassword(prompt) {
        const inputState = require('../inputState');
        inputState.suspend();

        const promise = new Promise(resolve => {
            process.stdout.write(prompt);

            const stdin = process.stdin;
            let password = '';

            const cleanup = () => {
                stdin.removeListener('data', onData);
                if (stdin.isTTY) {
                    try { stdin.setRawMode(false); } catch(e) {}
                }
                inputState.resume();
            };

            const onData = (chunk) => {
                const char = chunk.toString();

                switch (char) {
                    case '\r': // Enter
                    case '\n':
                    case '\u0004': // Ctrl-D
                        cleanup();
                        process.stdout.write('\n');
                        resolve(password);
                        break;
                    case '\u0003': // Ctrl-C
                        cleanup();
                        process.stdout.write('\n');
                        resolve(null); // Indicate cancellation
                        break;
                    case '\x7f': // Backspace
                    case '\b':
                        if (password.length > 0) {
                            password = password.slice(0, -1);
                            process.stdout.write('\b \b');
                        }
                        break;
                    default:
                        if (char >= ' ' && char <= '~') {
                            password += char;
                            process.stdout.write('\b*');
                        }
                        break;
                }
            };

            if (stdin.isTTY) {
                try { 
                    stdin.setRawMode(true);
                 } catch(e) {}
            }
            stdin.resume();
            stdin.on('data', onData);
        });

        return promise;
    }

    formatUptime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        return `${hours}h ${minutes}m`;
    }

    showHelp() {
        console.log(`
Ploinky Cloud Administration Commands

Usage: p-cli cloud <command> [options]

Server Management:
  start [--port PORT] [--dir DIR]    Start the cloud server
  stop                                Stop the cloud server
  status                              Show server status

Authentication:
  login [username]                    Login to the cloud server
  logout                              Logout from the cloud server

Administration:
  add admin <username>                Add a new admin user
  add host <domain>                   Add a new domain/host
  add repo <name> <url>               Add an agent repository
  remove host <domain>                Remove a domain/host
  remove repo <url>                   Remove a repository

Deployment:
  deploy <domain> <path> <agent>      Deploy an agent to a path
  undeploy <domain> <path>            Remove a deployment
  list <domains|repos|agents|all>     List configurations
  
Operations:
  run <agent-path> <command> [args]   Run a task on an agent
  metrics [range]                      Show system metrics
  config                               Show current configuration

Examples:
  p-cli cloud start --port 8080
  p-cli cloud login admin
  p-cli cloud add host api.example.com
  p-cli cloud add repo MyAgents https://github.com/user/agents.git
  p-cli cloud deploy localhost /api/users UserAgent
  p-cli cloud run /api/users createUser john@example.com
  p-cli cloud metrics 7d
        `);
    }
}

module.exports = CloudCommand;